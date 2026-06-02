/**
 * 🌳 Family Lookup — focused, voter-centric view.
 *
 * Ported from the SmartNigranVoter Streamlit dashboard
 * (`dashboard/pages/3_Family_Lookup.py`). Search by CNIC or fuzzy Urdu
 * name, see the resolved voter's identity card, household composition
 * chips, and a hierarchical family tree (with the searched voter
 * highlighted) plus a sectioned list (Elders / Siblings / This voter /
 * Children / Grandchildren).
 */
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { FamilyTree } from '@/components/FamilyTree';
import { FamilyLookupTabs } from '@/components/FamilyLookupTabs';
import { formatCnic, normalizeCnicKey } from '@/lib/cnic';
import {
  FamilyOverridesEditor,
  VoterNameEditor,
} from '@/components/FamilyLookupEditors';
import { nameSimilarity, normalizeName } from '@/lib/urdu_alphabet';
import type { FamilyGroup, VoterRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PARENT_SIM = 0.55;

interface SearchParams {
  q?: string;
  ego?: string;
}

function isMale(v: VoterRow): boolean {
  const g = (v.gender || '').toLowerCase();
  return g.startsWith('m') || g.includes('male') || g.includes('مرد');
}

/** Gender-aware Urdu kinship-prefix label for a voter's father/husband name. */
function kinshipPrefix(v: VoterRow): string {
  // Males never have a husband; show only "father".
  return isMale(v) ? 'والد' : 'والد/شوہر';
}

// Tighter threshold for sibling/grandchild edges where many household-blocks
// share common given-names (شاہ، علی، حسین) — keeps Dice-bigram noise out.
const STRICT_SIM = 0.75;
const TOKEN_SIM = 0.85;

// Spouse-of markers OCR'd at the start of a female voter's father_husband_name.
// "زوج"/"زوجہ"/"ونشر"/"ذوب" all read as variants of "spouse of" before the
// actual husband name. Strip them so similarity doesn't include the noise token.
const SPOUSE_MARKERS = /^(?:زوج(?:ہ|ۃ|ه)?|زوجة|ونشر|ذوب|ذوج|wife of|w\/o)\s+/iu;

function cleanRelative(raw: string): string {
  const n = normalizeName(raw || '');
  return n.replace(SPOUSE_MARKERS, '').trim();
}

/**
 * Stricter name-match for family edges: bigram-Dice on the full name AND
 * on the LAST token (surname-ish). Both must clear thresholds — this is
 * what excludes false matches like "عبد المجيد" vs "عبد الرشيد" (whole
 * Dice ~0.67 but last-token Dice ~0.5).
 */
function nameMatch(a: string, b: string, fullThreshold = STRICT_SIM, tokenThreshold = TOKEN_SIM): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (nameSimilarity(a, b) < fullThreshold) return false;
  const at = a.split(/\s+/).filter(Boolean);
  const bt = b.split(/\s+/).filter(Boolean);
  if (!at.length || !bt.length) return false;
  const lastA = at[at.length - 1];
  const lastB = bt[bt.length - 1];
  // Last token must look like the same word (handles OCR ي/ی drift).
  if (lastA.length < 3 || lastB.length < 3) {
    return lastA === lastB;
  }
  return nameSimilarity(lastA, lastB) >= tokenThreshold;
}

/**
 * Dynamically discover ego's household by fuzzy-matching names within the
 * same polling-block, instead of relying on the stored `inferred_family_id`
 * (which the ETL only groups by exact (block_code, address) tuple — fragile
 * because OCR introduces small address-spelling variants).
 *
 * Strategy: only walk first-degree edges from ego, then one hop down to
 * grandchildren. Never expand via parent.father_husband_name (uncles/aunts) —
 * that produces a runaway cascade across the block.
 */
