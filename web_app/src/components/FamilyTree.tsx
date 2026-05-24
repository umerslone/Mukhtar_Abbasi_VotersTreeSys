'use client';

import { useState } from 'react';
import type { FamilyGroup, VoterRow } from '@/lib/types';
import { TagModal } from './VoterTag';

/** Pick the head: a member whose father/husband name does NOT appear as a name in the family. */
function chooseHead(members: VoterRow[]): VoterRow {
  const names = new Set(members.map((m) => normalize(m.name)));
  const head = members.find((m) => !names.has(normalize(m.father_husband_name)));
  return head ?? members[0];
}

function normalize(s: string): string {
  return (s || '').trim().toLowerCase();
}

/** Build parent->children adjacency by matching father_husband_name → name within the family. */
interface TreeNode {
  voter: VoterRow;
  spouse?: VoterRow;
  children: TreeNode[];
  generation: number;
}

function isFemale(v: VoterRow): boolean {
  const g = (v.gender || '').toLowerCase();
  return g.startsWith('f') || g.includes('female') || g.includes('عورت');
}

function isMale(v: VoterRow): boolean {
  const g = (v.gender || '').toLowerCase();
  return g.startsWith('m') || g.includes('male') || g.includes('مرد');
}

/**
 * Spouse heuristic for AJK electoral rolls (relaxed):
 *   A married woman's `father_husband_name` is the husband's name. So a female
 *   F whose `father_husband_name == M.name` could be either his wife or daughter.
 *   We call her the wife when:
 *     - F is female AND M is male (or unknown gender)
 *     - F.age >= 20 OR F.age is unknown — young married women in AJK rolls are common
 *     - The pair's age gap is <= 35 years
 *   The closest-age female wins; remaining same-named females stay as daughters.
 */
function findSpouse(
  head: VoterRow,
  candidates: VoterRow[],
  used: Set<string>
): VoterRow | undefined {
  if (isFemale(head)) return undefined; // limit to male-head detection for now
  const headName = normalize(head.name);
  if (!headName) return undefined;
  const headAge = head.age ?? null;

  let best: VoterRow | undefined;
  let bestGap = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    if (used.has(c.id)) continue;
    if (c.id === head.id) continue;
    if (!isFemale(c)) continue;
    if (normalize(c.father_husband_name) !== headName) continue;
    if (c.age != null && c.age < 20) continue; // under-20 still very likely a daughter

    const gap = headAge != null && c.age != null ? Math.abs(headAge - c.age) : 15;
    if (gap > 35) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  return best;
}

