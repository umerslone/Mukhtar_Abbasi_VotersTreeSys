/**
 * Azure Document Intelligence → structured voter rows.
 *
 * Pure TypeScript port of the parser in `etl_pipeline/voters_etl.py` so the
 * Next.js API route can run on Vercel without any Python or Flask sidecar.
 *
 * Public surface:
 *   extractVotersFromBytes(bytes, fileName?)  →  { voters, pollingStation, tables }
 *
 * Every voter row is shaped to match the existing Prisma `Voter` model so
 * the result can be POSTed straight to `ingestVoters()`.
 */
import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
  type AnalyzeResultOutput,
  type DocumentTableOutput,
} from '@azure-rest/ai-document-intelligence';
import { createHash } from 'node:crypto';

import {
  correctName,
  toAsciiDigits,
  toCanonicalUrdu,
} from '@/lib/urdu_alphabet';
import type { IngestVoterRow } from '@/lib/ingest';

const CNIC_RE = /\b(\d{5})\s*[-–—]?\s*(\d{7})\s*[-–—]?\s*(\d)\b/;
const BLOCK_RE = /\b\d{12}\b/;
const SERIAL_RE = /^\d{1,6}$/;
const AGE_RE = /\d{1,3}/;

const ENGLISH_HEADER_ALIASES = new Set([
  'cnic',
  'name',
  'serial no',
  'serial_no',
  'block code',
  'block_code',
  'father/husband name',
  'father husband name',
  'address',
  'age',
]);

export interface OcrExtractResult {
  voters: IngestVoterRow[];
  pollingStation: string;
  totalTables: number;
  totalPages: number;
  totalVoters: number;
}

/** Build the Azure DI client from env vars. Throws if creds missing. */
function buildClient() {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) {
    throw new Error(
      'Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY in the environment.',
    );
  }
  return DocumentIntelligence(endpoint, { key });
}

/**
 * Run `prebuilt-layout` against an upload (PDF or image) and return the
 * full AnalyzeResult. Times out after `timeoutMs` (default 8 minutes).
 */
async function runLayout(bytes: Uint8Array): Promise<AnalyzeResultOutput> {
  const client = buildClient();

  // Convert to base64 — the REST SDK wants a base64-encoded string for
  // binary bodies via the standard analyze input model.
  const base64Source = Buffer.from(bytes).toString('base64');

  const initial = await client
    .path('/documentModels/{modelId}:analyze', 'prebuilt-layout')
    .post({
      contentType: 'application/json',
      body: { base64Source },
      queryParameters: { _overload: 'analyzeDocument' },
    });

  if (isUnexpected(initial)) {
    const msg =
      (initial.body as { error?: { message?: string } })?.error?.message ||
      `Azure DI returned HTTP ${initial.status}`;
    throw new Error(msg);
  }

  const poller = getLongRunningPoller(client, initial);
  const final = await poller.pollUntilDone();
  const op = final.body as AnalyzeOperationOutput;
  if (!op.analyzeResult) {
    throw new Error(
      `Azure DI returned no analyzeResult (status: ${op.status ?? 'unknown'})`,
    );
  }
  return op.analyzeResult;
}

/** Reshape a DocumentTable's cells into a dense row-major matrix. */
function tableToMatrix(table: DocumentTableOutput): string[][] {
  const rowCount = table.rowCount ?? 0;
  const colCount = table.columnCount ?? 0;
  const matrix: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => ''),
  );
  for (const cell of table.cells ?? []) {
    const r = cell.rowIndex ?? 0;
    const c = cell.columnIndex ?? 0;
    if (r >= 0 && r < rowCount && c >= 0 && c < colCount) {
      matrix[r][c] = (cell.content || '').trim();
    }
  }
  return matrix;
}

/** Column that most frequently carries a CNIC anchors row parsing. */
function findCnicColumn(matrix: string[][]): number {
  const hits: Record<number, number> = {};
  for (const row of matrix) {
    for (let i = 0; i < row.length; i++) {
      if (CNIC_RE.test(row[i] || '')) {
        hits[i] = (hits[i] || 0) + 1;
      }
    }
  }
  let best = -1;
  let max = 0;
  for (const [k, v] of Object.entries(hits)) {
    if (v > max) {
      best = Number(k);
      max = v;
    }
  }
  return best;
}

/** Detect a 12-digit polling-station / block code anywhere in the tables. */
function sniffBlockCode(tables: DocumentTableOutput[]): string {
  for (const t of tables) {
    for (const cell of t.cells ?? []) {
      const m = (cell.content || '').match(BLOCK_RE);
      if (m) return m[0];
    }
  }
  return 'UNKNOWN';
}

