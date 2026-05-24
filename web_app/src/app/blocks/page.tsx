import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { VoterRow } from '@/lib/types';
import { BlockList } from '@/components/BlockList';

export const dynamic = 'force-dynamic';

export default async function BlocksPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const voters = await prisma.voter.findMany({
    orderBy: [{ block_code: 'asc' }, { serial_no: 'asc' }],
    take: 20000,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <header className="panel flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-slate-500">Voter Management SaaS</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">Ward / Polling Station</h1>
          <p className="mt-1 text-sm text-slate-500">
            {voters.length} voters — click any voter to tag as Supporter, Non-Supporter, or Undecided.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm font-semibold">
          <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Dashboard</Link>
          <Link href="/blocks" className="rounded-full bg-slate-900 px-4 py-2 text-white">Ward / PS</Link>
          <Link href="/ingest" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Ingest</Link>
          <Link href="/duty-staff" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Duty Staff</Link>
          <Link href="/exports" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Exports</Link>
        </nav>
      </header>

      <BlockList voters={voters as VoterRow[]} />
    </div>
  );
}
