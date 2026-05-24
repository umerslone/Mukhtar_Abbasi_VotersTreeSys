/**
 * Proxy route — forwards multipart uploads to the Python Voter OCR
 * microservice (PaddleOCR + PPStructure) and optionally chains the
 * structured JSON it returns into the existing /api/ingest pipeline so
 * voters land in Postgres in one click.
 *
 * Activated only when OCR_SERVICE_URL is set in the environment. If
 * unset, this route returns 503 and the UI hides the PDF/image
 * uploader, leaving the long-standing JSON/CSV ingest flow untouched.
 *
 * Query params:
 *   ?ingest=1       → after OCR, immediately POST results to ingestVoters
 *   ?batch=<tag>    → batch tag used for ingest (optional)
 *
 * Auth: same NextAuth session check as /api/ingest.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ingestVoters, type IngestVoterRow } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ocrUrl = process.env.OCR_SERVICE_URL;
  if (!ocrUrl) {
    return NextResponse.json(
      {
        error:
          'OCR service is not configured. Set OCR_SERVICE_URL to the Python /voter_ocr_service host (e.g. http://localhost:5005).',
      },
      { status: 503 },
    );
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

  const url = new URL(request.url);
  const wantIngest = url.searchParams.get('ingest') === '1';
  const batch = url.searchParams.get('batch')?.trim() || `ocr-${file.name}`;

  // Forward verbatim to the Python service.
  const forwarded = new FormData();
  forwarded.append('file', file, file.name);

  let ocrResponse: Response;
  try {
    ocrResponse = await fetch(`${ocrUrl.replace(/\/$/, '')}/extract-voters`, {
      method: 'POST',
      body: forwarded,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `OCR service unreachable: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const ocrJson = (await ocrResponse.json().catch(() => null)) as
    | { success?: boolean; data?: IngestVoterRow[]; message?: string }
    | null;

  if (!ocrResponse.ok || !ocrJson?.success) {
    return NextResponse.json(
      { error: ocrJson?.message || `OCR failed (HTTP ${ocrResponse.status})` },
      { status: ocrResponse.status || 502 },
    );
  }

  if (!wantIngest) {
    // Return the OCR payload as-is; the React side can preview before ingesting.
    return NextResponse.json(ocrJson);
  }

  const rows = ocrJson.data ?? [];
  if (rows.length === 0) {
    return NextResponse.json(
      { ...ocrJson, ingest: { error: 'OCR returned zero rows' } },
      { status: 200 },
    );
  }

  try {
    const ingest = await ingestVoters(rows, batch);
    return NextResponse.json({ ...ocrJson, ingest });
  } catch (err) {
    return NextResponse.json(
      { ...ocrJson, ingest: { error: (err as Error).message } },
      { status: 200 },
    );
  }
}
