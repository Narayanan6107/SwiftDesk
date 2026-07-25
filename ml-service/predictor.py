"""
ML Predictor
Loads pre-trained pipelines at startup and performs inference.

predict() guarantees:
  - One confidence value = min(cat_confidence, pri_confidence)
    (conservative: both models must be confident)
  - requires_llm_validation=True when confidence < ML_CONFIDENCE_THRESHOLD
  - Never raises on bad input — returns a safe default instead
"""

import logging
import os
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np

from config import settings
from preprocessor import combine_fields

logger = logging.getLogger(__name__)

CATEGORY_MODEL_FILE = "category_model.joblib"
PRIORITY_MODEL_FILE = "priority_model.joblib"

DEFAULT_CATEGORY = "General"
DEFAULT_PRIORITY = "Medium"


@dataclass
class PredictionResult:
    predicted_category: str
    predicted_priority: str
    confidence: float
    requires_llm_validation: bool
    category_confidence: float
    priority_confidence: float


class MLPredictor:
    """
    Singleton-style predictor that holds both model pipelines in memory.
    Call load() once at application startup.
    """

    def __init__(self, model_dir: str | None = None) -> None:
        self._model_dir = model_dir or settings.MODEL_DIR
        self._cat_pipeline = None
        self._pri_pipeline = None
        self.is_ready: bool = False

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def load(self) -> None:
        """
        Load both model pipelines from disk.
        Sets is_ready=True only when both models are successfully loaded.
        """
        cat_path = os.path.join(self._model_dir, CATEGORY_MODEL_FILE)
        pri_path = os.path.join(self._model_dir, PRIORITY_MODEL_FILE)

        if not Path(cat_path).exists() or not Path(pri_path).exists():
            logger.warning(
                "Pre-trained models not found at '%s'. "
                "Run retrain.py to train models before starting the service. "
                "All predictions will require LLM validation until models are loaded.",
                self._model_dir,
            )
            self.is_ready = False
            return

        try:
            self._cat_pipeline = joblib.load(cat_path)
            self._pri_pipeline = joblib.load(pri_path)
            self.is_ready = True
            logger.info("Category model loaded from %s", cat_path)
            logger.info("Priority model loaded from %s", pri_path)
        except Exception as exc:
            logger.error("Failed to load models: %s", exc)
            self.is_ready = False

    def reload(self) -> None:
        """Re-load models from disk — used after a retrain run."""
        logger.info("Reloading models from disk …")
        self.is_ready = False
        self._cat_pipeline = None
        self._pri_pipeline = None
        self.load()

    # ── Inference ────────────────────────────────────────────────────────────

    def predict(self, subject: str, description: str) -> PredictionResult:
        """
        Classify subject + description.

        Args:
            subject: Ticket subject line.
            description: Full ticket description.

        Returns:
            PredictionResult with category, priority, confidence, and
            requires_llm_validation flag.
        """
        if not self.is_ready:
            # Models not loaded — signal caller to use LLM
            return PredictionResult(
                predicted_category=DEFAULT_CATEGORY,
                predicted_priority=DEFAULT_PRIORITY,
                confidence=0.0,
                requires_llm_validation=True,
                category_confidence=0.0,
                priority_confidence=0.0,
            )

        try:
            text = combine_fields(subject, description)
            if not text:
                return self._low_confidence_result()

            # ── Category prediction ──────────────────────────────────────
            cat_proba = self._cat_pipeline.predict_proba([text])[0]
            cat_idx = int(np.argmax(cat_proba))
            cat_confidence = float(cat_proba[cat_idx])
            cat_label = self._cat_pipeline.classes_[cat_idx]

            # ── Priority prediction ──────────────────────────────────────
            pri_proba = self._pri_pipeline.predict_proba([text])[0]
            pri_idx = int(np.argmax(pri_proba))
            pri_confidence = float(pri_proba[pri_idx])
            pri_label = self._pri_pipeline.classes_[pri_idx]

            # ── Combined confidence (conservative: min of both) ──────────
            confidence = min(cat_confidence, pri_confidence)
            requires_llm = confidence < settings.ML_CONFIDENCE_THRESHOLD

            logger.debug(
                "Prediction: cat=%s (%.2f), pri=%s (%.2f), confidence=%.2f, llm=%s",
                cat_label, cat_confidence, pri_label, pri_confidence,
                confidence, requires_llm,
            )

            return PredictionResult(
                predicted_category=cat_label,
                predicted_priority=pri_label,
                confidence=round(confidence, 4),
                requires_llm_validation=requires_llm,
                category_confidence=round(cat_confidence, 4),
                priority_confidence=round(pri_confidence, 4),
            )

        except Exception as exc:
            logger.error("Prediction error: %s", exc, exc_info=True)
            return self._low_confidence_result()

    def _low_confidence_result(self) -> PredictionResult:
        return PredictionResult(
            predicted_category=DEFAULT_CATEGORY,
            predicted_priority=DEFAULT_PRIORITY,
            confidence=0.0,
            requires_llm_validation=True,
            category_confidence=0.0,
            priority_confidence=0.0,
        )
