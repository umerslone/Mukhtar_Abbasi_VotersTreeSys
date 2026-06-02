/**
 * POST /api/ocr-extract
 *
 * OCR a voter list (PDF / JPG / PNG) and (optionally) ingest the rows.
 *
 * Engine selection (?engine=azure|paddle, default azure):
 *   - azure  : in-process Azure Document Intelligence (runs on Vercel,
 *              DO App Platform, any Node host)
 *   - paddle : proxies to the self-hosted Flask service in
 *              voter_ocr_service/ (PaddleOCR + PPStructure). Requires
 *              OCR_SERVICE_URL env var pointing at the Flask host.
 *
 * Other query params:
 *   ?ingest=1     chain the OCR result into ingestVoters() in one shot
 *   ?batch=<tag>  batch tag for ingest (defaults to 'ocr-<filename>')
 *
 * Auth: same NextAuth session check as /api/ingest.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { ingestVoters } from '@/lib/ingest';
import { extractVotersFromBytes, type OcrExtractResult } from '@/lib/ocr_extract';
import { extractVotersViaPaddle, paddleConfigured } from '@/lib/ocr_paddle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Azure DI is async; allow up to 5 minutes for big PDFs (Pro / Fluid plans).
export const maxDuration = 300;

// Hard cap on the uploaded file. Must stay <= experimental.proxyClientMaxBodySize
// in next.config.mjs (currently 200 MB). Bump both together if you need more.
const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[ocr-extract] formData() failed:', detail);
    return NextResponse.json(
      { error: `Could not parse upload: ${detail}` },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  }

  const url = new URL(request.url);
  const wantIngest = url.searchParams.get('ingest') === '1';
  const batch = url.searchParams.get('batch')?.trim() || `ocr-${file.name}`;
  const requestedEngine = (url.searchParams.get('engine') || 'azure').toLowerCase();
  const engine: 'azure' | 'paddle' = requestedEngine === 'paddle' ? 'paddle' : 'azure';

  if (engine === 'paddle' && !paddleConfigured()) {
    return NextResponse.json(
      {
        error:
          'PaddleOCR engine requested but OCR_SERVICE_URL is not set. Start the Flask service in voter_ocr_service/ and configure the env var, or use ?engine=azure.',
      },
      { status: 503 },
    );
  }

  const started = Date.now();
  let extract: OcrExtractResult;
  try {
    if (engine === 'paddle') {
      extract = await extractVotersViaPaddle(file);
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      extract = await extractVotersFromBytes(bytes, file.name);
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, engine, error: `OCR failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  const elapsedSeconds = Math.round((Date.now() - started) / 100) / 10;

  const basePayload = {
    success: true,
    engine,
    total_voters: extract.totalVoters,
    polling_station: extract.pollingStation,
    pages: extract.totalPages,
    tables: extract.totalTables,
    elapsed_seconds: elapsedSeconds,
    data: extract.voters,
  };

  if (!wantIngest) {
    return NextResponse.json(basePayload);
  }

  if (extract.voters.length === 0) {
    return NextResponse.json(
      { ...basePayload, ingest: { error: 'OCR returned zero rows' } },
      { status: 200 },
    );
  }

  try {
    const ingest = await ingestVoters(extract.voters, batch);
    return NextResponse.json({ ...basePayload, ingest });
  } catch (err) {
    return NextResponse.json(
      { ...basePayload, ingest: { error: (err as Error).message } },
      { status: 200 },
    );
  }
}
