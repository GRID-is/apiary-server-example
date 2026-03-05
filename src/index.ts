import { serve } from '@hono/node-server';
import { config } from './config.ts';
import { DiskStore } from './store/DiskStore.ts';
import { WorkbookStore } from './store/WorkbookStore.ts';
import { createRoutes } from './routes.ts';

const disk = new DiskStore();
const store = new WorkbookStore(disk);
const app = createRoutes(store);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Apiary server listening on http://localhost:${info.port}`);
  console.log(`Workbook storage: ${config.workbookDir}`);
});
