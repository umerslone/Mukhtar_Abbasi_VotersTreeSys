"""Regex used by the parser/cleaner.

All patterns are compiled once so hot paths stay fast.
"""
from __future__ import annotations

import re

# Pakistani CNIC: 5-7-1 digits, dash-separated. We tolerate spaces.
CNIC_RE = re.compile(r"\b(\d{5})\s*[-–—]?\s*(\d{7})\s*[-–—]?\s*(\d)\b")

# Polling-station / block code: 12+ digits seen on AJK lists (e.g. 822310202007).
BLOCK_CODE_RE = re.compile(r"\b\d{10,14}\b")

# Pure integer 1–4 digits (serial number or age).
INT_RE = re.compile(r"^\d{1,4}$")

# Urdu gender tokens.
GENDER_MALE_RE = re.compile(r"\b(مرد|MALE|M)\b", re.IGNORECASE)
GENDER_FEMALE_RE = re.compile(r"\b(عورت|FEMALE|F)\b", re.IGNORECASE)

# Strip everything that is NOT Urdu/Arabic letter, ASCII letter, digit, dash or space.
NOISE_RE = re.compile(
    r"[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF"
    r"A-Za-z0-9 \-/]+"
)

# Multiple whitespace -> single space.
WS_RE = re.compile(r"\s+")

# Relationship marker (ولد / بنت / دختر / زوجہ / wife of).
REL_MALE_RE = re.compile(r"\bولد\b|\bبن\b|\bs/o\b|\bson of\b", re.IGNORECASE)
REL_FEMALE_RE = re.compile(
    r"\bبنت\b|\bدختر\b|\bزوجہ\b|\bd/o\b|\bw/o\b|\bdaughter of\b|\bwife of\b",
    re.IGNORECASE,
)
