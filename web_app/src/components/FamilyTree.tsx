'use client';

/**
 * Family lookup — ported from the SmartNigranVoter Streamlit dashboard
 * (dashboard/pages/3_Family_Lookup.py). Renders a Graphviz-style top-down
 * tree per inferred family with sentiment-coloured nodes and a household
 * influence verdict banner.
 */

import { useState } from 'react';
import type { FamilyGroup, VoterRow } from '@/lib/types';
import { normalizeName, nameSimilarity } from '@/lib/urdu_alphabet';
import { TagModal } from './VoterTag';

// ── Helpers ───────────────────────────────────────────────────────────

/** Backward-compatible alias used inside this file. */
function normalize(s: string): string {
  return normalizeName(s);
}

const PARENT_SIM = 0.55;   // mirrors SmartNigranVoter PARENT_THRESHOLD

function isFemale(v: VoterRow): boolean {
  const g = (v.gender || '').toLowerCase();
  return g.startsWith('f') || g.includes('female') || g.includes('عورت');
}

function isMale(v: VoterRow): boolean {
  const g = (v.gender || '').toLowerCase();
  return g.startsWith('m') || g.includes('male') || g.includes('مرد');
}

/**
 * Resolve the correct kinship label for a voter:
 *   - Male voter           → "Father"  (father_husband_name is the father)
 *   - Female voter with an active male spouse in this family whose name
 *     matches her father_husband_name (and she is of marriageable age)
 *                           → "Husband"
 *   - Female voter otherwise → "Father"  (treated as a daughter listed under her father)
 */
function kinshipLabel(voter: VoterRow, activeMaleNames: string[]): 'Father' | 'Husband' {
  if (!isFemale(voter)) return 'Father';
  const linked = normalizeName(voter.father_husband_name);
  if (!linked) return 'Father';
  const isAdult = voter.age == null || voter.age >= 20;
  if (!isAdult) return 'Father';
  for (const n of activeMaleNames) {
    if (nameSimilarity(linked, n) >= PARENT_SIM) return 'Husband';
  }
  return 'Father';
}

/**
 * Pick the patriarch (head of household):
 *   1. Prefer the oldest male whose `father_husband_name` does NOT fuzzy-match
 *      any other member's name (i.e. his father isn't on the roll → he IS
 *      the eldest generation present).
 *   2. Otherwise fall back to the oldest male.
 *   3. Otherwise the oldest member.
 */
function chooseHead(members: VoterRow[]): VoterRow {
  const males = members.filter(isMale);
  const candidates = (males.length ? males : members)
    .slice()
    .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));

  const nameKeys = members.map((m) => normalizeName(m.name));
  const isPatriarch = (m: VoterRow): boolean => {
    const fk = normalizeName(m.father_husband_name);
    if (!fk) return true;
    for (let i = 0; i < members.length; i++) {
      if (members[i].id === m.id) continue;
      if (nameSimilarity(fk, nameKeys[i]) >= PARENT_SIM) return false;
    }
    return true;
  };
  return candidates.find(isPatriarch) ?? candidates[0] ?? members[0];
}

/**
 * Spouse heuristic: a female whose father_husband_name fuzzy-matches `head.name`
 * and is of marriageable age (≥20 or unknown). Picks the closest age gap.
 */
function findSpouse(head: VoterRow, candidates: VoterRow[], used: Set<string>): VoterRow | undefined {
  if (isFemale(head)) return undefined;
  const headKey = normalizeName(head.name);
  if (!headKey) return undefined;

  let best: VoterRow | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (used.has(c.id) || c.id === head.id) continue;
    if (!isFemale(c)) continue;
    if (nameSimilarity(normalizeName(c.father_husband_name), headKey) < PARENT_SIM) continue;
    if (c.age != null && c.age < 20) continue;
    const gap = head.age != null && c.age != null ? Math.abs(head.age - c.age) : 15;
    if (gap > 35) continue;
    if (gap < bestGap) { bestGap = gap; best = c; }
  }
  return best;
}

type Relation = 'self' | 'spouse' | 'child' | 'grandchild' | 'member';

interface TreeNode {
  voter: VoterRow;
  spouse?: VoterRow;
  relation: Relation;
  children: TreeNode[];
}

/**
 * Build a hierarchical family tree.
 *
 * Algorithm (mirrors SmartNigranVoter `build_family_tree`):
 *   1. Choose the patriarch (head).
 *   2. For every non-head member, find the BEST parent within the family by
 *      fuzzy-matching `member.father_husband_name` to other members' `name`
 *      (Dice on character bigrams, ≥ PARENT_SIM).
 *   3. If no parent is found, attach the member as a direct child of the head
 *      (so we never end up with a flat sibling row at the root).
 *   4. Attach spouses (one per node, females only) so that wives appear beside
 *      their husbands rather than as orphan branches.
 *   5. Sort children eldest-first so the rendered tree reads naturally.
 */
