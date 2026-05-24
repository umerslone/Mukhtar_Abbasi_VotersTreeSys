/**
 * Urdu alphabet reference and OCR-correction helpers (TypeScript port).
 *
 * Parallel implementation of `etl_pipeline/urdu_alphabet.py`. Keep the two
 * files in sync — every mapping here mirrors its Python counterpart so that
 * names normalized in the ETL pipeline compare equal to names normalized in
 * the browser.
 *
 * Used by:
 *   - components/FamilyTree.tsx (fuzzy parent matching across OCR variants)
 *   - any future name-based search / cluster UI
 */

// ── 1. The Urdu alphabet ────────────────────────────────────────────────

export interface UrduLetter {
  /** Canonical Urdu glyph. */
  glyph: string;
  /** Transliterated name (e.g. "alef", "bay"). */
  name: string;
  /** Urdu spelling of the letter's name. */
  urduName: string;
  /** Unicode codepoint of `glyph`. */
  codepoint: number;
}

export const URDU_ALPHABET: readonly UrduLetter[] = [
  { glyph: '\u0627', name: 'alef',             urduName: 'الف',     codepoint: 0x0627 },
  { glyph: '\u0628', name: 'bay',              urduName: 'بے',      codepoint: 0x0628 },
  { glyph: '\u067E', name: 'pay',              urduName: 'پے',      codepoint: 0x067E },
  { glyph: '\u062A', name: 'tay',              urduName: 'تے',      codepoint: 0x062A },
  { glyph: '\u0679', name: 'tay (retroflex)',  urduName: 'ٹے',      codepoint: 0x0679 },
  { glyph: '\u062B', name: 'say',              urduName: 'ثے',      codepoint: 0x062B },
  { glyph: '\u062C', name: 'jeem',             urduName: 'جیم',     codepoint: 0x062C },
  { glyph: '\u0686', name: 'chay',             urduName: 'چے',      codepoint: 0x0686 },
  { glyph: '\u062D', name: 'bari-hay',         urduName: 'بڑی حے',  codepoint: 0x062D },
  { glyph: '\u062E', name: 'khay',             urduName: 'خے',      codepoint: 0x062E },
  { glyph: '\u062F', name: 'daal',             urduName: 'دال',     codepoint: 0x062F },
  { glyph: '\u0688', name: 'daal (retroflex)', urduName: 'ڈال',     codepoint: 0x0688 },
  { glyph: '\u0630', name: 'zaal',             urduName: 'ذال',     codepoint: 0x0630 },
  { glyph: '\u0631', name: 'ray',              urduName: 'رے',      codepoint: 0x0631 },
  { glyph: '\u0691', name: 'ray (retroflex)',  urduName: 'ڑے',      codepoint: 0x0691 },
  { glyph: '\u0632', name: 'zay',              urduName: 'زے',      codepoint: 0x0632 },
  { glyph: '\u0698', name: 'zhay',             urduName: 'ژے',      codepoint: 0x0698 },
  { glyph: '\u0633', name: 'seen',             urduName: 'سین',     codepoint: 0x0633 },
  { glyph: '\u0634', name: 'sheen',            urduName: 'شین',     codepoint: 0x0634 },
  { glyph: '\u0635', name: 'su\'aad',          urduName: 'صواد',    codepoint: 0x0635 },
  { glyph: '\u0636', name: 'zu\'aad',          urduName: 'ضواد',    codepoint: 0x0636 },
  { glyph: '\u0637', name: 'to\'ay',           urduName: 'طوۓ',     codepoint: 0x0637 },
  { glyph: '\u0638', name: 'zo\'ay',           urduName: 'ظوۓ',     codepoint: 0x0638 },
  { glyph: '\u0639', name: 'ain',              urduName: 'عین',     codepoint: 0x0639 },
  { glyph: '\u063A', name: 'ghain',            urduName: 'غین',     codepoint: 0x063A },
  { glyph: '\u0641', name: 'fay',              urduName: 'فے',      codepoint: 0x0641 },
  { glyph: '\u0642', name: 'qaaf',             urduName: 'قاف',     codepoint: 0x0642 },
  { glyph: '\u06A9', name: 'kaaf',             urduName: 'کاف',     codepoint: 0x06A9 },
  { glyph: '\u06AF', name: 'gaaf',             urduName: 'گاف',     codepoint: 0x06AF },
  { glyph: '\u0644', name: 'laam',             urduName: 'لام',     codepoint: 0x0644 },
  { glyph: '\u0645', name: 'meem',             urduName: 'میم',     codepoint: 0x0645 },
  { glyph: '\u0646', name: 'noon',             urduName: 'نون',     codepoint: 0x0646 },
  { glyph: '\u06BA', name: 'noon-ghunna',      urduName: 'نون غنہ', codepoint: 0x06BA },
  { glyph: '\u0648', name: 'wow',              urduName: 'واؤ',     codepoint: 0x0648 },
  { glyph: '\u06C1', name: 'choti-hay',        urduName: 'چھوٹی ہے', codepoint: 0x06C1 },
  { glyph: '\u06CC', name: 'choti-yay',        urduName: 'چھوٹی یے', codepoint: 0x06CC },
  { glyph: '\u06D2', name: 'bari-yay',         urduName: 'بڑی یے',  codepoint: 0x06D2 },
];

