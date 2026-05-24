"""Voter record dataclass.

Field names mirror the existing Prisma `Voter` model so the JSON emitted
by `/extract-voters` can be POSTed straight to the Next.js `/api/ingest`
endpoint without any field-name remapping.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class VoterRecord:
    serial_no: str = ""
    name: str = ""
    father_husband_name: str = ""
    cnic: str = ""
    gender: Optional[str] = None
    age: Optional[int] = None
    address: str = ""
    block_code: str = ""           # polling-station code
    profession: str = ""
    inferred_family_id: str = ""
    source_page: Optional[int] = None
    confidence: Optional[float] = None
    raw_row: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def is_valid(self) -> bool:
        """A record is shippable if it has a serial + a name."""
        return bool(self.serial_no) and bool(self.name)
