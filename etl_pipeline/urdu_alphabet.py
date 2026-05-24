"""
Urdu alphabet reference and OCR-correction helpers.

Single source of truth for:
  * the 37-letter Urdu alphabet (with names + Unicode codepoints)
  * Arabic ↔ Urdu glyph variants that OCR engines (Azure Document Intelligence,
    Tesseract, Google Vision) routinely mis-pick across the two scripts
  * diacritics (harakat) and tatweel/joiners that add no semantic value
  * Urdu/Arabic-Indic digits ↔ ASCII digits
  * a `correct_name(text)` function used by the AI-cleanup post-processor

The goal is to take whatever the OCR returned (mixed Arabic/Urdu codepoints,
stray diacritics, ASCII punctuation, kashida elongations, honorifics) and
collapse it to a canonical Urdu spelling that two passes of the same name will
agree on. Used by:
  * etl_pipeline.voters_etl.normalize_text  (clustering rows into families)
  * web_app/src/lib/urdu_alphabet.ts        (parallel TS implementation —
    keep both files in sync if you change a mapping)
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# ── 1. The Urdu alphabet ────────────────────────────────────────────────

@dataclass(frozen=True)
class Letter:
    glyph: str       # the canonical Urdu glyph
    name: str        # transliterated name (e.g. "alef", "bay")
    urdu_name: str   # Urdu spelling of the letter's name
    codepoint: int   # Unicode codepoint of `glyph`

URDU_ALPHABET: tuple[Letter, ...] = (
    Letter("\u0627", "alef",            "الف",   0x0627),
    Letter("\u0628", "bay",             "بے",    0x0628),
    Letter("\u067E", "pay",             "پے",    0x067E),
    Letter("\u062A", "tay",             "تے",    0x062A),
    Letter("\u0679", "tay (retroflex)", "ٹے",    0x0679),
    Letter("\u062B", "say",             "ثے",    0x062B),
    Letter("\u062C", "jeem",            "جیم",   0x062C),
    Letter("\u0686", "chay",            "چے",    0x0686),
    Letter("\u062D", "bari-hay",        "بڑی حے", 0x062D),
    Letter("\u062E", "khay",            "خے",    0x062E),
    Letter("\u062F", "daal",            "دال",   0x062F),
    Letter("\u0688", "daal (retroflex)","ڈال",   0x0688),
    Letter("\u0630", "zaal",            "ذال",   0x0630),
    Letter("\u0631", "ray",             "رے",    0x0631),
    Letter("\u0691", "ray (retroflex)", "ڑے",    0x0691),
    Letter("\u0632", "zay",             "زے",    0x0632),
    Letter("\u0698", "zhay",            "ژے",    0x0698),
    Letter("\u0633", "seen",            "سین",   0x0633),
    Letter("\u0634", "sheen",           "شین",   0x0634),
    Letter("\u0635", "su'aad",          "صواد",  0x0635),
    Letter("\u0636", "zu'aad",          "ضواد",  0x0636),
    Letter("\u0637", "to'ay",           "طوۓ",   0x0637),
    Letter("\u0638", "zo'ay",           "ظوۓ",   0x0638),
    Letter("\u0639", "ain",             "عین",   0x0639),
    Letter("\u063A", "ghain",           "غین",   0x063A),
    Letter("\u0641", "fay",             "فے",    0x0641),
    Letter("\u0642", "qaaf",            "قاف",   0x0642),
    Letter("\u06A9", "kaaf",            "کاف",   0x06A9),
    Letter("\u06AF", "gaaf",            "گاف",   0x06AF),
    Letter("\u0644", "laam",            "لام",   0x0644),
    Letter("\u0645", "meem",            "میم",   0x0645),
    Letter("\u0646", "noon",            "نون",   0x0646),
    Letter("\u06BA", "noon-ghunna",     "نون غنہ",0x06BA),
    Letter("\u0648", "wow",             "واؤ",   0x0648),
    Letter("\u06C1", "choti-hay",       "چھوٹی ہے", 0x06C1),
    Letter("\u06CC", "choti-yay",       "چھوٹی یے", 0x06CC),
    Letter("\u06D2", "bari-yay",        "بڑی یے", 0x06D2),
)

# Fast O(1) glyph → Letter lookup
LETTER_INDEX: dict[str, Letter] = {l.glyph: l for l in URDU_ALPHABET}


# ── 2. Aerographs / digraphs ────────────────────────────────────────────
# The "do-chashmi he" (ھ U+06BE) combines with several base letters to form
# Urdu aspirated digraphs (بھ, پھ, تھ, ٹھ, جھ, چھ, دھ, ڈھ, ڑھ, کھ, گھ).
# We keep it as-is; OCR rarely splits it but if it does, the correction
# table below will not falsely merge it into the base letter.
DO_CHASHMI_HAY = "\u06BE"


# ── 3. Arabic → Urdu glyph normalisation table ──────────────────────────
# Every key is a codepoint OCR engines emit when they see an Urdu glyph but
# pick the Arabic variant from their training set. Values are the canonical
# Urdu codepoint we want.
ARABIC_TO_URDU: dict[str, str] = {
    # ── alef family → ا ────────────────────────────────────────────────
    "\u0622": "\u0627",  # ALEF WITH MADDA ABOVE        آ → ا
    "\u0623": "\u0627",  # ALEF WITH HAMZA ABOVE        أ → ا
    "\u0625": "\u0627",  # ALEF WITH HAMZA BELOW        إ → ا
    "\u0671": "\u0627",  # ALEF WASLA                   ٱ → ا
    "\u0672": "\u0627",  # ALEF WITH WAVY HAMZA ABOVE   ٲ → ا
    "\u0673": "\u0627",  # ALEF WITH WAVY HAMZA BELOW   ٳ → ا

    # ── ya family → ی (Urdu uses U+06CC, Arabic uses U+064A) ──────────
    "\u064A": "\u06CC",  # ARABIC YEH                   ي → ی
    "\u0649": "\u06CC",  # ALEF MAKSURA                 ى → ی
    "\u06D2": "\u06CC",  # BARI YEH                     ے → ی   (mid-word)

    # ── kaf → ک (Arabic uses U+0643, Urdu uses U+06A9) ────────────────
    "\u0643": "\u06A9",  # ARABIC KAF                   ك → ک

    # ── ha family → ہ (Urdu choti hay U+06C1) ─────────────────────────
    "\u0647": "\u06C1",  # ARABIC HEH                   ه → ہ
    "\u06C3": "\u06C1",  # TEH MARBUTA GOAL             ۃ → ہ
    "\u0629": "\u06C1",  # ARABIC TEH MARBUTA           ة → ہ

    # ── hamza / standalone diacritics — drop ──────────────────────────
    "\u0621": "",        # HAMZA                         ء
    "\u0624": "\u0648",  # WAW WITH HAMZA ABOVE          ؤ → و
    "\u0626": "\u06CC",  # YEH WITH HAMZA ABOVE          ئ → ی
    "\u0654": "",        # HAMZA ABOVE (combining)
    "\u0655": "",        # HAMZA BELOW (combining)
}

# ── 4. OCR confusion classes ────────────────────────────────────────────
# Letters that share visual shape and only differ in dots/marks. The OCR
# engine is most likely to flip *within* a row — we DO NOT collapse them
# (that would destroy meaning) but we expose the table so the AI prompt
# can be primed with it, and so downstream fuzzy matchers can weight
# substitutions inside a row as low-cost edits.
CONFUSION_ROWS: tuple[tuple[str, ...], ...] = (
    ("\u0628", "\u067E", "\u062A", "\u0679", "\u062B"),  # ب پ ت ٹ ث  (one-bowl letters)
    ("\u062C", "\u0686", "\u062D", "\u062E"),            # ج چ ح خ
    ("\u062F", "\u0688", "\u0630"),                      # د ڈ ذ
    ("\u0631", "\u0691", "\u0632", "\u0698"),            # ر ڑ ز ژ
    ("\u0633", "\u0634"),                                # س ش
    ("\u0635", "\u0636"),                                # ص ض
    ("\u0637", "\u0638"),                                # ط ظ
    ("\u0639", "\u063A"),                                # ع غ
    ("\u0641", "\u0642"),                                # ف ق
    ("\u06A9", "\u06AF"),                                # ک گ
    ("\u0646", "\u06BA"),                                # ن ں
    ("\u06CC", "\u06D2"),                                # ی ے
)


# ── 5. Strippable noise ─────────────────────────────────────────────────
# Tatweel (kashida ـ) — pure presentational elongation, no semantic value.
TATWEEL = "\u0640"

# Arabic harakat / diacritics (fatha, kasra, damma, shadda, sukun, etc.)
HARAKAT_RE = re.compile(
    "[\u064B-\u0652\u0670\u0640\u06D6-\u06ED\u08E3-\u08FF]"
)

# Zero-width and bidi markers OCR sometimes inserts.
ZERO_WIDTH_RE = re.compile("[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]")


# ── 6. Digits ───────────────────────────────────────────────────────────
URDU_DIGITS = "۰۱۲۳۴۵۶۷۸۹"   # U+06F0..U+06F9 (Eastern Arabic-Indic, Urdu form)
ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"  # U+0660..U+0669 (Arabic-Indic)
DIGIT_TO_ASCII = {ch: str(i) for i, ch in enumerate(URDU_DIGITS)}
DIGIT_TO_ASCII.update({ch: str(i) for i, ch in enumerate(ARABIC_DIGITS)})


# ── 7. Honorifics & relator tokens to strip from names ─────────────────
# These appear before/after voter names and break clustering. Match
# whole-word, case-insensitively, in both Urdu and Latin.
HONORIFICS_URDU = (
    "محترم", "محترمہ", "جناب", "صاحب", "صاحبہ", "حاجی", "حاجن",
    "چوہدری", "چودھری", "راجہ", "ملک", "میاں", "خان", "شیخ", "سید",
    "بن", "بنت", "بنتِ", "ولد", "زوجہ", "د/و", "و/و", "س/و",
)
HONORIFICS_LATIN_RE = re.compile(
    r"\b(s/o|d/o|w/o|bin|binte|bint|mr|mrs|mst|miss|ch|chaudhry|"
    r"raja|malik|mian|haji|sheikh|syed|khan)\b\.?",
    re.IGNORECASE,
)


# ── 8. Public API ───────────────────────────────────────────────────────

def to_canonical_urdu(text: str) -> str:
    """Map Arabic-variant codepoints in `text` to their Urdu equivalents.

    Pure character substitution — no whitespace or honorific changes.
    Safe to apply to any Urdu text including addresses and CNICs.
    """
    if not text:
        return ""
    # NFC first so combining sequences collapse into precomposed forms
    # where possible (then we strip what's left).
    out = unicodedata.normalize("NFC", text)
    out = ZERO_WIDTH_RE.sub("", out)
    out = HARAKAT_RE.sub("", out)
    out = out.replace(TATWEEL, "")
    out = "".join(ARABIC_TO_URDU.get(ch, ch) for ch in out)
    return out


def to_ascii_digits(text: str) -> str:
    """Convert Urdu/Arabic-Indic digits to ASCII 0-9."""
    return "".join(DIGIT_TO_ASCII.get(ch, ch) for ch in text)


def strip_honorifics(text: str) -> str:
    """Remove common Urdu/Latin honorifics so two spellings of one person
    cluster together. Whitespace is normalised on the way out.
    """
    out = text
    for h in HONORIFICS_URDU:
        out = re.sub(rf"(^|\s){re.escape(h)}(\s|$)", " ", out)
    out = HONORIFICS_LATIN_RE.sub(" ", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def correct_name(text: str) -> str:
    """One-shot OCR name corrector.

    Pipeline:
      1. NFC normalise
      2. Strip zero-width / bidi markers
      3. Strip harakat (diacritics) and tatweel (kashida)
      4. Map every Arabic glyph to its Urdu equivalent
      5. Convert Urdu/Arabic digits to ASCII
      6. Remove honorifics and relator words
      7. Collapse whitespace

    The result is the canonical Urdu spelling used for clustering, fuzzy
    matching, and DB de-duplication.
    """
    if not text:
        return ""
    out = to_canonical_urdu(text)
    out = to_ascii_digits(out)
    # honorifics first — "S/O" etc. need the slash intact for the regex.
    out = strip_honorifics(out)
    # then collapse remaining punctuation that OCR slips in between words
    out = re.sub(r"[.,()\[\]{}؛،\"'`/\\|_:;!?]+", " ", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def ai_prompt_hint() -> str:
    """A short Urdu alphabet + confusion-class hint to prepend to the
    Azure OpenAI cleanup system prompt. Helps the model fix character-class
    flips rather than hallucinating fresh names.
    """
    rows = "\n".join("  " + " ".join(r) for r in CONFUSION_ROWS)
    return (
        "Canonical Urdu alphabet (37 letters): "
        + " ".join(l.glyph for l in URDU_ALPHABET)
        + "\n"
        "Common OCR confusion classes (letters in one row look alike — flip "
        "WITHIN a row when context demands, never across rows):\n"
        + rows
        + "\n"
        "Always use the Urdu forms: ی (not ي), ک (not ك), ہ (not ه), ا (not آ/أ/إ)."
    )


__all__ = [
    "Letter",
    "URDU_ALPHABET",
    "LETTER_INDEX",
    "ARABIC_TO_URDU",
    "CONFUSION_ROWS",
    "DO_CHASHMI_HAY",
    "URDU_DIGITS",
    "ARABIC_DIGITS",
    "HONORIFICS_URDU",
    "to_canonical_urdu",
    "to_ascii_digits",
    "strip_honorifics",
    "correct_name",
    "ai_prompt_hint",
]
