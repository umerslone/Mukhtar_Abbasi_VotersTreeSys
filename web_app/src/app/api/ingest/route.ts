import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ingestVoters, parseCsv, type IngestVoterRow } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB — must stay <= proxyClientMaxBodySize in next.config.mjs

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Send a multipart/form-data upload' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[ingest] formData() failed:', detail);
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
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 400 });
  }

  const customBatch = (form.get('batch') as string | null)?.trim();
  const batch = customBatch || defaultBatchName(file.name);

  const name = file.name.toLowerCase();
  let rows: IngestVoterRow[] = [];

  try {
    if (name.endsWith('.json')) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ error: 'JSON must be an array of voter objects' }, { status: 400 });
      }
      rows = parsed as IngestVoterRow[];
    } else if (name.endsWith('.csv')) {
      rows = parseCsv(await file.text());
    } else if (name.endsWith('.pdf') || name.endsWith('.sqlite') || name.endsWith('.db')) {
      return NextResponse.json(
        {
          error:
            'PDF/SQLite uploads must be processed locally first. Run `python etl_pipeline/voters_etl.py --input your.pdf --output out.json` and upload the resulting .json file.',
        },
        { status: 400 }
      );
    } else {
      return NextResponse.json({ error: 'Unsupported file type. Use .json or .csv' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: `Parse failed: ${(err as Error).message}` }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows found in upload' }, { status: 400 });
  }

  try {
    const result = await ingestVoters(rows, batch);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: `Ingest failed: ${(err as Error).message}` }, { status: 500 });
  }
}

function defaultBatchName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${stem || 'upload'}-${stamp}`;
}