export const LETTER_INDEX: ReadonlyMap<string, UrduLetter> =
  new Map(URDU_ALPHABET.map((l) => [l.glyph, l]));

/** Do-chashmi he — builds Urdu aspirated digraphs (بھ پھ تھ …). Kept as-is. */
export const DO_CHASHMI_HAY = '\u06BE';


// ── 2. Arabic → Urdu glyph normalisation table ──────────────────────────

export const ARABIC_TO_URDU: Readonly<Record<string, string>> = {
  // alef family → ا
  '\u0622': '\u0627',  // آ
  '\u0623': '\u0627',  // أ
  '\u0625': '\u0627',  // إ
  '\u0671': '\u0627',  // ٱ
  '\u0672': '\u0627',  // ٲ
  '\u0673': '\u0627',  // ٳ
  // ya family → ی
  '\u064A': '\u06CC',  // ي
  '\u0649': '\u06CC',  // ى
  '\u06D2': '\u06CC',  // ے (mid-word)
  // kaf → ک
  '\u0643': '\u06A9',  // ك
  // ha family → ہ
  '\u0647': '\u06C1',  // ه
  '\u06C3': '\u06C1',  // ۃ
  '\u0629': '\u06C1',  // ة
  // hamza / standalone diacritics
  '\u0621': '',        // ء
  '\u0624': '\u0648',  // ؤ → و
  '\u0626': '\u06CC',  // ئ → ی
  '\u0654': '',        // hamza above (combining)
  '\u0655': '',        // hamza below (combining)
};


// ── 3. OCR confusion classes ────────────────────────────────────────────
// Letters in one row look visually alike — only dots/marks differ.

export const CONFUSION_ROWS: readonly (readonly string[])[] = [
  ['\u0628', '\u067E', '\u062A', '\u0679', '\u062B'],  // ب پ ت ٹ ث
  ['\u062C', '\u0686', '\u062D', '\u062E'],            // ج چ ح خ
  ['\u062F', '\u0688', '\u0630'],                      // د ڈ ذ
  ['\u0631', '\u0691', '\u0632', '\u0698'],            // ر ڑ ز ژ
  ['\u0633', '\u0634'],                                // س ش
  ['\u0635', '\u0636'],                                // ص ض
  ['\u0637', '\u0638'],                                // ط ظ
  ['\u0639', '\u063A'],                                // ع غ
  ['\u0641', '\u0642'],                                // ف ق
  ['\u06A9', '\u06AF'],                                // ک گ
  ['\u0646', '\u06BA'],                                // ن ں
  ['\u06CC', '\u06D2'],                                // ی ے
];


