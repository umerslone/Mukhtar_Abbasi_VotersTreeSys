import { prisma } from './prisma';
import { formatCnic, normalizeCnicKey } from './cnic';

const NAME_HAS_LETTER_RE = /[A-Za-z\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const STR_LIMITS = {
  block_code: 32,
  serial_no: 32,
  name: 255,
  father_husband_name: 255,
  cnic: 15,
  profession: 100,
  address: 500,
  inferred_family_id: 255,
  voter_status: 64,
} as const;

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
  afterBatchDedupe?: number;
  droppedNoCnic?: number;
  droppedBadName?: number;
  truncatedFields?: number;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function toAge(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n >= 1 && n <= 120 ? n : null;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  return false;
}

function truncateField<K extends keyof typeof STR_LIMITS>(field: K, value: string): { value: string; truncated: boolean } {
  const limit = STR_LIMITS[field];
  if (value.length <= limit) return { value, truncated: false };
  return { value: value.slice(0, limit), truncated: true };
}

/**
 * Dedupe-safe upsert.
 *
 * Rule: a voter is uniquely identified by their normalized 13-digit CNIC key.
 * If a row with the same CNIC already exists, the existing record is NEVER
 * overwritten — instead the
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
    afterBatchDedupe: 0,
    droppedNoCnic: 0,
    droppedBadName: 0,
    truncatedFields: 0,
  };

  const toCreate: Array<{
    block_code: string;
    serial_no: string;
    name: string;
    father_husband_name: string;
    cnic: string;
    cnic_key: string;
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

  const incomingKeys = Array.from(
    new Set(rows.map((r) => normalizeCnicKey(r.cnic)).filter((key): key is string => Boolean(key))),
  );

  const displayCnics = incomingKeys.flatMap((key) => [key, formatCnic(key)]);
  const existing = incomingKeys.length
    ? await prisma.voter.findMany({
        where: {
          OR: [
            { cnic_key: { in: incomingKeys } },
            { cnic: { in: displayCnics } },
          ],
        },
        select: { id: true, cnic: true, cnic_key: true, tags: true },
      })
    : [];
  const existingByKey = new Map(
    existing
      .map((e) => [e.cnic_key ?? normalizeCnicKey(e.cnic), e] as const)
      .filter((entry): entry is readonly [string, typeof existing[number]] => Boolean(entry[0])),
  );

  for (const raw of rows) {
    const key = normalizeCnicKey(raw.cnic);
    if (!key) {
      result.invalid++;
      result.droppedNoCnic = (result.droppedNoCnic ?? 0) + 1;
      continue;
    }

    const nameRaw = toStr(raw.name);
    if (!nameRaw || !NAME_HAS_LETTER_RE.test(nameRaw)) {
      result.invalid++;
      result.droppedBadName = (result.droppedBadName ?? 0) + 1;
      continue;
    }

    // Already saw this voter earlier in the same upload — count as duplicate.
    if (seenInBatch.has(key)) {
      result.duplicates++;
      continue;
    }
    seenInBatch.add(key);
    result.afterBatchDedupe = (result.afterBatchDedupe ?? 0) + 1;

    // Already in DB — append batch tag, do NOT touch other fields.
    if (existingByKey.has(key)) {
      const existingRow = existingByKey.get(key)!;
      if (!existingRow.tags.includes(batch)) {
        tagUpdates.push({ id: existingRow.id, tags: [...existingRow.tags, batch] });
      }
      result.duplicates++;
      continue;
    }

    const fields = {
      block_code: toStr(raw.block_code) || 'UNKNOWN',
      serial_no: toStr(raw.serial_no) || '0',
      name: nameRaw,
      father_husband_name: toStr(raw.father_husband_name),
      cnic: formatCnic(key),
      profession: toStr(raw.profession),
      address: toStr(raw.address),
      inferred_family_id: toStr(raw.inferred_family_id),
      voter_status: toStr(raw.voter_status) || 'Unsurveyed',
    };
    if (!fields.inferred_family_id) fields.inferred_family_id = `${fields.block_code}-${fields.serial_no || fields.name}`;

    const truncated = Object.fromEntries(
      Object.entries(fields).map(([field, value]) => {
        const next = truncateField(field as keyof typeof STR_LIMITS, value);
        if (next.truncated) result.truncatedFields = (result.truncatedFields ?? 0) + 1;
        return [field, next.value];
      }),
    ) as typeof fields;

    toCreate.push({
      block_code: truncated.block_code,
      serial_no: truncated.serial_no,
      name: truncated.name,
      father_husband_name: truncated.father_husband_name,
      cnic: truncated.cnic,
      cnic_key: key,
      profession: truncated.profession,
      age: toAge(raw.age),
      address: truncated.address,
      inferred_family_id: truncated.inferred_family_id,
      voter_status: truncated.voter_status,
      is_on_duty: toBool(raw.is_on_duty),
      tags: [batch],
      source_batch: batch,
    });
  }

  if (toCreate.length) {
    const created = await prisma.voter.createMany({ data: toCreate, skipDuplicates: true });
    result.inserted = created.count;
    result.duplicates += toCreate.length - created.count;
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
