/**
 * Paddle OCR proxy — forwards multipart uploads to the local Flask
 * voter_ocr_service/ (PaddleOCR + PPStructure) and returns rows in the
 * same shape as `extractVotersFromBytes` so the route handler can treat
 * both engines uniformly.
 *
 * Strategy (mirrors Elect_Voters_Insights/ai_pipeline/azure_ocr.py):
 *   - For PDFs, split into N-page chunks in-memory before calling Paddle.
 *     This caps any single OCR call's wall-clock time so a slow page can't
 *     starve the whole job, and avoids one giant multipart upload that
 *     Node/undici tends to drop with "fetch failed" past ~5 min.
 *   - Submit chunks in parallel with a small concurrency cap (Paddle is
 *     CPU/GPU-bound on the droplet — too much parallelism trashes it).
 *   - Retry each chunk independently with exponential backoff. Aggregate
 *     successful chunks; throw if every chunk failed.
 *   - For non-PDF (jpg/png/etc.) just forward as-is.
 *
 * Configuration (env, all optional):
 *   OCR_SERVICE_URL         e.g. http://127.0.0.1:5005   (required)
 *   OCR_PADDLE_TIMEOUT_MS   per-chunk timeout, default 600_000 (10 min)
 *   OCR_PADDLE_CHUNK_PAGES  default 2 — pages per OCR call
 *   OCR_PADDLE_CONCURRENCY  default 3 — parallel chunks
 *   OCR_PADDLE_RETRIES      default 3 — attempts per chunk
 */
import type { IngestVoterRow } from '@/lib/ingest';
import type { OcrExtractResult } from '@/lib/ocr_extract';
// undici is bundled with Node and powers the global `fetch`. We import the
// Agent directly so we can override its 300s headers/body timeouts — Paddle
// can take 5+ minutes on a single chunk if the model is cold.
import { Agent } from 'undici';
import { chunkPdf, runWithConcurrency, type PdfChunk } from '@/lib/pdf_chunk';

export function paddleConfigured(): boolean {
  return Boolean(process.env.OCR_SERVICE_URL?.trim());
}

interface PaddleResponse {
  success: boolean;
  message?: string;
  data?: IngestVoterRow[];
  total_voters?: number;
  polling_station?: string;
  pages?: number;
}

interface ChunkResult {
  label: string;
  rows: IngestVoterRow[];
  pollingStation: string;
  pages: number;
}

const isPdf = (file: { type?: string; name?: string }): boolean => {
  if (file.type === 'application/pdf') return true;
  return Boolean(file.name && file.name.toLowerCase().endsWith('.pdf'));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postOneChunk(args: {
  url: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  timeoutMs: number;
  label: string;
}): Promise<ChunkResult> {
  const { url, bytes, filename, contentType, timeoutMs, label } = args;
  const blob = new Blob([bytes as BlobPart], { type: contentType });
  const fd = new FormData();
  fd.append('file', blob, filename);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const dispatcher = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    keepAliveTimeout: timeoutMs,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: fd,
      signal: ctrl.signal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ dispatcher } as any),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `chunk ${label} fetch failed (${bytes.byteLength} B): ${detail}`,
    );
  } finally {
    clearTimeout(timer);
    dispatcher.close().catch(() => {});
  }

  const json = (await res.json().catch(() => null)) as PaddleResponse | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || `chunk ${label} HTTP ${res.status}`);
  }
  return {
    label,
    rows: json.data ?? [],
    pollingStation: json.polling_station ?? '',
    pages: json.pages ?? 0,
  };
}

async function withRetries<T>(
  label: string,
  attempts: number,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      const wait = 2 ** attempt * 1000; // 2s, 4s, 8s
      // eslint-disable-next-line no-console
      console.warn(
        `[ocr-paddle] ${label} attempt ${attempt} failed (${(err as Error).message}); retrying in ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function extractVotersViaPaddle(
  file: File,
): Promise<OcrExtractResult> {
  const base = process.env.OCR_SERVICE_URL?.trim();
  if (!base) {
    throw new Error(
      'PaddleOCR engine selected but OCR_SERVICE_URL is not configured.',
    );
  }
  const url = `${base.replace(/\/$/, '')}/extract-voters`;

  const timeoutMs = Number(process.env.OCR_PADDLE_TIMEOUT_MS ?? 600_000);
  const chunkPages = Math.max(1, Number(process.env.OCR_PADDLE_CHUNK_PAGES ?? 2));
  const concurrency = Math.max(1, Number(process.env.OCR_PADDLE_CONCURRENCY ?? 3));
  const retries = Math.max(1, Number(process.env.OCR_PADDLE_RETRIES ?? 3));

  const fileBytes = new Uint8Array(await file.arrayBuffer());

  // Non-PDF: forward the original file as a single OCR call.
  if (!isPdf(file)) {
    const r = await withRetries(file.name || 'image', retries, () =>
      postOneChunk({
        url,
        bytes: fileBytes,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        timeoutMs,
        label: file.name || 'image',
      }),
    );
    return {
      voters: r.rows,
      pollingStation: r.pollingStation,
      totalTables: 0,
      totalPages: r.pages,
      totalVoters: r.rows.length,
    };
  }

  // PDF: chunk it before OCR so each call is bounded and retryable.
  let chunks: PdfChunk[];
  try {
    chunks = await chunkPdf(fileBytes, chunkPages);
  } catch (err) {
    throw new Error(`Could not split PDF: ${(err as Error).message}`);
  }
  if (chunks.length === 0) {
    throw new Error('PDF has no pages.');
  }

  // eslint-disable-next-line no-console
  console.info(
    `[ocr-paddle] ${file.name}: ${chunks.length} chunks (${chunkPages} pages each), concurrency=${concurrency}, retries=${retries}`,
  );

  const settled = await runWithConcurrency(chunks, concurrency, (chunk) =>
    withRetries(chunk.label, retries, () =>
      postOneChunk({
        url,
        bytes: chunk.bytes,
        filename: `${file.name.replace(/\.pdf$/i, '')}_${chunk.label}.pdf`,
        contentType: 'application/pdf',
        timeoutMs,
        label: chunk.label,
      }),
    ),
  );

  const succeeded: ChunkResult[] = [];
  const failed: { label: string; error: string }[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled') {
      succeeded.push(s.value);
    } else {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      failed.push({ label: chunks[i].label, error: reason });
    }
  }

  if (succeeded.length === 0) {
    const summary = failed.map((f) => `${f.label}: ${f.error}`).join('; ');
    throw new Error(`All ${chunks.length} chunks failed. ${summary}`);
  }

  const voters = succeeded.flatMap((c) => c.rows);
  const pollingStation =
    succeeded.find((c) => c.pollingStation)?.pollingStation ?? '';
  const totalPages = succeeded.reduce((acc, c) => acc + (c.pages || 0), 0);

  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ocr-paddle] ${failed.length}/${chunks.length} chunks failed:`,
      failed,
    );
  }

  return {
    voters,
    pollingStation,
    totalTables: 0,
    totalPages,
    totalVoters: voters.length,
  };
}
