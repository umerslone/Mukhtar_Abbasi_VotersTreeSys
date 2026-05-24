import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { FamilyGroup, VoterRow } from '@/lib/types';
import { DashboardFilters } from '@/components/DashboardFilters';
import { FamilyTree } from '@/components/FamilyTree';

interface SearchParams {
  q?: string;
  status?: string;
}

function statusFilter(status: string | undefined): string | undefined {
  if (!status || status === 'all') {
    return undefined;
  }
  return status;
}

function buildFamilies(voters: VoterRow[]): FamilyGroup[] {
  const grouped = new Map<string, FamilyGroup>();
  for (const voter of voters) {
    const key = voter.inferred_family_id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        inferred_family_id: key,
        block_code: voter.block_code,
        address: voter.address,
        members: []
      });
    }
    grouped.get(key)!.members.push(voter);
  }

  return Array.from(grouped.values()).sort((left, right) => right.members.length - left.members.length);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return null;
  }

  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const status = statusFilter(params.status);

  const voters = await prisma.voter.findMany({
    where: {
      AND: [
        status ? { voter_status: status } : {},
        query
          ? {
              OR: [
                { cnic: { contains: query, mode: 'insensitive' } },
                { name: { contains: query, mode: 'insensitive' } }
              ]
            }
          : {}
      ]
    },
    orderBy: [{ block_code: 'asc' }, { address: 'asc' }, { serial_no: 'asc' }],
    take: 5000
  });

  const families = buildFamilies(voters as VoterRow[]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <header className="panel flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-slate-500">Voter Management SaaS</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">Family Tree Tagging</h1>
          <p className="mt-1 text-sm text-slate-500">{voters.length} voters across {families.length} families</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm font-semibold">
          <Link href="/" className="rounded-full bg-slate-900 px-4 py-2 text-white">Dashboard</Link>
          <Link href="/blocks" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Ward / PS</Link>
          <Link href="/ingest" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Ingest</Link>
          <Link href="/duty-staff" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Duty Staff</Link>
          <Link href="/exports" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Exports</Link>
          <Link href="/api/auth/signout" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Sign out</Link>
        </nav>
      </header>

      <DashboardFilters initialQuery={query} initialStatus={params.status ?? 'all'} />

      <FamilyTree families={families} />
    </div>
  );
}
