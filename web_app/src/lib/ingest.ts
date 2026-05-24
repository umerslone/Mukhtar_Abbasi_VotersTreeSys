import { prisma } from './prisma';

const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export interface IngestVoterRow {
  block_code?: string | null;
  serial_no?: string | null;
  name?: string | null;
  father_husband_name?: string | null;
  cnic?: string | null;
  profession?: string | null;
  age?: number | string | null;
  address?: string | null;
  inferred_family_id?: string | null;
  gender?: string | null;
  voter_status?: string | null;
  is_on_duty?: boolean | number | string | null;
}

export interface IngestResult {
  total: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  batch: string;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function toAge(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  return false;
}

/**
 * Dedupe-safe upsert.
 *
 * Rule: a voter is uniquely identified by their CNIC. If a row with the same
 * CNIC already exists, the existing record is NEVER overwritten — instead the
 * import batch tag is appended to its `tags` array so we can audit which
 * imports a voter has appeared in. Only brand-new voters are inserted.
 *
 * This protects user-edited fields (voter_status, is_on_duty, profession, etc.)
 * from being clobbered by re-imports of the same source PDF.
 */
export async function ingestVoters(rows: IngestVoterRow[], batch: string): Promise<IngestResult> {
  const result: IngestResult = {
    total: rows.length,
    inserted: 0,
    duplicates: 0,
    invalid: 0,
    batch,
  };

  // Pre-fetch existing CNICs to minimize round trips.
  const incomingCnics = Array.from(
    new Set(
      rows
        .map((r) => toStr(r.cnic))
        .filter((c) => CNIC_RE.test(c))
    )
  );

  const existing = incomingCnics.length
    ? await prisma.voter.findMany({
        where: { cnic: { in: incomingCnics } },
        select: { id: true, cnic: true, tags: true },
      })
    : [];

  const existingByCnic = new Map(existing.map((e) => [e.cnic, e]));

  const toCreate: Array<{
    block_code: string;
    serial_no: string;
    name: string;
    father_husband_name: string;
    cnic: string;
    profession: string;
    age: number | null;
    address: string;
    inferred_family_id: string;
    voter_status: string;
    is_on_duty: boolean;
    tags: string[];
    source_batch: string;
  }> = [];

  const tagUpdates: Array<{ id: string; tags: string[] }> = [];

  // Track CNICs seen in this batch to dedupe within the file itself.
  const seenInBatch = new Set<string>();

  for (const raw of rows) {
    const cnic = toStr(raw.cnic);
    const name = toStr(raw.name);
    const block_code = toStr(raw.block_code) || 'UNKNOWN';
    const serial_no = toStr(raw.serial_no);

    // Minimum data required: must have a name AND (a valid CNIC OR a serial+block).
    const hasValidCnic = CNIC_RE.test(cnic);
    if (!name || (!hasValidCnic && !serial_no)) {
      result.invalid++;
      continue;
    }

    // Dedupe key: CNIC if valid, else block+serial+name (fallback for OCR misses).
    const dedupeKey = hasValidCnic ? cnic : `${block_code}|${serial_no}|${name}`;

    // Already saw this voter earlier in the same upload — count as duplicate.
    if (seenInBatch.has(dedupeKey)) {
      result.duplicates++;
      continue;
    }
    seenInBatch.add(dedupeKey);

    // Already in DB — append batch tag, do NOT touch other fields.
    if (hasValidCnic && existingByCnic.has(cnic)) {
      const existingRow = existingByCnic.get(cnic)!;
      if (!existingRow.tags.includes(batch)) {
        tagUpdates.push({ id: existingRow.id, tags: [...existingRow.tags, batch] });
      }
      result.duplicates++;
      continue;
    }

    toCreate.push({
      block_code,
      serial_no: serial_no || '0',
      name,
      father_husband_name: toStr(raw.father_husband_name),
      cnic: hasValidCnic ? cnic : '',
      profession: toStr(raw.profession),
      age: toAge(raw.age),
      address: toStr(raw.address),
      inferred_family_id: toStr(raw.inferred_family_id) || `${block_code}-${serial_no || name}`,
      voter_status: toStr(raw.voter_status) || 'Unsurveyed',
      is_on_duty: toBool(raw.is_on_duty),
      tags: [batch],
      source_batch: batch,
    });
  }

  if (toCreate.length) {
    const created = await prisma.voter.createMany({ data: toCreate });
    result.inserted = created.count;
  }

  // Batch-tag existing rows that re-appeared in this import.
  if (tagUpdates.length) {
    await prisma.$transaction(
      tagUpdates.map((u) =>
        prisma.voter.update({ where: { id: u.id }, data: { tags: u.tags } })
      )
    );
  }

  return result;
}

/** Minimal CSV parser supporting quoted values and commas inside quotes. */
export function parseCsv(text: string): IngestVoterRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const headers = parseLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows: IngestVoterRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? '';
    });
    rows.push(obj as IngestVoterRow);
  }
  return rows;
}