// ── 4. Strippable noise ────────────────────────────────────────────────

export const TATWEEL = '\u0640';
// Harakat (fatha/kasra/damma/shadda/sukun) + tatweel + Quranic marks.
const HARAKAT_RE = /[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g;
// Zero-width + bidi markers OCR can insert.
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;


// ── 5. Digits ──────────────────────────────────────────────────────────

export const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const DIGIT_TO_ASCII = new Map<string, string>();
for (let i = 0; i < 10; i++) {
  DIGIT_TO_ASCII.set(URDU_DIGITS[i], String(i));
  DIGIT_TO_ASCII.set(ARABIC_DIGITS[i], String(i));
}


// ── 6. Honorifics ──────────────────────────────────────────────────────

export const HONORIFICS_URDU: readonly string[] = [
  'محترم', 'محترمہ', 'جناب', 'صاحب', 'صاحبہ', 'حاجی', 'حاجن',
  'چوہدری', 'چودھری', 'راجہ', 'ملک', 'میاں', 'خان', 'شیخ', 'سید',
  'بن', 'بنت', 'ولد', 'زوجہ',
];

const HONORIFICS_LATIN_RE =
  /\b(s\/o|d\/o|w\/o|bin|binte|bint|mr|mrs|mst|miss|ch|chaudhry|raja|malik|mian|haji|sheikh|syed|khan)\b\.?/gi;


// ── 7. Public API ──────────────────────────────────────────────────────

/** Map Arabic-variant codepoints in `text` to their Urdu equivalents. */
export function toCanonicalUrdu(text: string): string {
  if (!text) return '';
  let out = text.normalize('NFC');
  out = out.replace(ZERO_WIDTH_RE, '');
  out = out.replace(HARAKAT_RE, '');
  out = out.replace(/\u0640/g, '');
  let mapped = '';
  for (const ch of out) {
    const sub = ARABIC_TO_URDU[ch];
    mapped += sub !== undefined ? sub : ch;
  }
  return mapped;
}

/** Convert Urdu/Arabic-Indic digits to ASCII 0-9. */
export function toAsciiDigits(text: string): string {
  let out = '';
  for (const ch of text) out += DIGIT_TO_ASCII.get(ch) ?? ch;
  return out;
}

/** Strip common Urdu/Latin honorifics. */
export function stripHonorifics(text: string): string {
  let out = text;
  for (const h of HONORIFICS_URDU) {
    // Escape regex metachars (none in our list today, but cheap insurance)
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|\\s)${esc}(\\s|$)`, 'g'), ' ');
  }
  out = out.replace(HONORIFICS_LATIN_RE, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * One-shot OCR name corrector — canonical Urdu spelling used for clustering,
 * fuzzy matching, and de-duplication. Mirrors `urdu_alphabet.correct_name`
 * in the Python ETL.
 */
export function correctName(text: string): string {
  if (!text) return '';
  let out = toCanonicalUrdu(text);
  out = toAsciiDigits(out);
  // honorifics first — "S/O" needs the slash intact for the regex to match.
  out = stripHonorifics(out);
  out = out.replace(/[.,()\[\]{}؛،"'`/\\|_:;!?]+/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Lower-cased canonical form for case-insensitive equality / similarity.
 * (Urdu has no case, but names may contain Latin honorifics or mixed scripts.)
 */
export function normalizeName(text: string): string {
  return correctName(text).toLowerCase();
}

// ── 8. Bigram-Dice similarity (pg_trgm equivalent) ─────────────────────

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const padded = ` ${s} `;
  for (let i = 0; i < padded.length - 1; i++) {
    const bg = padded.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient on character bigrams (0..1). */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let szA = 0; let szB = 0; let inter = 0;
  for (const v of A.values()) szA += v;
  for (const v of B.values()) szB += v;
  for (const [bg, na] of A) {
    const nb = B.get(bg);
    if (nb) inter += Math.min(na, nb);
  }
  return szA + szB === 0 ? 0 : (2 * inter) / (szA + szB);
}
