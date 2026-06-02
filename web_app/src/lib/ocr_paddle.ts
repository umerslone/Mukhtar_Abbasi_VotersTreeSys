/**
 * Paddle OCR proxy — forwards a multipart upload to the local Flask
 * voter_ocr_service/ (PaddleOCR + PPStructure) and returns its result
 * in the same shape as `extractVotersFromBytes` so the route handler
 * can treat both engines uniformly.
 *
 * The Flask service is expected to listen on OCR_SERVICE_URL (e.g.
 * http://127.0.0.1:5005 when colocated on the same Droplet) and return
 * `{ success, data, total_voters, polling_station, pages, ... }` with
 * `data` already shaped like Prisma's Voter model.
 */
import type { IngestVoterRow } from '@/lib/ingest';
import type { OcrExtractResult } from '@/lib/ocr_extract';

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

  // Read the whole file into memory before re-uploading. Passing the original
  // File from request.formData() straight into a new fetch() body is fragile
  // under Node/undici for large multipart bodies (frequent "fetch failed"
  // mid-stream). Buffering once gives us a stable Content-Length-bounded body.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const blob = new Blob([bytes], { type: file.type || 'application/octet-stream' });
  const fd = new FormData();
  fd.append('file', blob, file.name);

  // Generous timeout — Paddle can take 60-180 s on a fresh process for a big PDF.
  const timeoutMs = Number(process.env.OCR_PADDLE_TIMEOUT_MS ?? 600_000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: fd, signal: ctrl.signal });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PaddleOCR service unreachable at ${url} (${bytes.byteLength} bytes): ${detail}`,
    );
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json().catch(() => null)) as PaddleResponse | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || `PaddleOCR HTTP ${res.status}`);
  }

  return {
    voters: json.data ?? [],
    pollingStation: json.polling_station ?? '',
    totalTables: 0,
    totalPages: json.pages ?? 0,
    totalVoters: json.total_voters ?? json.data?.length ?? 0,
  };
}
