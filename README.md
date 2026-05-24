# Standalone Offline Voter Management System

This repository contains two parts:

- `etl_pipeline/`: Python ETL pipeline for OCR extraction, AI cleanup, and SQLite population.
- `pwa_app/`: Offline-first Next.js PWA that loads and edits the SQLite database locally.

Both parts share the same voter schema and are designed for zero-connectivity field use.
