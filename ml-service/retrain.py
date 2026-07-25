"""
retrain.py — Offline Model Retraining Script

Run this script manually (or via a cron/scheduled task) whenever you want to
retrain the ML models from the latest verified tickets in MongoDB.

The running API service is NOT affected during training — it keeps serving
requests with the old models. After training completes, call POST /reload on
the running service to hot-swap the models without a restart.

Usage:
    python retrain.py
    python retrain.py --model-dir ./models --min-samples 50
    python retrain.py --dry-run    # shows data stats without training

After retraining, notify the running API:
    curl -X POST http://localhost:8000/reload
"""

import argparse
import json
import logging
import sys
import time

from config import settings
from trainer import train_and_save

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("retrain")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retrain SwiftDesk ML models from MongoDB verified tickets"
    )
    parser.add_argument(
        "--model-dir",
        default=settings.MODEL_DIR,
        help=f"Directory to save trained models (default: {settings.MODEL_DIR})",
    )
    parser.add_argument(
        "--min-samples",
        type=int,
        default=settings.MIN_TRAINING_SAMPLES,
        help=f"Minimum verified tickets required (default: {settings.MIN_TRAINING_SAMPLES})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Query MongoDB and show data stats without actually training",
    )
    return parser.parse_args()


def dry_run() -> None:
    """Show training data statistics without training."""
    from pymongo import MongoClient
    from preprocessor import combine_fields

    logger.info("DRY RUN — connecting to MongoDB …")
    client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=10_000)
    db = client[settings.MONGO_DB]
    collection = db[settings.MONGO_COLLECTION]

    cursor = collection.find(
        {
            "finalCategory": {"$nin": [None, ""]},
            "finalPriority": {"$nin": [None, ""]},
        },
        {"finalCategory": 1, "finalPriority": 1},
    )

    cat_counts: dict[str, int] = {}
    pri_counts: dict[str, int] = {}
    total = 0

    for doc in cursor:
        cat = doc.get("finalCategory", "")
        pri = doc.get("finalPriority", "")
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
        pri_counts[pri] = pri_counts.get(pri, 0) + 1
        total += 1

    client.close()

    print(f"\n{'='*50}")
    print(f"Verified tickets found: {total}")
    print(f"\nCategory distribution:")
    for k, v in sorted(cat_counts.items(), key=lambda x: -x[1]):
        bar = "█" * min(30, v)
        print(f"  {k:<20} {v:>5}  {bar}")
    print(f"\nPriority distribution:")
    for k, v in sorted(pri_counts.items(), key=lambda x: -x[1]):
        bar = "█" * min(30, v)
        print(f"  {k:<20} {v:>5}  {bar}")
    print(f"{'='*50}\n")

    if total < settings.MIN_TRAINING_SAMPLES:
        print(
            f"⚠️  Not enough verified tickets ({total} < {settings.MIN_TRAINING_SAMPLES}). "
            f"More agent-verified tickets are needed before training."
        )
    else:
        print(f"✅  Ready to train. Run without --dry-run to proceed.")


def main() -> None:
    args = parse_args()

    if args.dry_run:
        dry_run()
        return

    logger.info("=" * 50)
    logger.info("SwiftDesk ML Retraining")
    logger.info(f"  MongoDB:      {settings.MONGO_URI}/{settings.MONGO_DB}")
    logger.info(f"  Model dir:    {args.model_dir}")
    logger.info(f"  Min samples:  {args.min_samples}")
    logger.info("=" * 50)

    start = time.perf_counter()

    try:
        result = train_and_save(
            model_dir=args.model_dir,
            min_samples=args.min_samples,
        )
    except ValueError as exc:
        logger.error("Training aborted: %s", exc)
        sys.exit(1)
    except Exception as exc:
        logger.error("Unexpected error during training: %s", exc, exc_info=True)
        sys.exit(1)

    elapsed = time.perf_counter() - start

    print(f"\n{'='*50}")
    print("✅  Training complete!")
    print(json.dumps(result, indent=2))
    print(f"\nElapsed: {elapsed:.1f}s")
    print(f"{'='*50}")
    print("\nTo hot-reload the running API without restart, run:")
    print(f"  curl -X POST http://localhost:{settings.PORT}/reload")
    print()


if __name__ == "__main__":
    main()
