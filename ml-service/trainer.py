"""
Model Trainer
Fetches verified tickets from MongoDB, trains two sklearn Pipelines
(category + priority), evaluates them, and persists them via joblib.

Training data contract:
  Tickets must have both `finalCategory` and `finalPriority` fields set
  (non-null). These are populated by agents when they close/resolve a ticket
  and confirm or correct the AI classification.

Each saved Pipeline contains its own TF-IDF vectorizer so the two models
are fully independent and self-contained.
"""

import logging
import os
from pathlib import Path
from typing import Tuple

import joblib
import numpy as np
from pymongo import MongoClient
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from config import settings
from preprocessor import combine_fields

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

CATEGORY_MODEL_FILE = "category_model.joblib"
PRIORITY_MODEL_FILE = "priority_model.joblib"

VALID_CATEGORIES = {"Technical", "Billing", "General", "Account", "Feature Request"}
VALID_PRIORITIES = {"Low", "Medium", "High", "Critical"}


# ── MongoDB helpers ────────────────────────────────────────────────────────────

def _fetch_training_data(min_samples: int = 10) -> Tuple[list[str], list[str], list[str]]:
    """
    Connect to MongoDB and retrieve verified tickets.

    Returns:
        (texts, categories, priorities) — parallel lists.

    Raises:
        ValueError: If not enough verified tickets are found.
    """
    client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=10_000)
    db = client[settings.MONGO_DB]
    collection = db[settings.MONGO_COLLECTION]

    logger.info("Querying MongoDB for verified tickets …")

    cursor = collection.find(
        {
            "finalCategory": {"$nin": [None, ""]},
            "finalPriority": {"$nin": [None, ""]},
            "subject": {"$exists": True, "$nin": [None, ""]},
            "description": {"$exists": True, "$nin": [None, ""]},
        },
        {
            "subject": 1,
            "description": 1,
            "finalCategory": 1,
            "finalPriority": 1,
            "_id": 0,
        },
    )

    texts, categories, priorities = [], [], []

    for doc in cursor:
        cat = doc.get("finalCategory", "").strip()
        pri = doc.get("finalPriority", "").strip()
        subj = doc.get("subject", "").strip()
        desc = doc.get("description", "").strip()

        # Strict validation — skip dirty data
        if cat not in VALID_CATEGORIES or pri not in VALID_PRIORITIES:
            continue
        if not subj and not desc:
            continue

        combined = combine_fields(subj, desc)
        if not combined:
            continue

        texts.append(combined)
        categories.append(cat)
        priorities.append(pri)

    client.close()

    logger.info(f"Loaded {len(texts)} verified training samples")

    if len(texts) < min_samples:
        raise ValueError(
            f"Only {len(texts)} verified tickets found — need at least {min_samples}. "
            f"Ensure tickets have finalCategory and finalPriority set."
        )

    return texts, categories, priorities


# ── Pipeline factory ──────────────────────────────────────────────────────────

def _build_pipeline() -> Pipeline:
    """
    Build a TF-IDF + Logistic Regression pipeline.

    TF-IDF config:
      - Unigrams + bigrams (ngram_range=(1,2)) to capture phrases like "not working"
      - max_features=20_000 keeps memory reasonable
      - sublinear_tf smooths out very frequent terms

    Logistic Regression config:
      - L2 regularisation (default) — good for high-dimensional TF-IDF
      - max_iter=2000 — TF-IDF features often need more iterations
      - class_weight='balanced' handles label imbalance automatically
    """
    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    ngram_range=(1, 2),
                    max_features=20_000,
                    sublinear_tf=True,
                    min_df=2,          # ignore terms that appear in < 2 docs
                    max_df=0.95,       # ignore terms in > 95% of docs (too common)
                ),
            ),
            (
                "clf",
                LogisticRegression(
                    max_iter=2000,
                    class_weight="balanced",
                    solver="lbfgs",
                    multi_class="multinomial",
                    C=1.0,
                    random_state=42,
                ),
            ),
        ]
    )


# ── Evaluation ────────────────────────────────────────────────────────────────

def _evaluate(pipeline: Pipeline, X_test: list[str], y_test: list[str], label: str) -> None:
    y_pred = pipeline.predict(X_test)
    report = classification_report(y_test, y_pred, zero_division=0)
    logger.info(f"\n{'='*50}\n{label} Model — Test Set Report:\n{report}")


# ── Public API ────────────────────────────────────────────────────────────────

def train_and_save(model_dir: str | None = None, min_samples: int | None = None) -> dict:
    """
    Full training cycle:
      1. Fetch verified tickets from MongoDB.
      2. Train category + priority pipelines.
      3. Evaluate on held-out test set (20%).
      4. Save models to model_dir.

    Args:
        model_dir: Directory to save .joblib files. Defaults to settings.MODEL_DIR.
        min_samples: Minimum verified samples required. Defaults to settings.MIN_TRAINING_SAMPLES.

    Returns:
        Dict with training metadata (sample counts, accuracy, model paths).

    Raises:
        ValueError: If not enough training data.
    """
    model_dir = model_dir or settings.MODEL_DIR
    min_samples = min_samples or settings.MIN_TRAINING_SAMPLES

    Path(model_dir).mkdir(parents=True, exist_ok=True)

    # ── Fetch data ──────────────────────────────────────────────────────────
    texts, categories, priorities = _fetch_training_data(min_samples)
    n = len(texts)

    # ── Split ───────────────────────────────────────────────────────────────
    test_size = min(0.2, max(0.1, 20 / n))  # at least 10% but cap at 20 samples
    X_train, X_test, y_cat_train, y_cat_test, y_pri_train, y_pri_test = train_test_split(
        texts, categories, priorities,
        test_size=test_size,
        random_state=42,
        stratify=None,  # skip stratify when class counts are low
    )

    # ── Train category model ────────────────────────────────────────────────
    logger.info(f"Training category model on {len(X_train)} samples …")
    cat_pipeline = _build_pipeline()
    cat_pipeline.fit(X_train, y_cat_train)
    _evaluate(cat_pipeline, X_test, y_cat_test, "Category")

    # ── Train priority model ────────────────────────────────────────────────
    logger.info(f"Training priority model on {len(X_train)} samples …")
    pri_pipeline = _build_pipeline()
    pri_pipeline.fit(X_train, y_pri_train)
    _evaluate(pri_pipeline, X_test, y_pri_test, "Priority")

    # ── Save ────────────────────────────────────────────────────────────────
    cat_path = os.path.join(model_dir, CATEGORY_MODEL_FILE)
    pri_path = os.path.join(model_dir, PRIORITY_MODEL_FILE)

    joblib.dump(cat_pipeline, cat_path)
    joblib.dump(pri_pipeline, pri_path)

    logger.info(f"Models saved: {cat_path}, {pri_path}")

    # Compute simple train accuracy for reporting
    cat_train_acc = float(np.mean(np.array(cat_pipeline.predict(X_train)) == np.array(y_cat_train)))
    pri_train_acc = float(np.mean(np.array(pri_pipeline.predict(X_train)) == np.array(y_pri_train)))

    return {
        "total_samples": n,
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "category_model_path": cat_path,
        "priority_model_path": pri_path,
        "category_train_accuracy": round(cat_train_acc, 4),
        "priority_train_accuracy": round(pri_train_acc, 4),
        "category_labels": sorted(set(categories)),
        "priority_labels": sorted(set(priorities)),
    }
