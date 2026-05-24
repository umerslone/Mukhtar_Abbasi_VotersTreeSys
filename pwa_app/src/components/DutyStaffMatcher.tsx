'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useDatabase } from './DbProvider';
import { matchDutyStaffRows, parseDutyStaffWorkbook } from '@/lib/matcher';
import type { DutyStaffMatchResult } from '@/lib/types';

export function DutyStaffMatcher({ refresh }: Readonly<{ refresh: () => Promise<void> }>) {
  const { db } = useDatabase();
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState<DutyStaffMatchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Drop an XLSX duty list to run the waterfall matcher.');

  const dropzone = useDropzone({
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    multiple: false,
    onDrop: async (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (!file) {
        return;
      }

      setLoading(true);
      setFileName(file.name);
      try {
        const rows = await parseDutyStaffWorkbook(file);
        const matches = await matchDutyStaffRows(db, rows);
        setResults(matches);
        setMessage(`Processed ${rows.length} rows and matched ${matches.filter((entry) => entry.matched).length} voters.`);
        await refresh();
      } finally {
        setLoading(false);
      }
    }
  });

  return (
    <section className="panel rounded-[32px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500">Duty staff matcher</p>
          <h3 className="mt-1 text-2xl font-black text-slate-950">Waterfall postal-ballot matching</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Stage 1 exact CNIC, Stage 2 exact name + father/husband, Stage 3 Levenshtein distance 2.</p>
        </div>
        <div className="rounded-2xl bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-900">🎖️ Duty flags persist in SQLite</div>
      </div>

      <div
        {...dropzone.getRootProps()}
        className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-[28px] border-2 border-dashed border-slate-300 bg-white/75 px-6 py-10 text-center transition hover:border-slate-950 hover:bg-white"
      >
        <input {...dropzone.getInputProps()} />
        <UploadCloud size={34} className="text-slate-500" />
        <p className="mt-3 text-lg font-bold text-slate-900">Upload government employee XLSX</p>
        <p className="mt-1 text-sm text-slate-500">Drag and drop or click to choose a file.</p>
        {fileName ? <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"><FileSpreadsheet size={14} /> {fileName}</p> : null}
      </div>

      <div className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">{loading ? 'Matching in progress…' : message}</div>

      {results.length ? (
        <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200 bg-white">
          <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            <div className="col-span-5">Source</div>
            <div className="col-span-2">Stage</div>
            <div className="col-span-5">Matched voter</div>
          </div>
          <div className="max-h-[320px] overflow-auto">
            {results.map((result) => (
              <div key={result.sourceIndex} className="grid grid-cols-12 gap-2 border-b border-slate-100 px-4 py-3 text-sm">
                <div className="col-span-5">
                  <div className="font-semibold text-slate-900">{String(result.sourceRow.name ?? '')}</div>
                  <div className="text-xs text-slate-500">CNIC {String(result.sourceRow.cnic ?? '')}</div>
                </div>
                <div className="col-span-2 font-bold text-slate-700">{result.stage}</div>
                <div className="col-span-5">
                  {result.matched ? (
                    <div className="font-semibold text-emerald-700">{result.voterName}</div>
                  ) : (
                    <div className="text-slate-500">No match</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
