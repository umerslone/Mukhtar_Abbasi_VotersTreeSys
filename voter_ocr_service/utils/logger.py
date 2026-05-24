"""Tiny structured-ish logger so all modules share one configuration."""
from __future__ import annotations

import logging
import sys

_FMT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FMT))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger
