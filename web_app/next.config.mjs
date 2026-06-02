/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lift the default 10MB body cap so OCR uploads (scanned voter lists, multi-page PDFs)
  // can flow through /api/ocr-extract and /api/ingest. Match the route-handler MAX_BYTES (50MB).
  experimental: {
    proxyClientMaxBodySize: '200mb',
    serverActions: {
      bodySizeLimit: '200mb',
    },
  },
  // Silence the multi-lockfile warning by pinning the tracing root to the web_app folder.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