async function discoverFamily(ego: VoterRow): Promise<VoterRow[]> {
  const pool = (await prisma.voter.findMany({
    where: ego.block_code ? { block_code: ego.block_code } : {},
    orderBy: [{ block_code: 'asc' }, { serial_no: 'asc' }],
    take: 2000,
  })) as VoterRow[];

  const egoName = normalizeName(ego.name);
  const egoFather = cleanRelative(ego.father_husband_name);

  // Parent: at most one in roll. Pick the single best name match to ego.father.
  let parent: VoterRow | null = null;
  if (egoFather) {
    let bestSim = TOKEN_SIM;
    for (const m of pool) {
      if (m.id === ego.id) continue;
      const mn = normalizeName(m.name);
      if (!nameMatch(mn, egoFather)) continue;
      const sim = nameSimilarity(mn, egoFather);
      if (sim >= bestSim) {
        bestSim = sim;
        parent = m;
      }
    }
  }

  // Siblings share ego's father string (after stripping spouse-markers).
  const siblings = pool.filter(
    (m) =>
      m.id !== ego.id &&
      m.id !== parent?.id &&
      egoFather &&
      nameMatch(cleanRelative(m.father_husband_name), egoFather),
  );

  // Children: voters whose (cleaned) father string matches ego's name.
  const children = pool.filter(
    (m) =>
      m.id !== ego.id &&
      m.id !== parent?.id &&
      egoName &&
      nameMatch(cleanRelative(m.father_husband_name), egoName),
  );
  const childIds = new Set(children.map((c) => c.id));
  const childKeys = children.map((c) => normalizeName(c.name)).filter((s) => s.length >= 4);

  // Grandchildren: father matches a child's name.
  const grandchildren = pool.filter(
    (m) =>
      m.id !== ego.id &&
      m.id !== parent?.id &&
      !childIds.has(m.id) &&
      childKeys.some((ck) => nameMatch(cleanRelative(m.father_husband_name), ck)),
  );

  const seen = new Set<string>([ego.id]);
  const out: VoterRow[] = [ego];
  const push = (v: VoterRow | null) => {
    if (v && !seen.has(v.id)) {
      seen.add(v.id);
      out.push(v);
    }
  };
  push(parent);
  siblings.forEach(push);
  children.forEach(push);
  grandchildren.forEach(push);
  return out;
}

function statusPalette(status: string) {
  switch (status) {
    case 'Supporter':
      return { icon: '🟢', label: 'Supporter', color: '#2E7D32' };
    case 'Non-Supporter':
      return { icon: '🔴', label: 'Opposition', color: '#C62828' };
    case 'Undecided':
      return { icon: '⚪', label: 'Undecided', color: '#757575' };
    default:
      return { icon: '⚫', label: 'Unsurveyed', color: '#9E9E9E' };
  }
}

/** Sort by age (oldest first), unknown ages last. */
function byAgeDesc(a: VoterRow, b: VoterRow) {
  return (b.age ?? -1) - (a.age ?? -1);
}

/**
 * Bucket the family around `ego` into Streamlit-style sections.
 *   - elders     : members whose name fuzzy-matches ego.father_husband_name
 *                  (parent) PLUS members whose father fuzzy-matches the
 *                  parent's father (uncles/aunts).
 *   - siblings   : non-ego members sharing ego.father_husband_name.
 *   - children   : members whose father fuzzy-matches ego.name.
 *   - grandkids  : members whose father fuzzy-matches any child's name.
 */
function bucketFamily(ego: VoterRow, members: VoterRow[]) {
  const egoName = normalizeName(ego.name);
  const egoFather = normalizeName(ego.father_husband_name);
  const others = members.filter((m) => m.id !== ego.id);

  const parents = others.filter(
    (m) => egoFather && nameSimilarity(normalizeName(m.name), egoFather) >= PARENT_SIM,
  );
  const parentIds = new Set(parents.map((p) => p.id));

  const siblings = others.filter(
    (m) =>
      !parentIds.has(m.id) &&
      egoFather &&
      nameSimilarity(normalizeName(m.father_husband_name), egoFather) >= PARENT_SIM,
  );
  const siblingIds = new Set(siblings.map((s) => s.id));

  const children = others.filter(
    (m) =>
      !parentIds.has(m.id) &&
      !siblingIds.has(m.id) &&
      egoName &&
      nameSimilarity(normalizeName(m.father_husband_name), egoName) >= PARENT_SIM,
  );
  const childIds = new Set(children.map((c) => c.id));
  const childKeys = children.map((c) => normalizeName(c.name)).filter(Boolean);

  const grandchildren = others.filter(
    (m) =>
      !parentIds.has(m.id) &&
      !siblingIds.has(m.id) &&
      !childIds.has(m.id) &&
      childKeys.some(
        (ck) => nameSimilarity(normalizeName(m.father_husband_name), ck) >= PARENT_SIM,
      ),
  );
  const grandIds = new Set(grandchildren.map((g) => g.id));

  // Anyone left over (cousins / unrelated co-resident) — show in "Other"
  const others_rest = others.filter(
    (m) =>
      !parentIds.has(m.id) &&
      !siblingIds.has(m.id) &&
      !childIds.has(m.id) &&
      !grandIds.has(m.id),
  );

  // Uncles/aunts: of the "others_rest", those that share a father with one of
  // the parents. (Only meaningful when a parent is present in the roll.)
  let unclesAunts: VoterRow[] = [];
  if (parents.length) {
    const parentFatherKeys = parents
      .map((p) => normalizeName(p.father_husband_name))
      .filter(Boolean);
    unclesAunts = others_rest.filter((m) =>
      parentFatherKeys.some(
        (pf) => nameSimilarity(normalizeName(m.father_husband_name), pf) >= PARENT_SIM,
      ),
    );
  }
  const uncleIds = new Set(unclesAunts.map((u) => u.id));
  const otherRel = others_rest.filter((m) => !uncleIds.has(m.id));

  parents.sort(byAgeDesc);
  unclesAunts.sort(byAgeDesc);
  siblings.sort(byAgeDesc);
  children.sort(byAgeDesc);
  grandchildren.sort(byAgeDesc);
  otherRel.sort(byAgeDesc);

  return { parents, unclesAunts, siblings, children, grandchildren, others: otherRel };
}

