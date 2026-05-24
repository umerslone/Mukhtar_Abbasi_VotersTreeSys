'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import { Pencil, ChevronDown, ChevronRight, ShieldCheck, Users } from 'lucide-react';
import { useDatabase } from './DbProvider';
import type { FamilySummary, SearchFilters, VoterRecord, VoterStatus } from '@/lib/types';

const STATUS_COLORS: Record<VoterStatus, string> = {
  Supporter: 'bg-emerald-600 text-white',
  Leaning: 'bg-teal-600 text-white',
  Undecided: 'bg-amber-500 text-slate-950',
  Opposition: 'bg-orange-600 text-white',
  Hostile: 'bg-rose-700 text-white',
  Unsurveyed: 'bg-slate-500 text-white'
};

const statusBadgeClass = (status: VoterStatus): string => STATUS_COLORS[status] ?? STATUS_COLORS.Unsurveyed;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function computeHeadIndex(members: VoterRecord[]): number {
  const names = new Set(members.map((member) => normalize(member.name)));
  const candidateIndex = members.findIndex((member) => !names.has(normalize(member.father_husband_name)));
  return candidateIndex >= 0 ? candidateIndex : 0;
}

function chooseTreeOrder(members: VoterRecord[]): VoterRecord[] {
  const headIndex = computeHeadIndex(members);
  const ordered = [...members];
  const [head] = ordered.splice(headIndex, 1);
  return [head, ...ordered].filter(Boolean);
}

function buildInfluenceText(members: VoterRecord[]): string {
  const counts = members.reduce(
    (accumulator, voter) => {
      accumulator.total += 1;
      accumulator[voter.voter_status.toLowerCase() as keyof Omit<typeof accumulator, 'total'>] += 1;
      return accumulator;
    },
    {
      total: 0,
      supporter: 0,
      leaning: 0,
      undecided: 0,
      opposition: 0,
      hostile: 0,
      unsurveyed: 0
    }
  );

  return `Total Votes: ${counts.total} | Supporters: ${counts.supporter} | Undecided: ${counts.undecided} | Leaning: ${counts.leaning} | Opposition: ${counts.opposition}`;
}

