"""
SwiftDesk ML Microservice
FastAPI application exposing POST /predict for ticket classification.

Startup behaviour:
  - Loads both model pipelines from MODEL_DIR into memory.
  - If models don't exist, the service starts anyway and sets
    requires_llm_validation=True on every request so the Node.js
    backend always falls back to LLM — no crash, no data loss.

Usage:
  uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
"""

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import settings
from predictor import MLPredictor

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ml_service")

# ── Global predictor (loaded once at startup) ─────────────────────────────────
_predictor: MLPredictor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models before the server accepts requests."""
    global _predictor
    logger.info("SwiftDesk ML Service starting …")
    _predictor = MLPredictor(settings.MODEL_DIR)
    _predictor.load()

    if _predictor.is_ready:
        logger.info("✅  Models loaded — service is fully operational")
    else:
        logger.warning(
            "⚠️   Models not found. Run  python retrain.py  to train models. "
            "All predictions will set requires_llm_validation=true until then."
        )

    yield  # server is running

    logger.info("SwiftDesk ML Service shutting down")


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SwiftDesk ML Service",
    description=(
        "Ticket classification microservice. "
        "Predicts category + priority using TF-IDF + Logistic Regression. "
        "Returns requires_llm_validation=true when confidence is below threshold."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Global exception handler ──────────────────────────────────────────────────

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
    )


# ── Schemas ───────────────────────────────────────────────────────────────────

class PredictRequest(BaseModel):
    subject: str = Field(..., min_length=1, description="Ticket subject line")
    description: str = Field(..., min_length=1, description="Ticket description")


class PredictResponse(BaseModel):
    predicted_category: str
    predicted_priority: str
    confidence: float = Field(
        ..., ge=0.0, le=1.0,
        description="Min of category and priority confidence scores (conservative)"
    )
    requires_llm_validation: bool = Field(
        ...,
        description="True when confidence < ML_CONFIDENCE_THRESHOLD. "
                    "Node.js backend should invoke LLM when this is true."
    )
    # Extended fields — useful for debugging / audit logs
    category_confidence: float | None = None
    priority_confidence: float | None = None
    threshold_used: float | None = None


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
    model_dir: str
    confidence_threshold: float


class Engineer(BaseModel):
    id: str = Field(alias="_id", default=None)
    id_plain: str = Field(alias="id", default=None)
    agent_id: str = Field(default="")
    name: str
    level: str
    status: str
    active_tickets: int
    max_capacity: int

    @property
    def resolved_id(self) -> str:
        """Return whichever of id/_id is populated."""
        return self.id or self.id_plain or ""

    class Config:
        allow_population_by_field_name = True
        populate_by_name = True


class TicketAssignInfo(BaseModel):
    ticketId: str
    priority: str
    subject: str | None = None
    description: str | None = None


class AssignRequest(BaseModel):
    ticket: TicketAssignInfo
    engineers: list[Engineer]


class AssignResponse(BaseModel):
    success: bool
    engineerId: str | None = None
    workloadRatio: float | None = None
    reason: str
    predictedPriority: str | None = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post(
    "/predict",
    response_model=PredictResponse,
    summary="Classify a support ticket",
    tags=["Classification"],
)
async def predict(request: PredictRequest) -> PredictResponse:
    """
    Classify the ticket's subject + description.

    - If **confidence ≥ ML_CONFIDENCE_THRESHOLD**: ML prediction is reliable.
      `requires_llm_validation` will be **false**.
    - If **confidence < ML_CONFIDENCE_THRESHOLD**: prediction may be uncertain.
      `requires_llm_validation` will be **true** — the caller should invoke LLM.

    The Node.js backend is responsible for LLM validation; this service
    never calls any external AI APIs.
    """
    result = _predictor.predict(request.subject, request.description)

    return PredictResponse(
        predicted_category=result.predicted_category,
        predicted_priority=result.predicted_priority,
        confidence=result.confidence,
        requires_llm_validation=result.requires_llm_validation,
        category_confidence=result.category_confidence,
        priority_confidence=result.priority_confidence,
        threshold_used=settings.ML_CONFIDENCE_THRESHOLD,
    )


@app.post(
    "/assign",
    response_model=AssignResponse,
    summary="Match a ticket to the best eligible support engineer",
    tags=["Assignment"],
)
async def assign_ticket(request: AssignRequest) -> AssignResponse:
    """
    Select the best engineer for a ticket using strict priority -> level rules.

    Priority rules (no Critical):
      Low   -> prefer L1, fallback L2, then L3
      Medium -> prefer L2, fallback L3
      High  -> L3 only

    L3 engineers are ONLY assigned to lower-priority tickets when no High-priority
    ticket is in the queue (caller must enforce queue ordering).
    """
    priority_raw = request.ticket.priority.strip()
    # Normalise: Critical -> High (only 3 levels exist)
    if priority_raw.lower() == "critical":
        priority_raw = "High"
    priority = priority_raw.title()
    if priority not in ("Low", "Medium", "High"):
        priority = "Medium"

    engineers = request.engineers

    def level_order(p: str) -> list[str]:
        """Ordered preference of engineer levels for a given priority."""
        if p == "Low":
            return ["L1", "L2", "L3"]
        if p == "Medium":
            return ["L2", "L3"]
        if p == "High":
            return ["L3"]
        return ["L2", "L3"]

    def is_available(eng: Engineer) -> bool:
        eng_id = getattr(eng, 'id', None) or getattr(eng, 'id_plain', None) or ""
        return eng.status == "available" and eng.active_tickets < eng.max_capacity

    order = level_order(priority)
    eligible: list[Engineer] = []

    for level in order:
        tier = [eng for eng in engineers if is_available(eng) and eng.level == level]
        if tier:
            eligible = tier
            break

    if not eligible:
        return AssignResponse(
            success=False,
            engineerId=None,
            workloadRatio=None,
            reason=f"No eligible engineers available for {priority} priority",
        )

    # Sort by workload ratio (ascending), then active_tickets (ascending)
    eligible_sorted = sorted(
        eligible,
        key=lambda x: (x.active_tickets / x.max_capacity if x.max_capacity > 0 else 1, x.active_tickets)
    )

    selected = eligible_sorted[0]
    workload_ratio = round(selected.active_tickets / selected.max_capacity, 4) if selected.max_capacity > 0 else 0
    selected_id = getattr(selected, 'id', None) or getattr(selected, 'id_plain', None) or ""

    logger.info(
        "Assigned ticket %s (priority=%s) to %s (level=%s, workload=%.2f)",
        request.ticket.ticketId, priority, selected.name, selected.level, workload_ratio
    )

    return AssignResponse(
        success=True,
        engineerId=selected_id,
        workloadRatio=workload_ratio,
        reason=f"Selected {selected.name} ({selected.level}) for {priority} priority ticket. Workload: {selected.active_tickets}/{selected.max_capacity}.",
    )


class PredictAndAssignRequest(BaseModel):
    """Combined request: classify the ticket then immediately assign to an engineer."""
    ticketId: str
    subject: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    engineers: list[Engineer]


class PredictAndAssignResponse(BaseModel):
    success: bool
    engineerId: str | None = None
    workloadRatio: float | None = None
    reason: str
    predictedPriority: str
    predictedCategory: str
    confidence: float
    requires_llm_validation: bool


@app.post(
    "/predict-and-assign",
    response_model=PredictAndAssignResponse,
    summary="Classify ticket priority from text, then assign to best engineer",
    tags=["Assignment"],
)
async def predict_and_assign(request: PredictAndAssignRequest) -> PredictAndAssignResponse:
    """
    Single-call endpoint that:
    1. Predicts priority (Low / Medium / High) from ticket subject + description using the trained NLP model.
    2. Selects the most suitable available engineer based on strict level routing:
       - Low   -> prefer L1, then L2, then L3 as fallback
       - Medium -> prefer L2, then L3 as fallback
       - High  -> L3 only

    Returns the predicted priority alongside the engineer assignment.
    """
    # Step 1: Predict priority from text
    prediction = _predictor.predict(request.subject, request.description)
    raw_priority = prediction.predicted_priority.strip().title()

    # Normalise: only Low / Medium / High allowed
    if raw_priority.lower() == "critical":
        raw_priority = "High"
    if raw_priority not in ("Low", "Medium", "High"):
        raw_priority = "Medium"

    engineers = request.engineers

    def level_order(p: str) -> list[str]:
        if p == "Low":
            return ["L1", "L2", "L3"]
        if p == "Medium":
            return ["L2", "L3"]
        return ["L3"]  # High

    def is_available(eng: Engineer) -> bool:
        return eng.status == "available" and eng.active_tickets < eng.max_capacity

    eligible: list[Engineer] = []
    for level in level_order(raw_priority):
        tier = [eng for eng in engineers if is_available(eng) and eng.level == level]
        if tier:
            eligible = tier
            break

    if not eligible:
        return PredictAndAssignResponse(
            success=False,
            engineerId=None,
            workloadRatio=None,
            reason=f"No eligible engineers available for {raw_priority} priority",
            predictedPriority=raw_priority,
            predictedCategory=prediction.predicted_category,
            confidence=prediction.confidence,
            requires_llm_validation=prediction.requires_llm_validation,
        )

    eligible_sorted = sorted(
        eligible,
        key=lambda x: (x.active_tickets / x.max_capacity if x.max_capacity > 0 else 1, x.active_tickets),
    )
    selected = eligible_sorted[0]
    workload_ratio = round(selected.active_tickets / selected.max_capacity, 4) if selected.max_capacity > 0 else 0
    selected_id = getattr(selected, "id", None) or getattr(selected, "id_plain", None) or ""

    logger.info(
        "predict-and-assign: ticket=%s priority=%s -> %s (level=%s workload=%.2f confidence=%.2f)",
        request.ticketId, raw_priority, selected.name, selected.level, workload_ratio, prediction.confidence,
    )

    return PredictAndAssignResponse(
        success=True,
        engineerId=selected_id,
        workloadRatio=workload_ratio,
        reason=f"NLP predicted {raw_priority} priority. Selected {selected.name} ({selected.level}). Workload: {selected.active_tickets}/{selected.max_capacity}.",
        predictedPriority=raw_priority,
        predictedCategory=prediction.predicted_category,
        confidence=prediction.confidence,
        requires_llm_validation=prediction.requires_llm_validation,
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health check",
    tags=["Operations"],
)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        models_loaded=_predictor.is_ready if _predictor else False,
        model_dir=settings.MODEL_DIR,
        confidence_threshold=settings.ML_CONFIDENCE_THRESHOLD,
    )


@app.post(
    "/reload",
    summary="Hot-reload models from disk (after retrain.py has run)",
    tags=["Operations"],
)
async def reload_models():
    """
    Reload models from MODEL_DIR without restarting the service.
    Call this endpoint after running retrain.py in a separate process.
    """
    _predictor.reload()
    return {
        "status": "reloaded",
        "models_loaded": _predictor.is_ready,
    }


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        log_level=settings.LOG_LEVEL,
        reload=False,  # use --reload only in development
    )
