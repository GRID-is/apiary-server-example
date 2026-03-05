import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { v4 as uuidv4 } from 'uuid';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { convert as xlsxConvert } from '@borgar/xlsx-convert';
import { Model } from '@grid-is/apiary';
import { WorkbookStore } from './store/WorkbookStore.ts';
import { readCells, type CellInfo, type MultiCellResult } from './readCells.ts';
import {
  QueryRequestSchema,
  QueryResponseSchema,
  WorkbookInfoSchema,
  UploadResponseSchema,
  ErrorResponseSchema,
} from './schemas.ts';

// -- Route definitions --

const uploadWorkbookRoute = createRoute({
  method: 'post',
  path: '/workbook',
  summary: 'Upload a new workbook',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({ type: 'string', format: 'binary' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UploadResponseSchema } },
      description: 'Workbook uploaded successfully',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Bad request',
    },
  },
});

const uploadNewVersionRoute = createRoute({
  method: 'post',
  path: '/workbook/{id}',
  summary: 'Upload a new version of a workbook',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.any().openapi({ type: 'string', format: 'binary' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UploadResponseSchema } },
      description: 'New version uploaded successfully',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Bad request',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Workbook not found',
    },
  },
});

const queryRoute = createRoute({
  method: 'post',
  path: '/query/{id}',
  summary: 'Query a workbook',
  description: 'Apply optional input values and read cell expressions from a workbook.',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': { schema: QueryRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: QueryResponseSchema } },
      description: 'Query results keyed by expression',
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Bad request',
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Workbook not found',
    },
  },
});

const listWorkbooksRoute = createRoute({
  method: 'get',
  path: '/workbooks',
  summary: 'List workbooks',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(WorkbookInfoSchema) } },
      description: 'List of workbooks with their status',
    },
  },
});

// -- Handlers --

export function createRoutes(store: WorkbookStore): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(uploadWorkbookRoute, async (c) => {
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

      return c.json({ id: result.id, version: result.version, filename }, 200);
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });

  app.openapi(uploadNewVersionRoute, async (c) => {
    const { id } = c.req.valid('param');

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

      return c.json({ id: result.id, version: result.version, filename: file.name || 'workbook.xlsx' }, 200);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Workbook not found')) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });

  app.openapi(queryRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { apply, read } = c.req.valid('json');

    try {
      const model = store.get(id);

      const hasApply = apply && Object.keys(apply).length > 0;
      if (hasApply) {
        for (const [target, value] of Object.entries(apply!)) {
          model.write(target, value as string | number | boolean | null);
        }
        model.recalculate();
      }

      const results: Record<string, CellInfo | MultiCellResult> = {};
      for (const expression of read) {
        results[expression] = readCells(model, expression);
      }

      return c.json(results, 200);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Workbook not found')) {
        return c.json({ error: err.message }, 404);
      }
      throw err;
    }
  });

  app.openapi(listWorkbooksRoute, (c) => {
    const workbooks = store.listWorkbooks();
    return c.json(workbooks, 200);
  });

  app.doc('/openapi', {
    openapi: '3.0.0',
    info: {
      title: 'Apiary REST Server',
      version: '0.1.0',
      description: 'REST API for the Apiary spreadsheet engine',
    },
  });

  return app;
}

