import Link from 'next/link';
import Image from 'next/image';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { FamilyGroup, VoterRow } from '@/lib/types';
import { DashboardFilters } from '@/components/DashboardFilters';
import { FamilyTree } from '@/components/FamilyTree';

export const dynamic = 'force-dynamic';

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

  // ── Two-pass load so a CNIC/name search returns the WHOLE inferred family,
  //    not just the matched voter row. (Family Lookup parity.)
  let voters;
  if (query) {
    const matched = await prisma.voter.findMany({
      where: {
        OR: [
          { cnic: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: { inferred_family_id: true },
      take: 500
    });
    const familyIds = Array.from(new Set(matched.map((m) => m.inferred_family_id)));
    voters = familyIds.length
      ? await prisma.voter.findMany({
          where: {
            AND: [
              status ? { voter_status: status } : {},
              { inferred_family_id: { in: familyIds } }
            ]
          },
          orderBy: [{ block_code: 'asc' }, { address: 'asc' }, { serial_no: 'asc' }],
          take: 5000
        })
      : [];
  } else {
    voters = await prisma.voter.findMany({
      where: status ? { voter_status: status } : {},
      orderBy: [{ block_code: 'asc' }, { address: 'asc' }, { serial_no: 'asc' }],
      take: 5000
    });
  }

  const families = buildFamilies(voters as VoterRow[]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <header className="brand-header flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10 p-1 ring-1 ring-white/15">
            <Image
              src="/favicon.svg"
              alt="Smart Nigraan shield"
              fill
              sizes="56px"
              className="object-contain"
              priority
            />
          </div>
          <div>
            <p className="eyebrow">Smart Nigraan · Voter Builder</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Family Tree Tagging</h1>
            <p className="mt-1 text-sm text-slate-200/80">
              {voters.length} voters across {families.length} families
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5" dir="ltr">
              {[
                { k: 'Halqa', v: 'LA-28 Lachraat' },
                { k: 'Tehsil', v: 'Muzaffarabad' },
                { k: 'UC', v: 'Chattar Domel' },
                { k: 'Ward', v: 'Majhoi' },
                { k: 'Area', v: 'Garhi Dhopatta' }
              ].map((scope) => (
                <li
                  key={scope.k}
                  className="snvb-badge bg-white/10 text-slate-100 ring-1 ring-white/15"
                >
                  <span className="text-amber-300/90">{scope.k}</span>
                  <span className="mx-1 opacity-40">·</span>
                  <span className="font-semibold">{scope.v}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link href="/" className="nav-pill nav-pill--primary">Dashboard</Link>
          <Link href="/family-lookup" className="nav-pill nav-pill--ghost">Family Lookup</Link>
          <Link href="/blocks" className="nav-pill nav-pill--ghost">Ward / PS</Link>
          <Link href="/ingest" className="nav-pill nav-pill--ghost">Ingest</Link>
          <Link href="/duty-staff" className="nav-pill nav-pill--ghost">Duty Staff</Link>
          <Link href="/exports" className="nav-pill nav-pill--ghost">Exports</Link>
          {session.user?.role === 'ADMIN' && (
            <Link href="/admin/users" className="nav-pill nav-pill--ghost">Admin</Link>
          )}
          <Link href="/api/auth/signout" className="nav-pill nav-pill--ghost">Sign out</Link>
        </nav>
      </header>

      <DashboardFilters initialQuery={query} initialStatus={params.status ?? 'all'} />

      <FamilyTree families={families} />
    </div>
  );
}