function buildTree(members: VoterRow[]): TreeNode[] {
  if (members.length === 0) return [];
  const head = chooseHead(members);

  // Precompute normalized keys once.
  const nameKey = new Map<string, string>();
  const fatherKey = new Map<string, string>();
  for (const m of members) {
    nameKey.set(m.id, normalizeName(m.name));
    fatherKey.set(m.id, normalizeName(m.father_husband_name));
  }

  // For every member, decide their best parent inside the family.
  // The head has no parent. Spouses are resolved separately later.
  const parentOf = new Map<string, string | null>();
  parentOf.set(head.id, null);

  for (const m of members) {
    if (m.id === head.id) continue;
    const fk = fatherKey.get(m.id) ?? '';
    if (!fk) {
      parentOf.set(m.id, head.id);
      continue;
    }
    let bestId: string | null = null;
    let bestSim = PARENT_SIM;
    for (const p of members) {
      if (p.id === m.id) continue;
      const sim = nameSimilarity(fk, nameKey.get(p.id) ?? '');
      if (sim > bestSim) { bestSim = sim; bestId = p.id; }
    }
    // No fuzzy parent → fall under the head so the tree stays hierarchical.
    parentOf.set(m.id, bestId ?? head.id);
  }

  // Children index.
  const childrenOf = new Map<string, VoterRow[]>();
  for (const m of members) {
    const pid = parentOf.get(m.id);
    if (pid == null) continue;
    const arr = childrenOf.get(pid) ?? [];
    arr.push(m);
    childrenOf.set(pid, arr);
  }

  // Recursive build with spouse attachment + cycle guard.
  const used = new Set<string>();
  const buildNode = (voter: VoterRow, relation: Relation): TreeNode => {
    used.add(voter.id);
    const spouse = findSpouse(voter, members, used);
    if (spouse) used.add(spouse.id);

    const childRel: Relation =
      relation === 'self' ? 'child' :
      relation === 'child' ? 'grandchild' :
      relation === 'grandchild' ? 'grandchild' : 'child';

    const kids = (childrenOf.get(voter.id) ?? [])
      .filter((c) => !used.has(c.id))
      .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    const children = kids.map((c) => buildNode(c, childRel));

    return { voter, spouse, relation, children };
  };

  const roots: TreeNode[] = [buildNode(head, 'self')];
  // Safety net: anyone still unassigned (e.g. cycle break) becomes a sibling
  // member-row, but with our fallback-to-head this should be rare.
  for (const m of members) {
    if (!used.has(m.id)) roots.push(buildNode(m, 'member'));
  }
  return roots;
}

// ── Sentiment palette (mirrors SmartNigranVoter SENTIMENT_BADGE + _DOT_FILL) ─

interface Palette { bg: string; border: string; text: string; label: string; icon: string }

function palette(status: string): Palette {
  switch (status) {
    case 'Supporter':
      return { bg: '#C8E6C9', border: '#2E7D32', text: '#14532D', label: 'Supporter',  icon: '🟢' };
    case 'Non-Supporter':
      return { bg: '#FFCDD2', border: '#C62828', text: '#7F1D1D', label: 'Opposition', icon: '🔴' };
    case 'Undecided':
      return { bg: '#EEEEEE', border: '#757575', text: '#0F172A', label: 'Undecided',  icon: '⚪' };
    default:
      return { bg: '#F5F5F5', border: '#9E9E9E', text: '#475569', label: 'Unsurveyed', icon: '⚫' };
  }
}

const RELATION_EMOJI: Record<Relation, string> = {
  self: '⭐', spouse: '💍', child: '🧒', grandchild: '👶', member: '•',
};
const RELATION_LABEL: Record<Relation, string> = {
  self: 'Head', spouse: 'Spouse', child: 'Child', grandchild: 'Grandchild', member: 'Member',
};

// ── Node card ──────────────────────────────────────────────────────────

function TreeCard({
  voter, relation, isEgo, activeMaleNames, onSelect,
}: Readonly<{ voter: VoterRow; relation: Relation; isEgo?: boolean; activeMaleNames: string[]; onSelect: (v: VoterRow) => void }>) {
  const p = palette(voter.voter_status);
  const kin = kinshipLabel(voter, activeMaleNames);
  const kinName = voter.father_husband_name?.trim();
  return (
    <button
      type="button"
      onClick={() => onSelect(voter)}
      className="fam-node"
      style={{
        background: p.bg,
        borderColor: p.border,
        color: p.text,
        borderWidth: isEgo ? 3 : 1.5,
      }}
    >
      <div className="fam-node-head">
        <span className="fam-relation">{RELATION_EMOJI[relation]} {RELATION_LABEL[relation]}</span>
        {voter.is_on_duty ? <span className="fam-duty">🎖️</span> : null}
      </div>
      <div className="urdu rtl fam-name" dir="rtl">{voter.name || '(no name)'}</div>
      {kinName ? (
        <div className="urdu rtl fam-father" dir="rtl">
          <span className="fam-kin-label">{kin === 'Husband' ? 'شوہر' : 'والد'}:</span>{' '}{kinName}
        </div>
      ) : null}
      <div className="fam-meta">
        <span>CNIC: {voter.cnic || '—'}</span>
        {voter.age ? <span> · {voter.age}y</span> : null}
        {voter.gender ? <span> · {voter.gender}</span> : null}
      </div>
      <div className="fam-sentiment" style={{ color: p.border }}>
        {p.icon} {p.label}
      </div>
    </button>
  );
}

