# SwiftDesk ML Service

Python FastAPI microservice that classifies support tickets using **TF-IDF + Logistic Regression**.  
Trains from verified tickets in MongoDB. Integrates with the Node.js backend via HTTP.

## Folder Structure

```
ml-service/
├── main.py           # FastAPI app — POST /predict, GET /health, POST /reload
├── config.py         # Settings (pydantic-settings, reads from .env)
├── preprocessor.py   # Text cleaning pipeline
├── trainer.py        # MongoDB → TF-IDF + LR training logic
├── predictor.py      # Inference — loads models once at startup
├── retrain.py        # CLI script to retrain models offline
├── axios_example.js  # Node.js integration example
├── requirements.txt
├── .env.example
└── models/           # Trained .joblib files (generated, not committed)
    ├── category_model.joblib
    └── priority_model.joblib
```

## Quick Start

```bash
# 1. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env — set MONGO_URI, MONGO_DB, ML_CONFIDENCE_THRESHOLD

# 4. Train models (needs verified tickets in MongoDB)
python retrain.py --dry-run     # inspect data first
python retrain.py               # train and save models

# 5. Start the service
uvicorn main:app --host 0.0.0.0 --port 8000

# Development (auto-reload on file changes)
uvicorn main:app --reload --port 8000
```

## API Reference

### `POST /predict`

```json
// Request
{ "subject": "Cannot login to my account", "description": "..." }

// Response
{
  "predicted_category": "Account",
  "predicted_priority": "High",
  "confidence": 0.91,
  "requires_llm_validation": false,
  "category_confidence": 0.93,
  "priority_confidence": 0.91,
  "threshold_used": 0.85
}
```

- `confidence` = `min(category_confidence, priority_confidence)` — conservative
- `requires_llm_validation: true` when `confidence < ML_CONFIDENCE_THRESHOLD`
- **The Python service never calls any LLM.** The Node.js backend handles LLM validation.

### `GET /health`

```json
{
  "status": "ok",
  "models_loaded": true,
  "model_dir": "./models",
  "confidence_threshold": 0.85
}
```

### `POST /reload`

Hot-swaps models from disk after `retrain.py` runs — **no restart needed**.

```bash
curl -X POST http://localhost:8000/reload
```

## Training Data Contract

The trainer queries MongoDB for tickets where **both** `finalCategory` and `finalPriority` are set.  
These fields are populated by support agents when they confirm or correct the AI classification.

```
Ticket.finalCategory  →  Technical | Billing | General | Account | Feature Request
Ticket.finalPriority  →  Low | Medium | High | Critical
```

Run `python retrain.py --dry-run` to see a breakdown of available training samples.

## Retraining Workflow

```
1. Agents close tickets → set finalCategory + finalPriority
2. Run:  python retrain.py
3. Notify running API:  curl -X POST http://localhost:8000/reload
```

The running API continues serving with old models during step 2.

## Node.js Integration

The Node.js `mlClassifier.js` service calls `POST /predict` automatically.  
Set the service URL in the backend `.env`:

```
ML_SERVICE_URL=http://localhost:8000
ML_REQUEST_TIMEOUT_MS=5000
```

If the Python service is unreachable, `mlClassifier.js` falls back to keyword matching  
(confidence always < threshold → LLM validation is triggered automatically).
