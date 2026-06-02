'use server';

import { revalidatePath } from 'next/cache';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/permissions';
import type { VoterStatus } from '@/lib/types';

const ALLOWED_STATUSES: VoterStatus[] = ['Supporter', 'Non-Supporter', 'Undecided', 'Unsurveyed'];

export async function updateVoterStatus(id: string, status: VoterStatus): Promise<void> {
  await requireRole('EDITOR');
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new Error('Invalid voter status.');
  }
  await prisma.voter.update({ where: { id }, data: { voter_status: status } });
  revalidatePath('/');
  revalidatePath('/blocks');
  revalidatePath('/family-lookup');
}

// ── Family relationship overrides ─────────────────────────────────────
const ALLOWED_DECISIONS = ['confirmed', 'rejected'] as const;
type FamilyDecision = (typeof ALLOWED_DECISIONS)[number];

export async function setFamilyOverride(
  egoVoterId: string,
  memberVoterId: string,
  decision: FamilyDecision,
  relationHint?: string,
): Promise<void> {
  await requireRole('EDITOR');
  if (!ALLOWED_DECISIONS.includes(decision)) {
    throw new Error('Invalid family override decision.');
  }
  if (egoVoterId === memberVoterId) {
    throw new Error('Cannot override a voter against themselves.');
  }
  await prisma.familyOverride.upsert({
    where: { ego_voter_id_member_voter_id: { ego_voter_id: egoVoterId, member_voter_id: memberVoterId } },
    create: { ego_voter_id: egoVoterId, member_voter_id: memberVoterId, decision, relation_hint: relationHint },
    update: { decision, relation_hint: relationHint },
  });
  revalidatePath('/family-lookup');
}

export async function clearFamilyOverride(egoVoterId: string, memberVoterId: string): Promise<void> {
  await requireRole('EDITOR');
  await prisma.familyOverride.deleteMany({
    where: { ego_voter_id: egoVoterId, member_voter_id: memberVoterId },
  });
  revalidatePath('/family-lookup');
}

// ── Inline name correction (OCR fix-ups) ──────────────────────────────
export interface NameCorrectionResult {
  updated: boolean;
  cascaded: number;
}

export async function updateVoterNames(
  voterId: string,
  patch: {
    name?: string;
    father_husband_name?: string;
  },
  cascadeFatherToFamily = false,
): Promise<NameCorrectionResult> {
  await requireRole('EDITOR');
  const cleaned: { name?: string; father_husband_name?: string } = {};
  if (typeof patch.name === 'string') {
    const v = patch.name.trim();
    if (v) cleaned.name = v;
  }
  if (typeof patch.father_husband_name === 'string') {
    cleaned.father_husband_name = patch.father_husband_name.trim();
  }
  if (Object.keys(cleaned).length === 0) {
    return { updated: false, cascaded: 0 };
  }

  const before = await prisma.voter.findUnique({
    where: { id: voterId },
    select: { id: true, father_husband_name: true, inferred_family_id: true },
  });
  if (!before) {
    throw new Error('Voter not found.');
  }

  await prisma.voter.update({ where: { id: voterId }, data: cleaned });

  let cascaded = 0;
  if (
    cascadeFatherToFamily &&
    typeof cleaned.father_husband_name === 'string' &&
    cleaned.father_husband_name !== before.father_husband_name &&
    before.father_husband_name.trim().length > 0
  ) {
    const res = await prisma.voter.updateMany({
      where: {
        inferred_family_id: before.inferred_family_id,
        father_husband_name: before.father_husband_name,
        id: { not: voterId },
      },
      data: { father_husband_name: cleaned.father_husband_name },
    });
    cascaded = res.count;
  }

  revalidatePath('/');
  revalidatePath('/family-lookup');
  revalidatePath('/blocks');
  return { updated: true, cascaded };
}

interface DutyMatchResult {
  totalRows: number;
  matched: number;
}

export async function matchDutyStaff(formData: FormData): Promise<DutyMatchResult> {
  await requireRole('EDITOR');
  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new Error('No file uploaded.');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const matchedIds = new Set<string>();

  for (const row of rows) {
    const cnic = String(row.cnic ?? '').replace(/\D/g, '');
    const name = String(row.name ?? '').trim();
    const fatherHusband = String(row.father_husband_name ?? '').trim();

    let voter = null;
    if (cnic) {
      voter = await prisma.voter.findFirst({
        where: { cnic: { contains: cnic, mode: 'insensitive' } },
        select: { id: true }
      });
    }
    if (!voter && name && fatherHusband) {
      voter = await prisma.voter.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          father_husband_name: { equals: fatherHusband, mode: 'insensitive' }
        },
        select: { id: true }
      });
    }

    if (voter) {
      matchedIds.add(voter.id);
    }
  }

  if (matchedIds.size) {
    await prisma.voter.updateMany({
      where: { id: { in: Array.from(matchedIds) } },
      data: { is_on_duty: true }
    });
  }

  revalidatePath('/');
  revalidatePath('/duty-staff');
  return { totalRows: rows.length, matched: matchedIds.size };
}
