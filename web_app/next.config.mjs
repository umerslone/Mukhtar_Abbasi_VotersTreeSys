/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lift the default 10MB body cap so OCR uploads (scanned voter lists, multi-page PDFs)
  // can flow through /api/ocr-extract and /api/ingest. On Next 15.x the key is
  // `middlewareClientMaxBodySize`; it was renamed to `proxyClientMaxBodySize` in v16 — switch
  // when upgrading. Must match route-handler MAX_BYTES (currently 200MB).
  experimental: {
    middlewareClientMaxBodySize: '200mb',
    serverActions: {
      bodySizeLimit: '200mb',
    },
  },
  // Silence the multi-lockfile warning by pinning the tracing root to the web_app folder.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
