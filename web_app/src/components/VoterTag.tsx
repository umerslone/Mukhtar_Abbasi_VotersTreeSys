'use client';

import { useTransition } from 'react';
import { updateVoterStatus } from '@/app/actions';
import type { VoterRow, VoterStatus } from '@/lib/types';

export function statusColor(status: string): string {
  switch (status) {
    case 'Supporter':
      return 'bg-green-600 text-white';
    case 'Non-Supporter':
      return 'bg-red-600 text-white';
    case 'Undecided':
      return 'bg-gray-500 text-white';
    default:
      return 'bg-slate-200 text-slate-700';
  }
}

export function VoterTagButton({
  voter,
  onSelect,
  showHead = false,
}: Readonly<{ voter: VoterRow; onSelect: (v: VoterRow) => void; showHead?: boolean }>) {
  return (
    <button
      type="button"
      onClick={() => onSelect(voter)}
      className={`w-full rounded-xl px-3 py-2 text-right ${showHead ? 'border-2 border-amber-400 ' : ''}${statusColor(voter.voter_status)}`}
    >
      <span className="urdu rtl block text-base font-semibold">{voter.name}</span>
      <span className="text-xs">
        {showHead ? 'Head • ' : ''}
        {voter.cnic || 'No CNIC'} • {voter.voter_status}
        {voter.is_on_duty ? ' • 🎖️ On Duty' : ''}
      </span>
    </button>
  );
}

export function TagModal({
  voter,
  onClose,
}: Readonly<{ voter: VoterRow | null; onClose: () => void }>) {
  const [pending, startTransition] = useTransition();
  if (!voter) return null;

  const choose = (status: VoterStatus) => {
    startTransition(async () => {
      await updateVoterStatus(voter.id, status);
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="panel w-full max-w-md p-6">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Tag voter</p>
        <h3 className="urdu rtl mt-1 text-2xl font-black text-slate-900">{voter.name}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {voter.block_code} • Serial {voter.serial_no} • CNIC {voter.cnic || '—'}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={() => choose('Supporter')}
            disabled={pending}
            className="rounded-2xl bg-green-600 px-4 py-4 text-lg font-bold text-white disabled:opacity-60"
          >
            Supporter
          </button>
          <button
            type="button"
            onClick={() => choose('Non-Supporter')}
            disabled={pending}
            className="rounded-2xl bg-red-600 px-4 py-4 text-lg font-bold text-white disabled:opacity-60"
          >
            Non-Supporter
          </button>
          <button
            type="button"
            onClick={() => choose('Undecided')}
            disabled={pending}
            className="rounded-2xl bg-gray-500 px-4 py-4 text-lg font-bold text-white disabled:opacity-60"
          >
            Undecided
          </button>
          <button
            type="button"
            onClick={() => choose('Unsurveyed')}
            disabled={pending}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            Clear tag (Unsurveyed)
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
