import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { convert as xlsxConvert } from '@borgar/xlsx-convert';
import { Model, Reference, isRef } from '@grid-is/apiary';
import { WorkbookStore } from './store/WorkbookStore.ts';

const QuerySchema = z.object({
  apply: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  read: z.array(z.string()).min(1),
});

export function createRoutes(store: WorkbookStore): Hono {
  const app = new Hono();

  app.post('/workbook', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'Missing file in multipart upload' }, 400);
    }

    const filename = file.name || 'workbook.xlsx';
    const bytes = await file.arrayBuffer();
    const xlsxBuffer = Buffer.from(bytes);

    const tempPath = join(tmpdir(), `${uuidv4()}.xlsx`);
    try {
      await writeFile(tempPath, xlsxBuffer);
      const jsf = await xlsxConvert(tempPath);
      jsf.name = filename;
      const model = Model.fromJSF(jsf);

      const id = uuidv4();
      const result = store.storeNew(id, filename, model, xlsxBuffer);

      return c.json({ id: result.id, version: result.version, filename });
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });

  app.post('/workbook/:id', async (c) => {
    const id = c.req.param('id');

    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return c.json({ error: 'Missing file in multipart upload' }, 400);
    }

    const bytes = await file.arrayBuffer();
    const xlsxBuffer = Buffer.from(bytes);

    const tempPath = join(tmpdir(), `${uuidv4()}.xlsx`);
    try {
      await writeFile(tempPath, xlsxBuffer);
      const jsf = await xlsxConvert(tempPath);
      jsf.name = file.name || 'workbook.xlsx';
      const model = Model.fromJSF(jsf);

      const result = store.storeNewVersion(id, model, xlsxBuffer);

      return c.json({ id: result.id, version: result.version });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Workbook not found')) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });

  app.post('/query/:id', async (c) => {
    const id = c.req.param('id');

    const body = await c.req.json();
    const parsed = QuerySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { apply, read } = parsed.data;

    try {
      const model = store.get(id);

      // If applying values, we need to reset state afterwards
      const hasApply = apply && Object.keys(apply).length > 0;

      if (hasApply) {
        for (const [target, value] of Object.entries(apply!)) {
          model.write(target, value as string | number | boolean | null);
        }
        model.recalculate();
      }

      const results: Record<string, unknown> = {};
      for (const expression of read) {
        const formula = expression.replace(/^=?/, '=');
        const result = model.runFormula(formula, null);
        results[expression] = formatResult(result);
      }

      return c.json(results);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Workbook not found')) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  app.get('/workbooks', (c) => {
    const workbooks = store.listWorkbooks();
    return c.json(workbooks);
  });

  return app;
}

function formatResult(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  // For References and other complex objects, extract what we can
  if (typeof value === 'object' && value !== null) {
    if ('valueOf' in value && typeof value.valueOf === 'function') {
      const v = value.valueOf();
      if (v !== value) return v;
    }
  }
  return String(value);
}
