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
});
