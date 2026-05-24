'use server';

import { revalidatePath } from 'next/cache';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import type { VoterStatus } from '@/lib/types';

const ALLOWED_STATUSES: VoterStatus[] = ['Supporter', 'Non-Supporter', 'Undecided', 'Unsurveyed'];

export async function updateVoterStatus(id: string, status: VoterStatus): Promise<void> {
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new Error('Invalid voter status.');
  }
  await prisma.voter.update({ where: { id }, data: { voter_status: status } });
  revalidatePath('/');
  revalidatePath('/blocks');
}

interface DutyMatchResult {
  totalRows: number;
  matched: number;
}

export async function matchDutyStaff(formData: FormData): Promise<DutyMatchResult> {
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
