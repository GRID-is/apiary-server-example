import { Model, serializeModel, deserializeModel } from '@grid-is/apiary';
import { DiskStore } from './DiskStore.ts';
import { config } from '../config.ts';

const EVICTION_RETRY_DELAY_MS = 1000;

export type WorkbookStatus = 'hot' | 'cold' | 'error';

export type WorkbookInfo = {
  id: string;
  filename: string;
  modified: string;
  status: WorkbookStatus;
};

type CacheEntry = {
  model: Model;
  id: string;
  filename: string;
  modified: string;
  lastUsedAt: number;
};

export class WorkbookStore {
  private cache = new Map<string, CacheEntry>();
  private disk: DiskStore;
  private maxHeapBytes: number;
  private evictionScheduled = false;

  constructor(disk: DiskStore, maxHeapBytes?: number) {
    this.disk = disk;
    this.maxHeapBytes = maxHeapBytes ?? config.maxHeapBytes;
  }

  storeNew(
    id: string,
    filename: string,
    model: Model,
    xlsxBuffer: Buffer,
  ): { id: string; modified: string } {
    const modified = new Date().toISOString();
    const modelBuffer = serializeModel(model);

    this.cache.set(id, {
      model,
      id,
      filename,
      modified,
      lastUsedAt: Date.now(),
    });

    this.disk.save(id, xlsxBuffer, modelBuffer, filename, modified);
    this.scheduleEvictionCheck();

    return { id, modified };
  }

  storeNewVersion(
    id: string,
    model: Model,
    xlsxBuffer: Buffer,
    filename?: string,
  ): { id: string; modified: string } {
    const existing = this.cache.get(id) ?? this.loadEntryFromDisk(id);
    if (!existing) throw new Error(`Workbook not found: ${id}`);

    const modified = new Date().toISOString();
    filename = filename ?? existing.filename;
    const modelBuffer = serializeModel(model);

    this.cache.set(id, {
      model,
      id,
      filename,
      modified,
      lastUsedAt: Date.now(),
    });

    this.disk.save(id, xlsxBuffer, modelBuffer, filename, modified);
    this.scheduleEvictionCheck();

    return { id, modified };
  }

  get(id: string): Model {
    const entry = this.cache.get(id);
    if (entry) {
      entry.lastUsedAt = Date.now();
      return entry.model;
    }

    // Try loading from disk
    const loaded = this.loadEntryFromDisk(id);
    if (!loaded) throw new Error(`Workbook not found: ${id}`);

    this.cache.set(id, loaded);
    this.scheduleEvictionCheck();
    return loaded.model;
  }

  getModelForRead<T>(id: string, fn: (model: Model) => T): T {
    const model = this.get(id);
    this.resetModelState(model);
    try {
      return fn(model);
    } finally {
      this.resetModelState(model);
    }
  }

  private resetModelState(model: Model): void {
    for (const wb of model.getWorkbooks()) {
      wb.reset();
      wb.clearCachedFormulasExcept([]);
    }
  }

  listWorkbooks(): WorkbookInfo[] {
    const diskEntries = this.disk.listWorkbooks();
    const result: WorkbookInfo[] = [];

    for (const meta of diskEntries) {
      const cached = this.cache.get(meta.id);
      result.push({
        id: meta.id,
        filename: cached?.filename ?? meta.filename,
        modified: cached?.modified ?? meta.modified,
        status: cached ? 'hot' : 'cold',
      });
    }

    return result;
  }

  private loadEntryFromDisk(id: string): CacheEntry | null {
    if (!this.disk.exists(id)) return null;

    try {
      const modelBuffer = this.disk.loadModelBinary(id);
      const model = deserializeModel(modelBuffer);
      const meta = this.disk.loadMeta(id);
      return {
        model,
        id,
        filename: meta.filename,
        modified: meta.modified,
        lastUsedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  private scheduleEvictionCheck(): void {
    if (this.evictionScheduled) return;
    this.evictionScheduled = true;
    process.nextTick(() => {
      this.evictionScheduled = false;
      this.evictIfNeeded();
    });
  }

  private evictIfNeeded(): void {
    const heapUsed = process.memoryUsage().heapUsed;
    if (heapUsed <= this.maxHeapBytes) return;
    if (this.cache.size === 0) return;

    this.evictLeastRecentlyUsed();

    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
    }

    // Re-check after a delay
    setTimeout(() => this.evictIfNeeded(), EVICTION_RETRY_DELAY_MS);
  }

  private evictLeastRecentlyUsed(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldest = key;
      }
    }

    if (oldest) {
      this.cache.delete(oldest);
    }
  }
}
