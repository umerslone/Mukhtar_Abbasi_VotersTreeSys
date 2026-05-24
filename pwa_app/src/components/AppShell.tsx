'use client';

import { useDeferredValue, useEffect, useMemo, useState, startTransition } from 'react';
import { Activity, FileText, Filter, Search, TreePine, UserRound } from 'lucide-react';
import { DbProvider, useDatabase } from './DbProvider';
import { DbLoader } from './DbLoader';
import { FamilyTree } from './FamilyTree';
import { DutyStaffMatcher } from './DutyStaffMatcher';
import { ReportsPanel } from './ReportsPanel';
import { StatusModal } from './StatusModal';
import type { QuickFilters, SearchFilters, VoterRecord, VoterStatus } from '@/lib/types';

function statusBadgeClass(status: VoterStatus): string {
  switch (status) {
    case 'Supporter':
      return 'bg-emerald-100 text-emerald-900';
    case 'Leaning':
      return 'bg-teal-100 text-teal-900';
    case 'Undecided':
      return 'bg-amber-100 text-amber-900';
    case 'Opposition':
      return 'bg-orange-100 text-orange-900';
    case 'Hostile':
      return 'bg-rose-100 text-rose-900';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function QuickFilterToggle({ label, active, onToggle }: Readonly<{ label: string; active: boolean; onToggle: () => void }>) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full border px-4 py-2 text-sm font-bold transition ${active ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
    >
      {label}
    </button>
  );
}

function SentimentChip({ label, active, onClick }: Readonly<{ label: string; active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-bold transition ${active ? 'bg-slate-950 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}
    >
      {label}
    </button>
  );
}

function AppInner() {
  const { db, ready, revision, updateStatus, updateName, reload } = useDatabase();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [dashboardStatus, setDashboardStatus] = useState<SearchFilters['dashboardStatus']>('all');
  const [quickFilters, setQuickFilters] = useState<QuickFilters>({ youth: false, studentTeacher: false, male: false, female: false });
  const [selectedVoter, setSelectedVoter] = useState<VoterRecord | null>(null);
  const [summary, setSummary] = useState<Record<string, number>>({ total: 0 });
  const filters = useMemo<SearchFilters>(() => ({ query: deferredQuery, dashboardStatus, quickFilters }), [dashboardStatus, deferredQuery, quickFilters]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    let cancelled = false;
    db.getDashboardCounts(filters).then((counts) => {
      if (!cancelled) {
        setSummary(counts);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [db, filters, ready, revision]);

  const toggleQuick = (key: keyof QuickFilters) => {
    startTransition(() => {
      setQuickFilters((current) => ({ ...current, [key]: !current[key] }));
    });
  };

  return (
    <div className="min-h-screen px-4 py-5 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1680px] space-y-5">
        <section className="panel rounded-[36px] px-5 py-6 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.38em] text-slate-500">Standalone offline voter management system</p>
              <h1 className="mt-3 text-4xl font-black leading-tight text-slate-950 sm:text-6xl">
                AJK voter intelligence, fully offline, with Urdu-first editing.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
                Search, correct OCR, infer family trees, flag duty staff, and export field-ready reports without internet access.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[24px] bg-slate-950 px-4 py-3 text-white">
                <div className="text-xs uppercase tracking-[0.24em] text-white/60">Database</div>
                <div className="mt-1 text-xl font-black">{ready ? 'Ready' : 'Waiting'}</div>
              </div>
              <div className="rounded-[24px] bg-emerald-600 px-4 py-3 text-white">
                <div className="text-xs uppercase tracking-[0.24em] text-white/70">Visible voters</div>
                <div className="mt-1 text-xl font-black">{summary.total ?? 0}</div>
              </div>
              <div className="rounded-[24px] bg-amber-500 px-4 py-3 text-slate-950">
                <div className="text-xs uppercase tracking-[0.24em] text-slate-700">Revision</div>
                <div className="mt-1 text-xl font-black">{revision}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
            <DbLoader />
            <div className="rounded-[32px] border border-white/60 bg-white/80 p-5 shadow-soft">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.28em] text-slate-500">
                <Activity size={15} /> Sentiment dashboard
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <SentimentChip label="All" active={dashboardStatus === 'all'} onClick={() => setDashboardStatus('all')} />
                {(['Supporter', 'Leaning', 'Undecided', 'Opposition', 'Hostile', 'Unsurveyed'] as VoterStatus[]).map((status) => (
                  <SentimentChip key={status} label={status} active={dashboardStatus === status} onClick={() => setDashboardStatus(status)} />
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                {(['Supporter', 'Leaning', 'Undecided', 'Opposition', 'Hostile', 'Unsurveyed'] as VoterStatus[]).map((status) => (
                  <div key={status} className={`rounded-2xl px-4 py-3 font-bold ${statusBadgeClass(status)}`}>
                    <div className="text-[11px] uppercase tracking-[0.24em] opacity-75">{status}</div>
                    <div className="mt-1 text-2xl">{summary[status.toLowerCase()] ?? 0}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="panel rounded-[32px] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.28em] text-slate-500">
                <Search size={15} /> Power search
              </div>
              <h2 className="mt-1 text-2xl font-black text-slate-950">CNIC, name, or serial number</h2>
            </div>
            <div className="w-full lg:max-w-2xl">
              <div className="flex items-center gap-3 rounded-[26px] border border-slate-200 bg-white px-4 py-3">
                <Search size={18} className="text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by CNIC, Urdu name, father/husband, or serial no."
                  className="w-full border-0 bg-transparent text-base font-semibold outline-none placeholder:text-slate-400"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm">
              <Filter size={14} /> Quick filters
            </div>
            <QuickFilterToggle label="Youth 18-35" active={quickFilters.youth} onToggle={() => toggleQuick('youth')} />
            <QuickFilterToggle label="Student / Teacher" active={quickFilters.studentTeacher} onToggle={() => toggleQuick('studentTeacher')} />
            <QuickFilterToggle label="Male" active={quickFilters.male} onToggle={() => toggleQuick('male')} />
            <QuickFilterToggle label="Female" active={quickFilters.female} onToggle={() => toggleQuick('female')} />
          </div>
        </section>

        <FamilyTree filters={filters} onSelectVoter={setSelectedVoter} refreshToken={revision} />

        <div className="grid gap-5 xl:grid-cols-2">
          <DutyStaffMatcher refresh={reload} />
          <div className="panel rounded-[32px] p-5">
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.28em] text-slate-500">
              <FileText size={15} /> Instructions
            </div>
            <div className="mt-3 space-y-3 text-sm leading-7 text-slate-600">
              <p>Load the ETL-generated SQLite file, then use the family tree to correct Nastaleeq OCR errors and set voter status locally.</p>
              <p>Duty staff matches are written back to the same SQLite file, and the reports section can export walk lists, undecided targets, duty staff, and household influence tables without internet access.</p>
              <div className="rounded-[24px] bg-slate-950 px-4 py-4 text-white">
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.24em] text-white/60">
                  <TreePine size={14} /> Performance posture
                </div>
                <p className="mt-2 text-sm text-white/80">Family rendering is virtualized; tree cards only query their household members when visible. That keeps the interface responsive on very large union councils.</p>
              </div>
              <div className="rounded-[24px] bg-amber-50 px-4 py-4 text-slate-900">
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.24em] text-amber-700">
                  <UserRound size={14} /> OCR correction
                </div>
                <p className="mt-2 text-sm text-slate-700">Tap a voter to open the status modal. Use the pencil icon to edit the Urdu name inline and persist the correction to SQLite immediately.</p>
              </div>
            </div>
          </div>
        </div>

        <ReportsPanel />
      </div>

      <StatusModal
        voter={selectedVoter}
        onClose={() => setSelectedVoter(null)}
        onSave={async (id, status) => {
          await updateStatus(id, status);
          if (selectedVoter?.id === id) {
            setSelectedVoter((current) => (current ? { ...current, voter_status: status } : current));
          }
        }}
      />
    </div>
  );
}

export function AppShell() {
  return (
    <DbProvider>
      <AppInner />
    </DbProvider>
  );
}
