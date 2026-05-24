import * as XLSX from 'xlsx';
import type { DutyStaffMatchResult, DutyStaffSourceRow, VoterRecord } from './types';
import type { OfflineVoterDatabase } from './offline-db';

function normalize(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function levenshtein(left: string, right: string): number {
  const a = normalize(left);
  const b = normalize(right);

  if (a === b) {
    return 0;
  }

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let index = 0; index <= a.length; index += 1) {
    matrix[index][0] = index;
  }

  for (let index = 0; index <= b.length; index += 1) {
    matrix[0][index] = index;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
    }
  }

  return matrix[a.length][b.length];
}

async function stageOneMatch(db: OfflineVoterDatabase, cnic: string): Promise<VoterRecord | null> {
  if (!cnic) {
    return null;
  }

  const rows = await db.query<VoterRecord>("SELECT * FROM voters WHERE replace(cnic, '-', '') = ? LIMIT 1", [cnic]);
  return rows[0] ?? null;
}

async function stageTwoMatch(db: OfflineVoterDatabase, name: string, fatherHusbandName: string): Promise<VoterRecord | null> {
  if (!name || !fatherHusbandName) {
    return null;
  }

  const rows = await db.query<VoterRecord>(
    `
      SELECT * FROM voters
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
        AND LOWER(TRIM(father_husband_name)) = LOWER(TRIM(?))
      LIMIT 1
    `,
    [name, fatherHusbandName]
  );
  return rows[0] ?? null;
}

async function stageThreeMatch(db: OfflineVoterDatabase, name: string): Promise<VoterRecord | null> {
  if (!name) {
    return null;
  }

  const normalized = normalize(name);
  const prefix = normalized.slice(0, 3);
  const candidates = await db.query<VoterRecord>(
    `
      SELECT id, name, father_husband_name, cnic, block_code, serial_no, profession, age, address, inferred_family_id, voter_status, is_on_duty
      FROM voters
      WHERE ABS(LENGTH(LOWER(name)) - LENGTH(?)) <= 2
        AND (
          LOWER(name) LIKE ?
          OR LOWER(name) LIKE ?
          OR LOWER(name) LIKE ?
        )
      LIMIT 2000
    `,
    [normalized, `${prefix}%`, `%${prefix}%`, `${normalized[0] ?? ''}%`]
  );

  let best: VoterRecord | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = levenshtein(normalized, candidate.name);
    if (distance <= 2 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

export async function parseDutyStaffWorkbook(file: File): Promise<DutyStaffSourceRow[]> {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<DutyStaffSourceRow>(sheet, { defval: '' });
}

export async function matchDutyStaffRows(
  db: OfflineVoterDatabase,
  rows: DutyStaffSourceRow[]
): Promise<DutyStaffMatchResult[]> {
  const results: DutyStaffMatchResult[] = [];
  const matchedIds = new Set<number>();

  for (const [index, row] of rows.entries()) {
    const cnic = digitsOnly(row.cnic);
    const name = normalize(row.name);
    const fatherHusbandName = normalize(row.father_husband_name);

    let match = await stageOneMatch(db, cnic);
    let stage: DutyStaffMatchResult['stage'] = 'unmatched';

    if (match) {
      stage = 'cnic';
    } else {
      match = await stageTwoMatch(db, name, fatherHusbandName);
      if (match) {
        stage = 'name-father';
      } else {
        match = await stageThreeMatch(db, name);
        if (match) {
          stage = 'levenshtein';
        }
      }
    }

    if (match) {
      matchedIds.add(match.id);
      results.push({
        sourceIndex: index,
        sourceRow: row,
        voterId: match.id,
        voterName: match.name,
        stage,
        matched: true
      });
    } else {
      results.push({
        sourceIndex: index,
        sourceRow: row,
        stage: 'unmatched',
        matched: false
      });
    }
  }

  if (matchedIds.size > 0) {
    await db.markDutyStaff(Array.from(matchedIds));
  }

  return results;
}