function familyId(father: string, blockCode: string): string {
  if (!father) return '';
  return createHash('sha1')
    .update(`${blockCode}::${father}`)
    .digest('hex')
    .slice(0, 12);
}

function normaliseCnic(raw: string): string {
  const m = toAsciiDigits(raw).match(CNIC_RE);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Header-driven path: legacy English-header tables (matches voters_etl.py). */
function parseHeaderRow(
  headers: string[],
  row: string[],
  blockCode: string,
): IngestVoterRow | null {
  const lower = headers.map((h) => (h || '').trim().toLowerCase());
  const pick = (...names: string[]): string => {
    for (const n of names) {
      const idx = lower.indexOf(n);
      if (idx >= 0) return (row[idx] || '').trim();
    }
    return '';
  };
  const serial = pick('serial no', 'serial_no', 'serial');
  const name = pick('name');
  const father = pick(
    'father/husband name',
    'father husband name',
    'father_husband_name',
    'father',
  );
  const cnicRaw = pick('cnic');
  const profession = pick('profession');
  const ageText = pick('age');
  const address = pick('address', 'house');
  const bc = pick('block code', 'block_code', 'block') || blockCode;

  const cnic = normaliseCnic(cnicRaw);
  if (!cnic && !name && !father) return null;

  const ageMatch = ageText.match(AGE_RE);
  const cleanedFather = correctName(father);
  return {
    serial_no: serial,
    name: correctName(name),
    father_husband_name: cleanedFather,
    cnic,
    profession: toCanonicalUrdu(profession),
    age: ageMatch ? Number(ageMatch[0]) : null,
    address: toCanonicalUrdu(address),
    block_code: bc,
    inferred_family_id: familyId(cleanedFather, bc),
  };
}

/** Positional path: anchor on the CNIC column. Mirrors voters_etl.py. */
function parsePositionalRow(
  row: string[],
  cnicCol: number,
  blockCode: string,
): IngestVoterRow | null {
  const get = (i: number) => (i >= 0 && i < row.length ? row[i].trim() : '');

  const cnic = normaliseCnic(get(cnicCol));
  if (!cnic) return null;

  const serial = get(cnicCol - 3);
  if (!SERIAL_RE.test(serial)) return null;

  const name = get(cnicCol - 2);
  const father = get(cnicCol - 1);
  const profession = get(cnicCol + 1);
  const ageText = get(cnicCol + 2);
  const address = get(cnicCol + 3);

  const ageMatch = ageText.match(AGE_RE);
  const cleanedFather = correctName(father);
  return {
    serial_no: serial,
    name: correctName(name),
    father_husband_name: cleanedFather,
    cnic,
    profession: toCanonicalUrdu(profession),
    age: ageMatch ? Number(ageMatch[0]) : null,
    address: toCanonicalUrdu(address),
    block_code: blockCode,
    inferred_family_id: familyId(cleanedFather, blockCode),
  };
}

/** Top-level entrypoint. */
export async function extractVotersFromBytes(
  bytes: Uint8Array,
  _fileName?: string,
): Promise<OcrExtractResult> {
  const result = await runLayout(bytes);
  const tables = (result.tables ?? []) as DocumentTableOutput[];
  const totalPages = result.pages?.length ?? 0;

  const blockCode = sniffBlockCode(tables);

  const voters: IngestVoterRow[] = [];
  for (const table of tables) {
    const matrix = tableToMatrix(table);
    if (!matrix.length || matrix[0].length < 4) continue;

    // Path A — English headers.
    const headers = matrix[0].map((c) => c.trim().toLowerCase());
    const hasEnglishHeaders = headers.some((h) => ENGLISH_HEADER_ALIASES.has(h));
    if (hasEnglishHeaders) {
      for (let i = 1; i < matrix.length; i++) {
        const rec = parseHeaderRow(matrix[0], matrix[i], blockCode);
        if (rec) voters.push(rec);
      }
      continue;
    }

    // Path B — positional, anchored on CNIC column.
    const cnicCol = findCnicColumn(matrix);
    if (cnicCol < 0) continue;
    for (const row of matrix) {
      const rec = parsePositionalRow(row, cnicCol, blockCode);
      if (rec) voters.push(rec);
    }
  }

  // Dedupe by CNIC (keep first).
  const seen = new Set<string>();
  const deduped: IngestVoterRow[] = [];
  for (const v of voters) {
    if (v.cnic && seen.has(v.cnic)) continue;
    if (v.cnic) seen.add(v.cnic);
    deduped.push(v);
  }

  return {
    voters: deduped,
    pollingStation: blockCode === 'UNKNOWN' ? '' : blockCode,
    totalTables: tables.length,
    totalPages,
    totalVoters: deduped.length,
  };
}
