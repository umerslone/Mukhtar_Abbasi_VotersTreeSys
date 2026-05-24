'use client';

import { useEffect, useState } from 'react';
import type { VoterRecord, VoterStatus } from '@/lib/types';

const STATUSES: VoterStatus[] = ['Supporter', 'Leaning', 'Undecided', 'Opposition', 'Hostile', 'Unsurveyed'];

export function StatusModal({
  voter,
  onClose,
  onSave
}: Readonly<{
  voter: VoterRecord | null;
  onClose: () => void;
  onSave: (id: number, status: VoterStatus) => Promise<void>;
}>) {
  const [status, setStatus] = useState<VoterStatus>('Unsurveyed');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (voter) {
      setStatus(voter.voter_status);
    }
  }, [voter]);

  if (!voter) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
      <div className="panel w-full max-w-lg rounded-3xl p-5 text-slate-900 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.32em] text-slate-500">Status update</p>
            <h3 className="mt-2 text-2xl font-black">{voter.name}</h3>
            <p className="mt-1 text-sm text-slate-600">CNIC: {voter.cnic}</p>
            <p className="text-sm text-slate-600">Household: {voter.address}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setStatus(option)}
              className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                status === option
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(voter.id, status);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