/** One row in the sectioned list view (re-uses the panel/snvb styles). */
function VoterRowCard({ voter, badge }: { voter: VoterRow; badge?: string }) {
  const p = statusPalette(voter.voter_status);
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="urdu rtl text-base font-bold text-slate-900" dir="rtl">
            {voter.name || '(no name)'}
          </span>
          {badge ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              {badge}
            </span>
          ) : null}
          {voter.is_on_duty ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              🎖️ Duty
            </span>
          ) : null}
        </div>
        {voter.father_husband_name ? (
          <div className="urdu rtl mt-0.5 text-xs text-slate-600" dir="rtl">
            {kinshipPrefix(voter)}: {voter.father_husband_name}
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500" dir="ltr">
          <span>CNIC: {voter.cnic || '—'}</span>
          {voter.age != null ? <span>· {voter.age}y</span> : null}
          {voter.gender ? <span>· {voter.gender}</span> : null}
          <span>· {voter.block_code}</span>
        </div>
      </div>
      <div className="shrink-0 text-right text-xs font-bold" style={{ color: p.color }}>
        {p.icon} {p.label}
      </div>
    </div>
  );
}

function Section({
  title,
  members,
  egoBadge,
}: {
  title: string;
  members: VoterRow[];
  egoBadge?: string;
}) {
  if (members.length === 0) return null;
  return (
    <div className="panel p-4">
      <h4 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-700">
        {title} · {members.length}
      </h4>
      <div className="grid gap-2 md:grid-cols-2">
        {members.map((m) => (
          <VoterRowCard key={m.id} voter={m} badge={egoBadge && members.length === 1 ? egoBadge : undefined} />
        ))}
      </div>
    </div>
  );
}

function summaryChip(label: string, n: number) {
  const active = n > 0;
  return (
    <span
      key={label}
      className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold"
      style={{
        background: active ? '#E8F5E9' : '#F5F5F5',
        borderColor: active ? '#A5D6A7' : '#E0E0E0',
        color: active ? '#2E7D32' : '#9E9E9E',
      }}
    >
      {label}: <b>{n}</b>
    </span>
  );
}

