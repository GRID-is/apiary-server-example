import path from 'node:path';

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  workbookDir: process.env.WORKBOOK_DIR ?? path.join(process.cwd(), 'workbooks'),
  maxHeapBytes: parseInt(
    process.env.MAX_HEAP_BYTES ?? String(4 * 1024 * 1024 * 1024),
    10,
  ),
};
