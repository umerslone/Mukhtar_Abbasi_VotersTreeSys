'use client';

import { useState } from 'react';
import Link from 'next/link';

interface IngestResult {
  total: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  batch: string;
  error?: string;
}

interface OcrResult {
  success: boolean;
  job_id?: string;
  total_voters?: number;
  polling_station?: string;
  pages?: number;
  elapsed_seconds?: number;
  message?: string;
  ingest?: IngestResult & { error?: string };
}

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── PDF/Image OCR (Python microservice) ─────────────────────────
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrBatch, setOcrBatch] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  async function submitOcr(e: React.FormEvent) {
    e.preventDefault();
    setOcrError(null);
    setOcrResult(null);
    if (!ocrFile) {
      setOcrError('Choose a PDF or image first.');
      return;
    }
    setOcrBusy(true);
    const fd = new FormData();
    fd.append('file', ocrFile);
    const qs = new URLSearchParams({ ingest: '1' });
    if (ocrBatch.trim()) qs.set('batch', ocrBatch.trim());
    try {
      const res = await fetch(`/api/ocr-extract?${qs.toString()}`, { method: 'POST', body: fd });
      const data = (await res.json()) as OcrResult & { error?: string };
      if (!res.ok) {
        setOcrError(data.error || data.message || `OCR failed (HTTP ${res.status})`);
      } else {
        setOcrResult(data);
      }
    } catch (err) {
      setOcrError((err as Error).message);
    } finally {
      setOcrBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file) {
      setError('Choose a .json or .csv file first.');
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    if (batch.trim()) fd.append('batch', batch.trim());
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: fd });
      const data: IngestResult = await res.json();
      if (!res.ok) {
        setError(data.error || `Upload failed (HTTP ${res.status})`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <header className="panel flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-slate-500">Voter Management SaaS</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">Ingest Voters</h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload voter lists. Existing voters (by CNIC) are <b>never overwritten</b> — they just get tagged with this batch.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm font-semibold">
          <Link href="/" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Dashboard</Link>
          <Link href="/blocks" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Ward / PS</Link>
          <Link href="/ingest" className="rounded-full bg-slate-900 px-4 py-2 text-white">Ingest</Link>
          <Link href="/duty-staff" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Duty Staff</Link>
          <Link href="/exports" className="rounded-full border border-slate-300 px-4 py-2 text-slate-700">Exports</Link>
        </nav>
      </header>

      <form onSubmit={submit} className="panel space-y-4 p-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700">Voter file (.json or .csv)</label>
          <input
            type="file"
            accept=".json,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">
            For PDFs: first run <code className="rounded bg-slate-100 px-1.5 py-0.5">python etl_pipeline/voters_etl.py --input file.pdf --output out.json</code>, then upload <code className="rounded bg-slate-100 px-1.5 py-0.5">out.json</code> here.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700">Batch tag (optional)</label>
          <input
            type="text"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="auto-generated from filename"
            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">Voters present in multiple batches get all tags appended for audit.</p>
        </div>

        <button
          type="submit"
          disabled={busy || !file}
          className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Uploading…' : 'Ingest'}
        </button>
      </form>

      {error && (
        <div className="panel border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <b>Error:</b> {error}
        </div>
      )}

      {result && (
        <div className="panel space-y-3 p-5">
          <h2 className="text-lg font-bold text-slate-900">Ingest complete</h2>
          <p className="text-sm text-slate-500">Batch tag: <code className="rounded bg-slate-100 px-1.5 py-0.5">{result.batch}</code></p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total rows" value={result.total} />
            <Stat label="Inserted" value={result.inserted} tone="green" />
            <Stat label="Duplicates (tagged)" value={result.duplicates} tone="amber" />
            <Stat label="Invalid (skipped)" value={result.invalid} tone="red" />
          </div>
        </div>
      )}

      {/* ── Direct PDF / Image OCR (Python microservice) ────────── */}
      <form onSubmit={submitOcr} className="panel space-y-4 p-5">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Or upload a scanned PDF / image</h2>
          <p className="mt-1 text-sm text-slate-500">
            Routed to the Urdu OCR microservice (PaddleOCR + PPStructure). Extracted voters are
            ingested into the database in the same step — no local Python required.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Requires <code className="rounded bg-amber-100 px-1.5 py-0.5">OCR_SERVICE_URL</code> in <code className="rounded bg-amber-100 px-1.5 py-0.5">web_app/.env</code>.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700">Voter list (.pdf / .jpg / .png)</label>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp"
            onChange={(e) => setOcrFile(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
          />
          <p className="mt-2 text-xs text-slate-500">First request can take ~60 s while the OCR models warm up.</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700">Batch tag (optional)</label>
          <input
            type="text"
            value={ocrBatch}
            onChange={(e) => setOcrBatch(e.target.value)}
            placeholder="auto-generated from filename"
            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={ocrBusy || !ocrFile}
          className="rounded-full bg-indigo-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {ocrBusy ? 'Extracting (may take a minute)…' : 'Run OCR + Ingest'}
        </button>
      </form>

      {ocrError && (
        <div className="panel border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <b>OCR error:</b> {ocrError}
        </div>
      )}

      {ocrResult && (
        <div className="panel space-y-3 p-5">
          <h2 className="text-lg font-bold text-slate-900">OCR complete</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Voters extracted" value={ocrResult.total_voters || 0} tone="green" />
            <Stat label="Pages" value={ocrResult.pages || 0} />
            <Stat label="Seconds" value={Math.round(ocrResult.elapsed_seconds || 0)} />
            {ocrResult.ingest ? (
              <Stat label="Inserted" value={ocrResult.ingest.inserted || 0} tone="green" />
            ) : (
              <Stat label="Job" value={0} />
            )}
          </div>
          {ocrResult.polling_station && (
            <p className="text-sm text-slate-500">
              Polling station: <code className="rounded bg-slate-100 px-1.5 py-0.5">{ocrResult.polling_station}</code>
            </p>
          )}
          {ocrResult.ingest?.error && (
            <p className="text-sm text-red-600"><b>Ingest skipped:</b> {ocrResult.ingest.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'red' }) {
  const colorMap: Record<string, string> = {
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-black ${tone ? colorMap[tone] : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
