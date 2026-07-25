"""
SwiftDesk ML Service — Central Configuration
All values are read from environment variables (with sensible defaults).
Copy .env.example → .env and adjust as needed.
"""

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # ── MongoDB ────────────────────────────────────────────────────────────
    MONGO_URI: str = Field(default="mongodb://localhost:27017", alias="MONGO_URI")
    MONGO_DB: str = Field(default="swiftdesk", alias="MONGO_DB")
    MONGO_COLLECTION: str = Field(default="tickets", alias="MONGO_COLLECTION")

    # ── ML Threshold ───────────────────────────────────────────────────────
    # If min(category_confidence, priority_confidence) >= this, skip LLM.
    ML_CONFIDENCE_THRESHOLD: float = Field(default=0.85, alias="ML_CONFIDENCE_THRESHOLD")

    # ── Model storage ──────────────────────────────────────────────────────
    MODEL_DIR: str = Field(default="./models", alias="MODEL_DIR")

    # ── Service ────────────────────────────────────────────────────────────
    HOST: str = Field(default="0.0.0.0", alias="HOST")
    PORT: int = Field(default=8000, alias="PORT")
    LOG_LEVEL: str = Field(default="info", alias="LOG_LEVEL")

    # ── Training ───────────────────────────────────────────────────────────
    # Minimum number of verified tickets required before training.
    MIN_TRAINING_SAMPLES: int = Field(default=10, alias="MIN_TRAINING_SAMPLES")

    model_config = {"env_file": ".env", "populate_by_name": True}


settings = Settings()
