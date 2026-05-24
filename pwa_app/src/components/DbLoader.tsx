'use client';

import { useRef, useState } from 'react';
import { Database, Download, Upload } from 'lucide-react';
import { useDatabase } from './DbProvider';

export function DbLoader() {
  const { ready, error, importDatabase, downloadDatabase } = useDatabase();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel rounded-[32px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500">Local database</p>
          <h3 className="mt-1 text-2xl font-black text-slate-950">SQLite persistence on device</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Load the generated voters_db.sqlite into browser storage, then continue editing completely offline.</p>
        </div>
        <div className={`rounded-2xl px-3 py-2 text-sm font-semibold ${ready ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
          <Database size={14} className="mr-1 inline-block" /> {ready ? 'Loaded' : 'Awaiting import'}
        </div>
      </div>

      {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white"
        >
          <Upload size={16} /> Import voters_db.sqlite
        </button>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            try {
              await downloadDatabase();
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
        >
          <Download size={16} /> {busy ? 'Preparing…' : 'Download current database'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".sqlite,.db,application/x-sqlite3"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            setBusy(true);
            try {
              await importDatabase(file);
            } finally {
              setBusy(false);
              event.target.value = '';
            }
          }}
        />
      </div>
    </section>
  );
}
