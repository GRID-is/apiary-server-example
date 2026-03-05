# Apiary REST Server

This repository contains an example REST server for the [Apiary spreadsheet engine](https://grid.is/engine).

## Overview

The REST server is written in TypeScript and based on [hono](https://hono.dev/).  It keeps uploaded workbooks in memory for performance reasons, and persists the original .xlsx file and the model binary on disk.  The workbook store will evict workbook models from memory when under pressure, but can load the model binary back into memory on demand.

### Endpoints

- `POST /workbook` — upload a new workbook (.xlsx file) using multi-part HTTP form uploads
- `POST /workbook/:id` — upload a new version of a workbook (.xlsx file) using multi-part HTTP form uploads
- `POST /query/:id` — run a query against a loaded workbook
- `GET /workbooks` — list the workbooks currently available in the server

### Query

The query is a JSON object:
```json
{
  "apply": {
    "A1": 42,
    "B2": "hello"
  },
  "read": ["C1", "D1:D10"]
}
```

`apply` sets cell values before reading — this is useful for "what-if" scenarios. `read` is a list of A1-style cell or range references to return.

The query does not persist changes between requests; it is not an editing endpoint.

### Workbook object

```json
{
  "id": "uuid",
  "version": 1,
  "filename": "Book1.xlsx",
  "status": "hot"
}
```

The workbook status indicates whether it's currently in memory (`hot`) or only on disk (`cold`). A cold workbook will be loaded into memory on the first query, making that request slower. If the workbook failed to load it will be in an `error` state.

## Running

```sh
npm install
npm run dev
```

The server listens on port 3000 by default. Configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `WORKBOOK_DIR` | `./workbooks` | Directory for persisted workbook data |
| `MAX_HEAP_BYTES` | `4294967296` (4 GiB) | Heap threshold for LRU eviction |

### Quick test

```sh
# Upload a workbook
curl -F "file=@Book1.xlsx" http://localhost:3000/workbook

# List workbooks
curl http://localhost:3000/workbooks

# Query a cell
curl -X POST -H 'Content-Type: application/json' \
  -d '{"read": ["A1"]}' \
  http://localhost:3000/query/{id}
```
