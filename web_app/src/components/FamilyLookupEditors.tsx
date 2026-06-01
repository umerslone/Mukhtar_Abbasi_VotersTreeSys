'use client';

/**
 * Inline editors for the /family-lookup ego:
 *   - Name correction (Urdu + Roman) with optional cascade to siblings
 *     sharing the same OLD father-name.
 *   - Per-member Confirm / Reject / Clear buttons that persist to the
 *     `FamilyOverride` table and re-render the page on success.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  clearFamilyOverride,
  setFamilyOverride,
  updateVoterNames,
} from '@/app/actions';
import type { VoterRow } from '@/lib/types';

interface InferredMember {
  voter: VoterRow;
  relation: string;
}

export function FamilyOverridesEditor({
  egoId,
  members,
  overrides,
}: Readonly<{
  egoId: string;
  members: InferredMember[];
  overrides: Record<string, 'confirmed' | 'rejected'>;
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  if (members.length === 0) return null;

  const act = (memberId: string, decision: 'confirmed' | 'rejected', hint: string) =>
    startTransition(async () => {
      await setFamilyOverride(egoId, memberId, decision, hint);
      router.refresh();
    });
  const clear = (memberId: string) =>
    startTransition(async () => {
      await clearFamilyOverride(egoId, memberId);
      router.refresh();
    });

  return (
    <div className="panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-t-xl px-4 py-3 text-left text-sm font-bold text-slate-800 hover:bg-slate-50"
      >
        <span>🔧 Confirm / reject inferred relationships ({members.length})</span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">
            Family edges are heuristic — based on shared father-name and block.
            Mark wrong matches as <b>Not family</b> (they disappear from the tree)
            and correct matches as <b>Confirmed</b> (locked in).
          </p>
          {members.map(({ voter, relation }) => {
            const current = overrides[voter.id];
            return (
              <div
                key={voter.id}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="urdu rtl text-sm font-bold text-slate-900" dir="rtl">
                    {voter.name || '(no name)'}{' '}
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500" dir="ltr">
                      · {relation}
                    </span>
                    {current === 'confirmed' ? <span className="ms-2 text-green-700">✅</span> : null}
                    {current === 'rejected' ? <span className="ms-2 text-red-600">❌</span> : null}
                  </div>
                  <div className="text-[11px] text-slate-500" dir="ltr">
                    CNIC: {voter.cnic || '—'} · {voter.block_code}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={pending || current === 'confirmed'}
                    onClick={() => act(voter.id, 'confirmed', relation)}
                    className="rounded-full border border-green-300 bg-green-50 px-3 py-1 text-xs font-semibold text-green-800 hover:bg-green-100 disabled:opacity-40"
                  >
                    ✅ Confirm
                  </button>
                  <button
                    type="button"
                    disabled={pending || current === 'rejected'}
                    onClick={() => act(voter.id, 'rejected', relation)}
                    className="rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40"
                  >
                    ❌ Not family
                  </button>
                  {current ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => clear(voter.id)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      ↺ Clear
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function VoterNameEditor({
  voter,
  siblingsSharingFatherName,
}: Readonly<{ voter: VoterRow; siblingsSharingFatherName: number }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(voter.name);
  const [father, setFather] = useState(voter.father_husband_name);
  const [cascade, setCascade] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const fatherChanging = father.trim() !== voter.father_husband_name.trim();
  const canCascade = fatherChanging && siblingsSharingFatherName > 0;

  const save = () =>
    startTransition(async () => {
      setMsg(null);
      try {
        const res = await updateVoterNames(
          voter.id,
          { name, father_husband_name: father },
          canCascade && cascade,
        );
        if (!res.updated) {
          setMsg({ kind: 'err', text: 'Nothing changed.' });
          return;
        }
        let txt = '✅ Saved.';
        if (res.cascaded) {
          txt += ` Also updated ${res.cascaded} sibling${res.cascaded === 1 ? '' : 's'} sharing the old father-name.`;
        }
        setMsg({ kind: 'ok', text: txt });
        router.refresh();
      } catch (err) {
        setMsg({ kind: 'err', text: (err as Error).message });
      }
    });

  const dirty =
    name.trim() !== voter.name.trim() || father.trim() !== voter.father_husband_name.trim();

  return (
    <div className="panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-t-xl px-4 py-3 text-left text-sm font-bold text-slate-800 hover:bg-slate-50"
      >
        <span>✏️ Edit names (fix OCR errors)</span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">
            Fix garbled names from OCR. Type in Urdu (or Roman — both are searchable).
            Changing the <b>father / husband name</b> can optionally cascade to other
            voters in this family sharing the same old spelling.
          </p>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
              Voter name (Urdu / Roman)
            </label>
            <input
              dir="rtl"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="urdu mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-bold focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600">
              Father / Husband name
            </label>
            <input
              dir="rtl"
              value={father}
              onChange={(e) => setFather(e.target.value)}
              className="urdu mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-bold focus:border-indigo-500 focus:outline-none"
            />
          </div>
          {canCascade ? (
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <input
                type="checkbox"
                checked={cascade}
                onChange={(e) => setCascade(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                🌳 Apply this father-name correction to <b>{siblingsSharingFatherName}</b>{' '}
                other voter{siblingsSharingFatherName === 1 ? '' : 's'} in this family
                who share the old spelling.
              </span>
            </label>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="rounded-full bg-indigo-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-40"
            >
              {pending ? 'Saving…' : '💾 Save'}
            </button>
            {msg ? (
              <span
                className={`text-xs font-semibold ${
                  msg.kind === 'ok' ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {msg.text}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
