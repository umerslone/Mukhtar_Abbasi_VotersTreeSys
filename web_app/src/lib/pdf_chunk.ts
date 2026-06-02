/**
 * Split a PDF buffer into N-page chunks (each chunk is a standalone PDF).
 *
 * Mirrors the pattern from Elect_Voters_Insights/ai_pipeline/azure_ocr.py:
 * keep per-OCR-call payloads small so a single slow page doesn't stall the
 * whole job, and so failed pages can be retried independently.
 */
import { PDFDocument } from 'pdf-lib';

export interface PdfChunk {
  /** 1-based human label, e.g. "1-2" or "5". */
  label: string;
  /** Inclusive 1-based page range. */
  startPage: number;
  endPage: number;
  /** Standalone PDF bytes containing only the pages in [startPage, endPage]. */
  bytes: Uint8Array;
}

export async function chunkPdf(
  src: Uint8Array,
  pagesPerChunk = 2,
): Promise<PdfChunk[]> {
  if (pagesPerChunk < 1) pagesPerChunk = 1;
  const srcDoc = await PDFDocument.load(src, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const chunks: PdfChunk[] = [];

  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, totalPages);
    const out = await PDFDocument.create();
    const indices: number[] = [];
    for (let i = start; i < end; i++) indices.push(i);
    const copied = await out.copyPages(srcDoc, indices);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    const startPage = start + 1;
    const endPage = end;
    chunks.push({
      label: endPage > startPage ? `${startPage}-${endPage}` : `${startPage}`,
      startPage,
      endPage,
      bytes,
    });
  }
  return chunks;
}

/**
 * Run an async task per item with a fixed concurrency cap. Order of `tasks`
 * is preserved in the returned settled results.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const value = await worker(items[i], i);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}
