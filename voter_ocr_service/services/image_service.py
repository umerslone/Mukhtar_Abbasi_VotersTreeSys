"""OpenCV preprocessing tuned for scanned Urdu voter lists.

Pipeline:
1. Read as BGR.
2. Grayscale.
3. Deskew via minimum-area-rect on binarized foreground.
4. Denoise (fastNlMeansDenoising).
5. Contrast boost (CLAHE).
6. Adaptive threshold for crisp glyph edges.

Returns the cleaned image. We deliberately keep a 3-channel output
because PaddleOCR expects BGR.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from utils.logger import get_logger

log = get_logger(__name__)


def _deskew(gray: np.ndarray) -> np.ndarray:
    inverted = cv2.bitwise_not(gray)
    _, thresh = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(thresh > 0))
    if coords.size == 0:
        return gray
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    # Ignore tiny tilts — avoids unnecessary resampling blur.
    if abs(angle) < 0.3:
        return gray
    h, w = gray.shape
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, matrix, (w, h), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REPLICATE)


def preprocess(image_path: Path) -> np.ndarray:
    img = cv2.imread(str(image_path))
    if img is None:
        raise ValueError(f"Could not read image: {image_path}")
    return preprocess_array(img)


def preprocess_array(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = _deskew(gray)
    gray = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    # Mild sharpen.
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    gray = cv2.filter2D(gray, -1, kernel)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def save_debug(img: np.ndarray, dest: Path) -> Optional[Path]:
    try:
        cv2.imwrite(str(dest), img)
        return dest
    except Exception as exc:  # pragma: no cover
        log.warning("Could not save debug image %s: %s", dest, exc)
        return None
