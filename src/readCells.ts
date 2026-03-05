import { Model, FormulaError, Matrix, Reference, unbox, Cell as ApiaryCell, colFromOffs } from '@grid-is/apiary';
import { format } from 'numfmt';

/**
 * Cell information, aligned with grid-apiary-llm-fusion CellInfo.
 */
export type CellInfo = {
  v?: string | number | boolean;
  f?: string;
  t?: 'z' | 'b' | 'n' | 's' | 'e';
  ref?: string;
  num_format?: string;
  style_index?: number;
  formatted?: string;
};

export type MultiCellResult = Record<string, CellInfo>;

type CellValueType = 'z' | 'b' | 'n' | 's' | 'e';

const MAX_CELLS = 65536;

function getCellType(value: unknown): CellValueType | undefined {
  if (value == null) return 'z';
  if (typeof value === 'boolean') return 'b';
  if (typeof value === 'number') return 'n';
  if (typeof value === 'string') return 's';
  if (value instanceof FormulaError) return 'e';
  return undefined;
}

function toA1Ref(col: number, row: number): string {
  return colFromOffs(col) + (row + 1);
}

function toCellInfo(cell: ApiaryCell | null, ref: string): CellInfo {
  if (!cell) {
    return { t: 'z', ref };
  }

  const cellInfo: CellInfo = { ref };
  const value = cell.v;

  const t = getCellType(value);
  if (t) cellInfo.t = t;

  if (value != null) {
    if (value instanceof FormulaError) {
      cellInfo.v = String(value);
    } else if (typeof value !== 'object') {
      cellInfo.v = value as string | number | boolean;
    }
  }

  if (cell.f) {
    cellInfo.f = cell.f;
  }

  const numberFormat = cell.style?.numberFormat;
  if (numberFormat) {
    cellInfo.num_format = numberFormat;
    try {
      cellInfo.formatted = format(numberFormat, value);
    } catch {
      cellInfo.formatted = '######';
    }
  }

  const style_index = cell.s;
  if (style_index !== undefined) {
    cellInfo.style_index = style_index;
  }

  return cellInfo;
}

/**
 * Evaluate an expression and return the result as CellInfo objects.
 *
 * Single cells return a CellInfo with `ref` set.
 * Ranges return a Record<ref, CellInfo> (ref omitted from values since it's the key).
 */
export function readCells(
  model: Model,
  expression: string,
): CellInfo | MultiCellResult {
  const formula = expression.replace(/^=?/, '=');

  let result = model.runFormula(formula, null);

  if (result instanceof Reference) {
    result = result.withContext(model);
    if (result.name) {
      result = unbox(result.resolveToNonName());
    }
  }

  let isFormulaResult = false;
  if (
    typeof result === 'number' ||
    typeof result === 'string' ||
    typeof result === 'boolean' ||
    result instanceof FormulaError
  ) {
    result = Matrix.of(result);
    isFormulaResult = true;
  }

  if (result instanceof Matrix || result instanceof Reference) {
    const size = result.size ?? 0;

    if (size > MAX_CELLS) {
      throw new Error(`Query exceeds ${MAX_CELLS} cell limit`);
    }

    const area = result.resolveAreaCells('any-cell-information');
    const width = result.width ?? 0;
    const height = result.height ?? 0;

    const startCol = result instanceof Reference ? (result.left ?? 0) : 0;
    const startRow = result instanceof Reference ? (result.top ?? 0) : 0;

    if (size === 1) {
      const cell = area?.[0]?.[0] ?? null;
      const ref = isFormulaResult ? '#RESULT' : toA1Ref(startCol, startRow);
      return toCellInfo(cell, ref);
    }

    const cells: MultiCellResult = {};
    for (let row = 0; row < height; row++) {
      const areaRow = area[row];
      for (let col = 0; col < width; col++) {
        const cell = areaRow?.[col] ?? null;
        const ref = toA1Ref(startCol + col, startRow + row);
        const { ref: _, ...cellInfo } = toCellInfo(cell, ref);
        cells[ref] = cellInfo;
      }
    }
    return cells;
  }

  throw new Error(`Cannot read expression: ${expression}`);
}
