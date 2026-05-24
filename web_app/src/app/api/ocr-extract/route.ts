/**
 * POST /api/ocr-extract
 *
 * Direct Azure Document Intelligence call — no Python sidecar, runs on
 * Vercel. Accepts a PDF or image, returns Prisma-shaped voter rows. With
 * `?ingest=1` the result is chained straight into `ingestVoters()` so a
 * single upload populates the database end-to-end.
 *
 * Auth: same NextAuth session check as /api/ingest.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { ingestVoters } from '@/lib/ingest';
import { extractVotersFromBytes } from '@/lib/ocr_extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Azure DI is async; allow up to 5 minutes for big PDFs (Pro / Fluid plans).
export const maxDuration = 300;

// Vercel body cap: ~4.5 MB Hobby, 50 MB Pro Fluid. We honor 50 MB here.
const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not parse upload' }, { status: 400 });
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

  const started = Date.now();
  let extract;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    extract = await extractVotersFromBytes(bytes, file.name);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `OCR failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
  const elapsedSeconds = Math.round((Date.now() - started) / 100) / 10;

  const basePayload = {
    success: true,
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
