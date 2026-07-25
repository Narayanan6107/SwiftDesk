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
