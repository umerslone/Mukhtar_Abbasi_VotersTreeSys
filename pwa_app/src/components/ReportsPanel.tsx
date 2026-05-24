'use client';

import { useDatabase } from './DbProvider';
import { exportDutyStaffTargets, exportFamilyInfluenceReport, exportPollingStationWalkList, exportUndecidedTargets } from '@/lib/reports';

export function ReportsPanel() {
  const { db } = useDatabase();

  return (
    <section className="panel rounded-[32px] p-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500">Action-ready reporting</p>
        <h3 className="mt-1 text-2xl font-black text-slate-950">Offline exports from live SQLite</h3>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <button onClick={() => exportPollingStationWalkList(db)} className="rounded-[24px] bg-slate-950 px-4 py-4 text-left text-white">
          <div className="text-sm font-bold">Polling Station Walk-List</div>
          <div className="mt-1 text-xs text-white/70">Grouped by address with empty checkboxes.</div>
        </button>
        <button onClick={() => exportUndecidedTargets(db)} className="rounded-[24px] bg-amber-500 px-4 py-4 text-left text-slate-950">
          <div className="text-sm font-bold">Undecided Targets Ward-Wise</div>
          <div className="mt-1 text-xs text-slate-950/70">Exports Undecided and Unsurveyed voters.</div>
        </button>
        <button onClick={() => exportDutyStaffTargets(db)} className="rounded-[24px] bg-violet-600 px-4 py-4 text-left text-white">
          <div className="text-sm font-bold">Duty Staff & Postal Targets</div>
          <div className="mt-1 text-xs text-white/70">All voters flagged as on duty.</div>
        </button>
        <button onClick={() => exportFamilyInfluenceReport(db)} className="rounded-[24px] bg-emerald-600 px-4 py-4 text-left text-white">
          <div className="text-sm font-bold">Family Influence Report</div>
          <div className="mt-1 text-xs text-white/70">Heads sorted by total household votes.</div>
        </button>
      </div>
    </section>
  );
}