function FamilyCard({ family, filters, onSelectVoter, refreshToken }: Readonly<{
  family: FamilySummary;
  filters: SearchFilters;
  onSelectVoter: (voter: VoterRecord) => void;
  refreshToken: number;
}>) {
  const { db } = useDatabase();
  const [expanded, setExpanded] = useState(true);
  const [members, setMembers] = useState<VoterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    db.getFamilyMembers(family.inferred_family_id)
      .then((rows) => {
        if (mounted) {
          setMembers(rows);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [db, family.inferred_family_id, refreshToken]);

  const orderedMembers = useMemo(() => chooseTreeOrder(members), [members]);
  const influenceText = useMemo(() => buildInfluenceText(members), [members]);

  const head = orderedMembers[0];

  return (
    <div className="relative m-2 rounded-[28px] border border-white/60 bg-white/85 p-4 shadow-soft backdrop-blur-md">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start justify-between gap-4 rounded-[22px] bg-slate-950 px-4 py-3 text-left text-white"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/65">Family Unit</p>
          <h4 className="mt-1 truncate text-lg font-black">{family.address}</h4>
          <p className="mt-1 text-sm text-white/80">{influenceText}</p>
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users size={16} />
          <span>{family.total_votes}</span>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </button>

      <div className="mt-4 grid gap-2 rounded-[22px] bg-[#fbf4eb] p-3">
        <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.24em] text-slate-500">
          <span className="rounded-full bg-slate-900 px-3 py-1 text-white">{family.block_code}</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">Supporters {family.supporters}</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">Undecided {family.undecided}</span>
          <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-900">Hostile {family.hostile}</span>
        </div>

        {expanded ? (
          loading ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/75 p-4 text-sm text-slate-500">Loading members…</div>
          ) : (
            <div className="space-y-2">
              {orderedMembers.map((member, index) => {
                const isEditing = editingId === member.id;
                const isHead = index === 0;
                return (
                  <div
                    key={member.id}
                    className={`relative node-shadow flex items-start justify-between gap-3 rounded-2xl border px-3 py-2 ${
                      isHead ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <button type="button" onClick={() => onSelectVoter(member)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                      <div className={`mt-1 h-3 w-3 rounded-full ${isHead ? 'bg-amber-300' : 'bg-slate-400'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-extrabold urdu-primary rtl">{member.name}</span>
                          {member.is_on_duty ? <ShieldCheck size={14} className="text-violet-500" /> : null}
                          <span className={`rounded-full px-2 py-1 text-[11px] font-black ${statusBadgeClass(member.voter_status)}`}>
                            {member.voter_status}
                          </span>
                        </div>
                        <div className={`mt-1 text-xs ${isHead ? 'text-white/75' : 'text-slate-500'}`}>
                          <span>{member.serial_no}</span>
                          <span className="mx-2">•</span>
                          <span>CNIC {member.cnic}</span>
                          <span className="mx-2">•</span>
                          <span>{member.profession || 'No profession'}</span>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Edit ${member.name}`}
                        onClick={() => {
                          setEditingId(member.id);
                          setDraftName(member.name);
                        }}
                        className={`rounded-full p-2 ${isHead ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'}`}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>

                    {isEditing ? (
                      <div className="absolute z-10 mt-14 w-[calc(100%-2rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
                        <label className="block text-xs font-bold uppercase tracking-[0.24em] text-slate-500">OCR correction</label>
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-base font-semibold outline-none"
                        />
                        <div className="mt-3 flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingId(null)} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold">
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await db.updateVoterName(member.id, draftName);
                              setEditingId(null);
                            }}
                            className="rounded-2xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/75 p-4 text-sm text-slate-500">
            Household collapsed. Tap the header to expand the tree.
          </div>
        )}
      </div>

      {head ? (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          Head of Household: {head.name}
        </div>
      ) : null}
    </div>
  );
}

const MemoizedFamilyCard = memo(FamilyCard);

function FamilyRow({ index, style, data }: ListChildComponentProps<{
  families: FamilySummary[];
  filters: SearchFilters;
  onSelectVoter: (voter: VoterRecord) => void;
  refreshToken: number;
}>): React.ReactElement {
  const family = data.families[index];
  return (
    <div style={style}>
      <MemoizedFamilyCard family={family} filters={data.filters} onSelectVoter={data.onSelectVoter} refreshToken={data.refreshToken} />
    </div>
  );
}

export function FamilyTree({ filters, onSelectVoter, refreshToken }: Readonly<{ filters: SearchFilters; onSelectVoter: (voter: VoterRecord) => void; refreshToken: number }>) {
  const { db } = useDatabase();
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    db.getFamilySummaries(filters)
      .then((rows) => {
        if (mounted) {
          setFamilies(rows);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [db, filters, refreshToken]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(Math.max(320, Math.floor(entry.contentRect.width)));
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const itemData = useMemo(
    () => ({ families, filters, onSelectVoter, refreshToken }),
    [families, filters, onSelectVoter, refreshToken]
  );

  if (loading) {
    return <div className="panel rounded-[30px] p-6 text-sm text-slate-600">Building family graph…</div>;
  }

  return (
    <div ref={containerRef} className="panel overflow-hidden rounded-[32px] p-3">
      <div className="mb-3 flex items-center justify-between gap-4 rounded-[24px] bg-slate-950 px-4 py-3 text-white">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/60">Interactive family tree</p>
          <h3 className="mt-1 text-xl font-black">Grouped by inferred_family_id</h3>
        </div>
        <div className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">{families.length} families</div>
      </div>
      <List height={900} width={containerWidth} itemCount={families.length} itemSize={320} itemData={itemData} overscanCount={4}>
        {FamilyRow}
      </List>
    </div>
  );
}