export default async function FamilyLookupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/login');
  }

  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const queryCnicKey = normalizeCnicKey(query);
  const egoIdParam = params.ego?.trim() || null;

  // ── Resolve candidate voters from the search box ────────────────────
  let matches: VoterRow[] = [];
  if (query) {
    matches = (await prisma.voter.findMany({
      where: {
        OR: [
          ...(queryCnicKey ? [{ cnic_key: queryCnicKey }, { cnic: { contains: formatCnic(queryCnicKey), mode: 'insensitive' as const } }] : []),
          { cnic: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ block_code: 'asc' }, { serial_no: 'asc' }],
      take: 25,
    })) as VoterRow[];
  }

  // Determine the focused voter (ego).
  let ego: VoterRow | null = null;
  if (egoIdParam) {
    ego = (await prisma.voter.findUnique({ where: { id: egoIdParam } })) as VoterRow | null;
  } else if (matches.length === 1) {
    ego = matches[0];
  }

  // Discover the household dynamically via fuzzy name matching within the
  // same polling-block. The stored `inferred_family_id` is unreliable because
  // ETL only groups exact (block_code, address) tuples — OCR introduces tiny
  // address-spelling variants that fragment real families into singletons.
  let familyMembers: VoterRow[] = [];
  let overrides: Record<string, 'confirmed' | 'rejected'> = {};
  if (ego) {
    familyMembers = await discoverFamily(ego);

    const ovs = await prisma.familyOverride.findMany({
      where: { ego_voter_id: ego.id },
      select: { member_voter_id: true, decision: true },
    });
    overrides = Object.fromEntries(
      ovs.map((o) => [o.member_voter_id, o.decision as 'confirmed' | 'rejected']),
    );
  }

  // Apply rejections: drop rejected members from BOTH the tree-view family
  // group and the bucket computation so the operator sees a clean view.
  const rejectedIds = new Set(
    Object.entries(overrides)
      .filter(([, d]) => d === 'rejected')
      .map(([id]) => id),
  );
  const visibleMembers = ego
    ? familyMembers.filter((m) => m.id === ego.id || !rejectedIds.has(m.id))
    : familyMembers;

  const familyGroup: FamilyGroup | null = ego
    ? {
        inferred_family_id: ego.inferred_family_id,
        block_code: ego.block_code,
        address: ego.address,
        members: visibleMembers,
      }
    : null;

  const buckets = ego ? bucketFamily(ego, visibleMembers) : null;

  // Flat list of inferred members for the confirm/reject editor + count of
  // siblings sharing the ego's exact OLD father-name string (for cascade UI).
  const inferredList = ego && buckets
    ? [
        ...buckets.parents.map((v) => ({ voter: v, relation: 'parent' })),
        ...buckets.unclesAunts.map((v) => ({ voter: v, relation: 'uncle/aunt' })),
        ...buckets.siblings.map((v) => ({ voter: v, relation: 'sibling' })),
        ...buckets.children.map((v) => ({ voter: v, relation: 'child' })),
        ...buckets.grandchildren.map((v) => ({ voter: v, relation: 'grandchild' })),
        ...buckets.others.map((v) => ({ voter: v, relation: 'other' })),
      ]
    : [];
  const siblingsSharingFatherName = ego
    ? familyMembers.filter(
        (m) =>
          m.id !== ego.id &&
          m.father_husband_name.trim() === ego.father_husband_name.trim() &&
          ego.father_husband_name.trim().length > 0,
      ).length
    : 0;

  // ── Page chrome ─────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5">
      <header className="brand-header flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white/10 p-1 ring-1 ring-white/15">
            <Image src="/favicon.svg" alt="Smart Nigraan shield" fill sizes="56px" className="object-contain" priority />
          </div>
          <div>
            <p className="eyebrow">Smart Nigraan · Voter Builder</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">🌳 Family Lookup</h1>
            <p className="mt-1 text-sm text-slate-200/80">
              Trace a voter&apos;s full inferred family — search by CNIC or fuzzy Urdu name.
            </p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link href="/" className="nav-pill nav-pill--ghost">Dashboard</Link>
          <Link href="/family-lookup" className="nav-pill nav-pill--primary">Family Lookup</Link>
          <Link href="/blocks" className="nav-pill nav-pill--ghost">Ward / PS</Link>
          <Link href="/ingest" className="nav-pill nav-pill--ghost">Ingest</Link>
          <Link href="/duty-staff" className="nav-pill nav-pill--ghost">Duty Staff</Link>
          <Link href="/exports" className="nav-pill nav-pill--ghost">Exports</Link>
          {session.user?.role === 'ADMIN' && (
            <Link href="/admin/users" className="nav-pill nav-pill--ghost">Admin</Link>
          )}
        </nav>
      </header>

      {/* Search form */}
      <form action="/family-lookup" method="GET" className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="q" className="block text-xs font-bold uppercase tracking-wider text-slate-600">
            Search voter (CNIC digits or Urdu name)
          </label>
          <input
            id="q"
            name="q"
            defaultValue={query}
            placeholder="e.g. 8210112345671  •  عبد الرشید  •  Abdul Rasheed"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-indigo-700 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-800"
        >
          🔍 Search
        </button>
      </form>

      {/* Empty state */}
      {!query && !ego ? (
        <div className="panel p-6 text-center text-slate-600">
          <p className="text-sm">Type a CNIC or any spelling of an Urdu name above to see the full inferred family network for that voter.</p>
        </div>
      ) : null}

      {/* Multi-match picker */}
      {query && !ego && matches.length > 1 ? (
        <div className="panel p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            {matches.length} voters matched <span className="font-mono text-indigo-700">&ldquo;{query}&rdquo;</span> — pick one:
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {matches.map((m) => {
              const p = statusPalette(m.voter_status);
              return (
                <Link
                  key={m.id}
                  href={`/family-lookup?q=${encodeURIComponent(query)}&ego=${encodeURIComponent(m.id)}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-indigo-400 hover:bg-indigo-50/40"
                >
                  <div className="min-w-0">
                    <div className="urdu rtl text-base font-bold text-slate-900" dir="rtl">
                      {m.name || '(no name)'}
                    </div>
                    {m.father_husband_name ? (
                      <div className="urdu rtl text-xs text-slate-500" dir="rtl">
                        {kinshipPrefix(m)}: {m.father_husband_name}
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500" dir="ltr">
                      <span>CNIC: {m.cnic || '—'}</span>
                      {m.age != null ? <span>· {m.age}y</span> : null}
                      <span>· {m.block_code}</span>
                    </div>
                  </div>
                  <span className="shrink-0 text-right text-xs font-bold" style={{ color: p.color }}>
                    {p.icon}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* No matches */}
      {query && !ego && matches.length === 0 ? (
        <div className="panel p-6 text-center text-slate-600">
          <p className="text-sm">No voters matched <span className="font-mono text-indigo-700">&ldquo;{query}&rdquo;</span>. Try fewer characters or a different spelling.</p>
        </div>
      ) : null}

      {/* Ego identity card + tree/list */}
      {ego && familyGroup && buckets ? (
        <>
          <EgoCard ego={ego} memberCount={visibleMembers.length} />
          <VoterNameEditor voter={ego} siblingsSharingFatherName={siblingsSharingFatherName} />
          <SummaryChips ego={ego} buckets={buckets} />
          <FamilyLookupTabs
            tree={
              visibleMembers.length <= 1 ? (
                <div className="panel p-6 text-center text-slate-600">
                  <p className="text-sm">
                    🌱 <b>No other relatives inferred for this voter.</b> The OCR pass found
                    nobody else sharing the father-name in this block. Try a more common
                    surname or run another voter list ingest.
                  </p>
                </div>
              ) : (
                <FamilyTree families={[familyGroup]} egoId={ego.id} />
              )
            }
            list={
              <div className="space-y-3">
                <Section title="👴 Elders (parent + uncles/aunts)" members={[...buckets.parents, ...buckets.unclesAunts]} />
                <Section title="👬 Siblings" members={buckets.siblings} />
                <div className="panel p-4">
                  <h4 className="mb-2 text-sm font-black uppercase tracking-wider text-slate-700">⭐ This voter</h4>
                  <div className="grid gap-2 md:grid-cols-2">
                    <VoterRowCard voter={ego} badge="EGO" />
                  </div>
                </div>
                <Section title="🧒 Children" members={buckets.children} />
                <Section title="👶 Grandchildren" members={buckets.grandchildren} />
                <Section title="• Other household members" members={buckets.others} />
              </div>
            }
          />
          {inferredList.length > 0 ? (
            <FamilyOverridesEditor
              egoId={ego.id}
              members={inferredList}
              overrides={overrides}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function EgoCard({ ego, memberCount }: { ego: VoterRow; memberCount: number }) {
  const p = statusPalette(ego.voter_status);
  return (
    <div className="panel p-5">
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">⭐ Focused voter</p>
          <h2 className="urdu rtl mt-1 text-3xl font-black text-slate-900" dir="rtl">
            {ego.name || '(no name)'}
          </h2>
          {ego.father_husband_name ? (
            <p className="urdu rtl mt-1 text-base text-slate-700" dir="rtl">
              {kinshipPrefix(ego)}: <b>{ego.father_husband_name}</b>
            </p>
          ) : null}
          <p className="mt-2 text-sm text-slate-600" dir="ltr">
            CNIC: <code className="rounded bg-slate-100 px-1.5 py-0.5">{ego.cnic || '—'}</code>
            {' · '}Serial: {ego.serial_no || '—'}
            {ego.age != null ? ` · Age: ${ego.age}` : ''}
            {ego.gender ? ` · ${ego.gender}` : ''}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <div>
            📍 <b>{ego.block_code}</b>
          </div>
          <div className="mt-0.5 text-slate-600">{ego.address || '—'}</div>
          <div className="mt-2 text-xs text-slate-500">
            Family on roll: <b>{memberCount}</b> voter{memberCount === 1 ? '' : 's'}
          </div>
          <div className="mt-2 text-sm font-bold" style={{ color: p.color }}>
            Sentiment: {p.icon} {p.label}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryChips({
  ego,
  buckets,
}: {
  ego: VoterRow;
  buckets: ReturnType<typeof bucketFamily>;
}) {
  void ego; // reserved for future per-ego counts
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tree contains:</span>
      {summaryChip('👴 Parent', buckets.parents.length)}
      {summaryChip('👨‍🦳 Uncles/Aunts', buckets.unclesAunts.length)}
      {summaryChip('👬 Siblings', buckets.siblings.length)}
      {summaryChip('🧒 Children', buckets.children.length)}
      {summaryChip('👶 Grandchildren', buckets.grandchildren.length)}
      {buckets.others.length ? summaryChip('• Other', buckets.others.length) : null}
    </div>
  );
}
