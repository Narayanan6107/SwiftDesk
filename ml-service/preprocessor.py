"""
Text Preprocessor
Cleans and normalises raw ticket text before vectorisation.

Pipeline:
  1. Lowercase
  2. Strip URLs
  3. Remove punctuation & special characters
  4. Collapse whitespace
  5. Remove English stop words (NLTK)
  6. (Optional) Stemming disabled by default — Logistic Regression + TF-IDF
     works well without it, and keeping real words aids interpretability.
"""

import re
import string
import logging

import nltk
from nltk.corpus import stopwords

logger = logging.getLogger(__name__)

# ── NLTK data bootstrap ───────────────────────────────────────────────────────

def _ensure_nltk_data() -> None:
    """Download NLTK stopwords corpus if not already present."""
    try:
        stopwords.words("english")
    except LookupError:
        logger.info("Downloading NLTK stopwords …")
        nltk.download("stopwords", quiet=True)


_ensure_nltk_data()
_STOP_WORDS: set[str] = set(stopwords.words("english"))

# Keep negations — they carry meaning (e.g. "not working", "cannot login")
_KEEP_WORDS = {"no", "not", "never", "cannot", "can't", "won't", "don't", "doesn't"}
_EFFECTIVE_STOP_WORDS = _STOP_WORDS - _KEEP_WORDS

# Pre-compile regexes for performance
_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_PUNCT_RE = re.compile(r"[^\w\s]")
_WHITESPACE_RE = re.compile(r"\s+")


def preprocess(text: str) -> str:
    """
    Clean and normalise a single text string.

    Args:
        text: Raw ticket subject or combined subject+description.

    Returns:
        Lowercased, de-punctuated, stop-word-filtered string ready for TF-IDF.
    """
    if not text or not isinstance(text, str):
        return ""

    # 1. Lowercase
    text = text.lower()

    # 2. Remove URLs
    text = _URL_RE.sub(" ", text)

    # 3. Remove punctuation (keep apostrophes for contractions handled above)
    text = _PUNCT_RE.sub(" ", text)

    # 4. Collapse whitespace
    text = _WHITESPACE_RE.sub(" ", text).strip()

    # 5. Remove stop words
    tokens = [t for t in text.split() if t not in _EFFECTIVE_STOP_WORDS and len(t) > 1]

    return " ".join(tokens)


def combine_fields(subject: str, description: str) -> str:
    """
    Combine subject and description into a single training/inference string.
    The subject is repeated to give it higher implicit weight in TF-IDF.
    """
    s = (subject or "").strip()
    d = (description or "").strip()
    # Subject repeated 2× → effectively boosts subject term frequencies
    combined = f"{s} {s} {d}"
    return preprocess(combined)
