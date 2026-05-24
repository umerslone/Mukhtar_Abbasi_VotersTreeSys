import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ExportsPanel } from '@/components/ExportsPanel';
import type { VoterRow } from '@/lib/types';

export default async function ExportsPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return null;
  }

  const wardList = await prisma.voter.findMany({
    orderBy: [{ address: 'asc' }, { serial_no: 'asc' }],
    take: 20000
  });
  const dutyStaff = await prisma.voter.findMany({
    where: { is_on_duty: true },
    orderBy: [{ address: 'asc' }, { serial_no: 'asc' }],
    take: 20000
  });

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-5">
      <header className="panel flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-slate-500">Reports</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">Export Engine</h1>
        </div>
        <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold">
          Back to Dashboard
        </Link>
      </header>
      <ExportsPanel wardList={wardList as VoterRow[]} dutyStaff={dutyStaff as VoterRow[]} />
    </div>
  );
}
