# ETL Pipeline

Run the offline voter ingestion pipeline against scanned electoral roll PDFs or images.

## Environment

Set these variables before running:

- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`
- `AZURE_DOCUMENT_INTELLIGENCE_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_VERSION` (optional)
- `AZURE_OPENAI_DEPLOYMENT` (optional, defaults to `gpt-4o-mini`)

## Example

```bash
python voters_etl.py --input "C:\\data\\roll.pdf" --output voters_db.sqlite
```
