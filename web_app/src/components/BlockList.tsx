'use client';

import { useMemo, useState } from 'react';
import type { VoterRow } from '@/lib/types';
import { TagModal, VoterTagButton } from './VoterTag';

interface BlockGroup {
  block_code: string;
  voters: VoterRow[];
}

export function BlockList({ voters }: Readonly<{ voters: VoterRow[] }>) {
  const [selected, setSelected] = useState<VoterRow | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const groups: BlockGroup[] = useMemo(() => {
    const map = new Map<string, VoterRow[]>();
    for (const v of voters) {
      const key = v.block_code || 'UNKNOWN';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return Array.from(map.entries())
      .map(([block_code, list]) => ({
        block_code,
        voters: list.sort((a, b) => {
          const sa = parseInt(a.serial_no, 10);
          const sb = parseInt(b.serial_no, 10);
          if (Number.isFinite(sa) && Number.isFinite(sb)) return sa - sb;
          return a.serial_no.localeCompare(b.serial_no);
        }),
      }))
      .sort((a, b) => a.block_code.localeCompare(b.block_code));
  }, [voters]);

  if (!groups.length) {
    return <div className="panel p-6 text-center text-slate-500">No voters found.</div>;
  }

  return (
    <>
      <div className="panel p-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, CNIC, or address…"
          className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
        />
      </div>

      <div className="space-y-3">
        {groups.map((group) => {
          const isOpen = openBlock === group.block_code;
          const q = filter.trim().toLowerCase();
          const visible = q
            ? group.voters.filter(
                (v) =>
                  v.name.toLowerCase().includes(q) ||
                  v.cnic.toLowerCase().includes(q) ||
                  v.address.toLowerCase().includes(q)
              )
            : group.voters;
          const counts = countByStatus(group.voters);
          return (
            <div key={group.block_code} className="panel overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenBlock(isOpen ? null : group.block_code)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Polling Station / Block</p>
                  <h3 className="mt-1 text-lg font-black text-slate-900">{group.block_code}</h3>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold">
                  <Pill label={`${group.voters.length} total`} tone="slate" />
                  <Pill label={`${counts.Supporter} S`} tone="green" />
                  <Pill label={`${counts['Non-Supporter']} N`} tone="red" />
                  <Pill label={`${counts.Undecided} U`} tone="gray" />
                  <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-4">
                  {visible.length === 0 ? (
                    <p className="text-center text-sm text-slate-500">No voters match the filter.</p>
                  ) : (
                    visible.map((v) => (
                      <div key={v.id} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 text-right text-xs font-mono text-slate-500">
                          #{v.serial_no}
                        </span>
                        <div className="flex-1">
                          <VoterTagButton voter={v} onSelect={setSelected} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <TagModal voter={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function countByStatus(voters: VoterRow[]) {
  const counts = { Supporter: 0, 'Non-Supporter': 0, Undecided: 0, Unsurveyed: 0 } as Record<string, number>;
  for (const v of voters) {
    counts[v.voter_status] = (counts[v.voter_status] ?? 0) + 1;
  }
  return counts;
}

function Pill({ label, tone }: { label: string; tone: 'green' | 'red' | 'gray' | 'slate' }) {
  const map = {
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-700',
    slate: 'bg-slate-900 text-white',
  };
  return <span className={`rounded-full px-2 py-0.5 ${map[tone]}`}>{label}</span>;
}
