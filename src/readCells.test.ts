import { describe, it, expect, beforeAll } from 'vitest';
import { Model } from '@grid-is/apiary';
import { readCells, type CellInfo, type MultiCellResult } from './readCells.ts';

const testJSF = {
  name: 'test.xlsx',
  sheets: [
    {
      name: 'Sheet1',
      cells: {
        A1: { v: 1 },
        A3: { v: 3 },
        B1: { v: 50, f: 0 },
        C1: { v: 0, f: 1 },
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
  formulas: ['RC[-1]*50', '1/0'],
};

describe('readCells', () => {
  let model: Model;

  beforeAll(() => {
    model = Model.fromJSF(testJSF);
  });

  it('returns CellInfo with ref for a single cell', () => {
    const result = readCells(model, 'A1') as CellInfo;
    expect(result).toMatchObject({ t: 'n', v: 1, ref: 'A1' });
  });

  it('returns Record<string, CellInfo> for a range', () => {
    const result = readCells(model, 'A1:B1') as MultiCellResult;
    expect(result).toHaveProperty('A1');
    expect(result).toHaveProperty('B1');
    expect(result.A1).toMatchObject({ t: 'n', v: 1 });
    expect(result.B1).toMatchObject({ t: 'n', v: 50 });
  });

  it('emits t:z for empty cells in a range', () => {
    // A1:A3 where A2 is empty
    const result = readCells(model, 'A1:A3') as MultiCellResult;
    expect(result).toHaveProperty('A1');
    expect(result).toHaveProperty('A2');
    expect(result).toHaveProperty('A3');
    expect(result.A2).toMatchObject({ t: 'z' });
  });

  it('evaluates a formula expression', () => {
    const result = readCells(model, '=1+1') as CellInfo;
    expect(result).toMatchObject({ t: 'n', v: 2, ref: '#RESULT' });
  });

  it('returns error type for division by zero', () => {
    const result = readCells(model, '=1/0') as CellInfo;
    expect(result).toMatchObject({ t: 'e', ref: '#RESULT' });
    expect(result.v).toBeDefined();
  });
});