function Subtree({ node, isEgo, egoId, activeMaleNames, onSelect }: Readonly<{ node: TreeNode; isEgo?: boolean; egoId?: string; activeMaleNames: string[]; onSelect: (v: VoterRow) => void }>) {
  const highlightThis = egoId ? node.voter.id === egoId : Boolean(isEgo);
  return (
    <li>
      {node.spouse ? (
        <div className="fam-couple">
          <TreeCard voter={node.voter} relation={node.relation} isEgo={highlightThis} activeMaleNames={activeMaleNames} onSelect={onSelect} />
          <span className="fam-couple-link" aria-hidden="true">♥</span>
          <TreeCard voter={node.spouse} relation="spouse" isEgo={egoId === node.spouse.id} activeMaleNames={activeMaleNames} onSelect={onSelect} />
        </div>
      ) : (
        <TreeCard voter={node.voter} relation={node.relation} isEgo={highlightThis} activeMaleNames={activeMaleNames} onSelect={onSelect} />
      )}
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <Subtree key={child.voter.id} node={child} egoId={egoId} activeMaleNames={activeMaleNames} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// ── Household influence verdict (mirrors compute_family_influence) ─────

interface Influence { total: number; supporter: number; opposition: number; undecided: number; unsurveyed: number; score: number; verdict: string; color: string }

function computeInfluence(members: VoterRow[]): Influence {
  const counts = { supporter: 0, opposition: 0, undecided: 0, unsurveyed: 0 };
  for (const m of members) {
    switch (m.voter_status) {
      case 'Supporter':     counts.supporter++;  break;
      case 'Non-Supporter': counts.opposition++; break;
      case 'Undecided':     counts.undecided++;  break;
      default:              counts.unsurveyed++; break;
    }
  }
  const total = members.length || 1;
  const raw = (counts.supporter - counts.opposition) / total;
  const score = Math.round(50 + raw * 50);
  let verdict = 'Mixed / persuadable';
  let color = '#FBC02D';
  if (score >= 65)      { verdict = 'FRIENDLY HOUSEHOLD'; color = '#2E7D32'; }
  else if (score >= 55) { verdict = 'Leans our way';      color = '#9CCC65'; }
  else if (score >= 45) { verdict = 'Mixed / persuadable';color = '#FBC02D'; }
  else if (score >= 35) { verdict = 'Leans opposition';   color = '#FB8C00'; }
  else                  { verdict = 'HOSTILE HOUSEHOLD';  color = '#E53935'; }
  return { total: members.length, ...counts, score, verdict, color };
}

// ── Top-level component ────────────────────────────────────────────────

export function FamilyTree({ families, egoId }: Readonly<{ families: FamilyGroup[]; egoId?: string }>) {
  const [selected, setSelected] = useState<VoterRow | null>(null);

  if (!families.length) {
    return <div className="panel p-6 text-center text-slate-500">No voters match your filters.</div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {families.map((family) => {
        const roots = buildTree(family.members);
        const inf = computeInfluence(family.members);
        // Active male voters in this family — used to decide whether a female's
        // `father_husband_name` should be labelled "Husband" (active spouse in roll)
        // vs "Father" (she is a daughter listed under her father).
        const activeMaleNames = family.members
          .filter(isMale)
          .map((m) => normalizeName(m.name))
          .filter(Boolean);
        return (
          <div key={family.inferred_family_id} className="panel p-4">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="min-w-0">
                <p className="snvb-label-upper">🌳 {family.block_code}</p>
                <h3 className="urdu rtl mt-1 truncate text-lg font-black text-slate-900" dir="rtl">
                  {family.address}
                </h3>
              </div>
              <span className="snvb-badge bg-navy text-white shrink-0">
                {family.members.length} voters
              </span>
            </header>

            <div className="fam-influence" style={{ background: inf.color }} title={`Influence score ${inf.score}/100`}>
              <span className="fam-influence-verdict">{inf.verdict}</span>
              <span className="fam-influence-meta">
                🟢 {inf.supporter} · ⚪ {inf.undecided} · 🔴 {inf.opposition} · ⚫ {inf.unsurveyed}
              </span>
            </div>

            <div className="fam-tree-scroll">
              <ul className="fam-tree">
                {roots.map((root, idx) => (
                  <Subtree key={root.voter.id} node={root} isEgo={!egoId && idx === 0} egoId={egoId} activeMaleNames={activeMaleNames} onSelect={setSelected} />
                ))}
              </ul>
            </div>
          </div>
        );
      })}

      <TagModal voter={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
