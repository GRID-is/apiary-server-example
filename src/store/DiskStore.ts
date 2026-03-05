import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from '../config.ts';

export type WorkbookDiskMeta = {
  id: string;
  filename: string;
  modified: string;
};

export class DiskStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? config.workbookDir;
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private workbookDir(id: string): string {
    return path.join(this.baseDir, id);
  }

  save(
    id: string,
    xlsxBuffer: Buffer,
    modelBuffer: Buffer,
    filename: string,
  ): void {
    const dir = this.workbookDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const meta: WorkbookDiskMeta = { id, filename, modified: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(dir, 'original.xlsx'), xlsxBuffer);
    fs.writeFileSync(path.join(dir, 'model.bin'), zlib.gzipSync(modelBuffer));
  }

  loadModelBinary(id: string): Buffer {
    const compressed = fs.readFileSync(path.join(this.workbookDir(id), 'model.bin'));
    return zlib.gunzipSync(compressed);
  }

  loadMeta(id: string): WorkbookDiskMeta {
    const raw = fs.readFileSync(path.join(this.workbookDir(id), 'meta.json'), 'utf-8');
    return JSON.parse(raw) as WorkbookDiskMeta;
  }

  listWorkbooks(): WorkbookDiskMeta[] {
    if (!fs.existsSync(this.baseDir)) return [];

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    const results: WorkbookDiskMeta[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(this.baseDir, entry.name, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const raw = fs.readFileSync(metaPath, 'utf-8');
        results.push(JSON.parse(raw) as WorkbookDiskMeta);
      } catch {
        // skip corrupted entries
      }
    }

    return results;
  }

  exists(id: string): boolean {
    return fs.existsSync(path.join(this.workbookDir(id), 'meta.json'));
  }
}
