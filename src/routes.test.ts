import { describe, it, expect, beforeAll } from 'vitest';
import { Model } from '@grid-is/apiary';
import { createRoutes } from './routes.ts';
import { DiskStore } from './store/DiskStore.ts';
import { WorkbookStore } from './store/WorkbookStore.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testJSF = {
  name: 'test.xlsx',
  sheets: [
    {
      name: 'Sheet1',
      cells: {
        A1: { v: 1 },
        B1: { v: 50, f: 0 },
      },
      columns: [],
      rows: [],
      merges: [],
      defaults: { colWidth: 65, rowHeight: 16 },
      hidden: 0,
      views: [{ workbookView: 0, activeCell: 'B2' }],
    },
  ],
  names: [],
  calculationProperties: {
    iterate: false,
    iterateCount: 100,
    iterateDelta: 0.001,
    epoch: 1900,
  },
  styles: [{ fontFamily: 'Aptos Narrow', fontSize: 12 }],
  tables: [],
  views: [{}],
  formulas: ['RC[-1]*50'],
};

describe('query', () => {
  let app: ReturnType<typeof createRoutes>;
  let workbookId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiary-test-'));
    const disk = new DiskStore(tmpDir);
    const store = new WorkbookStore(disk);

    const model = Model.fromJSF(testJSF);
    workbookId = 'a0000000-0000-4000-8000-000000000001';
    store.storeNew(workbookId, 'test.xlsx', model, Buffer.from('fake-xlsx'));

    app = createRoutes(store);
  });

  it('reads cell values from the model', async () => {
    // Act
    const res = await app.request(`/query/${workbookId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: ['A1', 'B1'] }),
    });

    // Assert
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.A1).toMatchObject({ t: 'n', v: 1 });
    expect(body.B1).toMatchObject({ t: 'n', v: 50 });
  });

  it('applies values and reads computed results', async () => {
    // Arrange
    const expectedB1Value = 100;

    // Act
    const res = await app.request(`/query/${workbookId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apply: { A1: 2 },
        read: ['B1'],
      }),
    });

    // Assert
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.B1).toMatchObject({ t: 'n', v: expectedB1Value });
  });

  it('apply does not mutate the shared model', async () => {
    // Read A1 — expect original value
    const res1 = await app.request(`/query/${workbookId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: ['A1'] }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.A1).toMatchObject({ t: 'n', v: 1 });

    // Apply A1=2, read B1 — expect recalculated value
    const res2 = await app.request(`/query/${workbookId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: { A1: 2 }, read: ['B1'] }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.B1).toMatchObject({ t: 'n', v: 100 });

    // Read A1 again without apply — must still be 1
    const res3 = await app.request(`/query/${workbookId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: ['A1'] }),
    });
    expect(res3.status).toBe(200);
    const body3 = await res3.json();
    expect(body3.A1).toMatchObject({ t: 'n', v: 1 });
  });

  it('returns 404 for unknown workbook', async () => {
    const unknownId = 'b0000000-0000-4000-8000-000000000099';
    const res = await app.request(`/query/${unknownId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: ['A1'] }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 400 for an invalid expression in read', async () => {
    const res = await app.request(`/query/${workbookId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: ['=UNKNOWNFUNC('] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

describe('listWorkbooks', () => {
  let app: ReturnType<typeof createRoutes>;
  let workbookId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiary-test-'));
    const disk = new DiskStore(tmpDir);
    const store = new WorkbookStore(disk);

    const model = Model.fromJSF(testJSF);
    workbookId = 'a0000000-0000-4000-8000-000000000002';
    store.storeNew(workbookId, 'test.xlsx', model, Buffer.from('fake-xlsx'));

    app = createRoutes(store);
  });

  it('returns the stored workbook in the list', async () => {
    const res = await app.request('/workbooks', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const entry = body.find((w: { id: string }) => w.id === workbookId);
    expect(entry).toBeDefined();
    expect(entry.filename).toBe('test.xlsx');
    expect(entry.status).toBe('hot');
  });
});

describe('upload error handling', () => {
  let app: ReturnType<typeof createRoutes>;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apiary-test-'));
    const disk = new DiskStore(tmpDir);
    const store = new WorkbookStore(disk);
    app = createRoutes(store);
  });

  it('returns 400 when uploading invalid content', async () => {
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([0, 1, 2, 3])], 'bad.xlsx'));

    const res = await app.request('/workbook', {
      method: 'POST',
      body: formData,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