/** Deepest generation reached by any node in the tree (0 = head row only). */
function maxDepth(roots: TreeNode[]): number {
  let max = 0;
  const walk = (n: TreeNode) => {
    if (n.generation > max) max = n.generation;
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return max;
}

const LANE_LABELS = [
  'Head & Spouse',
  'Children',
  'Grandchildren',
  'Great-grandchildren',
  'Further generations'
];

function buildTree(members: VoterRow[]): TreeNode[] {
  const used = new Set<string>();
  const buildNode = (voter: VoterRow, generation: number): TreeNode => {
    used.add(voter.id);
    const spouse = findSpouse(voter, members, used);
    if (spouse) used.add(spouse.id);

    const children: TreeNode[] = [];
    for (const candidate of members) {
      if (used.has(candidate.id)) continue;
      if (normalize(candidate.father_husband_name) === normalize(voter.name)) {
        children.push(buildNode(candidate, generation + 1));
      }
    }
    // Eldest first
    children.sort((a, b) => (b.voter.age ?? 0) - (a.voter.age ?? 0));
    return { voter, spouse, children, generation };
  };

  const head = chooseHead(members);
  const roots: TreeNode[] = [buildNode(head, 0)];

  // Any orphan (member we never visited — name doesn't link to head) is appended as a sibling root.
  for (const m of members) {
    if (!used.has(m.id)) {
      roots.push(buildNode(m, 0));
    }
  }
  return roots;
}

/** Sentiment palette matching SmartNigranVoter family graph (pastel fill + dark stroke). */
function nodePalette(status: string): { bg: string; border: string; text: string; pill: string } {
  switch (status) {
    case 'Supporter':
      return { bg: '#DCFCE7', border: '#16A34A', text: '#14532D', pill: 'bg-emerald-600 text-white' };
    case 'Non-Supporter':
      return { bg: '#FEE2E2', border: '#DC2626', text: '#7F1D1D', pill: 'bg-rose-600 text-white' };
    case 'Undecided':
      return { bg: '#F1F5F9', border: '#64748B', text: '#0F172A', pill: 'bg-slate-500 text-white' };
    default:
      return { bg: '#FAFAFA', border: '#CBD5E1', text: '#475569', pill: 'bg-slate-200 text-slate-700' };
  }
}

function TreeCard({
  voter,
  relation,
  isEgo,
  onSelect
}: Readonly<{
  voter: VoterRow;
  relation: string;
  isEgo?: boolean;
  onSelect: (v: VoterRow) => void;
}>) {
  const p = nodePalette(voter.voter_status);
  return (
    <button
      type="button"
      onClick={() => onSelect(voter)}
      className="fam-node"
      style={{
        background: p.bg,
        borderColor: p.border,
        color: p.text,
        boxShadow: isEgo ? `0 0 0 3px ${p.border}` : undefined
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="fam-relation">{relation}</span>
        {voter.is_on_duty ? <span className="fam-duty">🎖️ Duty</span> : null}
      </div>
      <div className="urdu rtl fam-name" dir="rtl">{voter.name}</div>
      <div className="fam-meta">
        <span>{voter.cnic || 'No CNIC'}</span>
        {voter.age ? <span>· {voter.age}y</span> : null}
        {voter.gender ? <span>· {voter.gender}</span> : null}
      </div>
      <div className="urdu rtl fam-father" dir="rtl">والد/شوہر: {voter.father_husband_name || '—'}</div>
      <span className={`fam-pill ${p.pill}`}>{voter.voter_status}</span>
    </button>
  );
}

function relationLabel(generation: number, isEgo: boolean): string {
  if (isEgo) return '⭐ Head';
  switch (generation) {
    case 1: return '🧒 Child';
    case 2: return '👶 Grandchild';
    case 3: return '👼 Great-grandchild';
    default: return '• Member';
  }
}

function Subtree({
  node,
  isEgo,
  onSelect
}: Readonly<{ node: TreeNode; isEgo?: boolean; onSelect: (v: VoterRow) => void }>) {
  return (
    <li>
      {node.spouse ? (
        <div className="fam-couple">
          <TreeCard
            voter={node.voter}
            relation={relationLabel(node.generation, !!isEgo)}
            isEgo={isEgo}
            onSelect={onSelect}
          />
          <span className="fam-couple-link" aria-hidden="true">♥</span>
          <TreeCard
            voter={node.spouse}
            relation="💍 Spouse"
            onSelect={onSelect}
          />
        </div>
      ) : (
        <TreeCard
          voter={node.voter}
          relation={relationLabel(node.generation, !!isEgo)}
          isEgo={isEgo}
          onSelect={onSelect}
        />
      )}
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <Subtree key={child.voter.id} node={child} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FamilyTree({ families }: Readonly<{ families: FamilyGroup[] }>) {
  const [selected, setSelected] = useState<VoterRow | null>(null);

  if (!families.length) {
    return <div className="panel p-6 text-center text-slate-500">No voters match your filters.</div>;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {families.map((family) => {
        const roots = buildTree(family.members);
        return (
          <div key={family.inferred_family_id} className="panel p-4">
            <header className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <p className="snvb-label-upper">{family.block_code}</p>
                <h3 className="urdu rtl mt-1 text-lg font-black text-slate-900" dir="rtl">
                  {family.address}
                </h3>
              </div>
              <span className="snvb-badge bg-navy text-white">
                {family.members.length} voters
              </span>
            </header>

            <div className="fam-tree-scroll">
              <div className="fam-lanes" aria-hidden="true">
                {LANE_LABELS.slice(0, maxDepth(roots) + 1).map((label) => (
                  <div key={label} className="fam-lane">{label}</div>
                ))}
              </div>
              <ul className="fam-tree">
                {roots.map((root, idx) => (
                  <Subtree key={root.voter.id} node={root} isEgo={idx === 0} onSelect={setSelected} />
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
