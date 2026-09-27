import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { config } from './config.ts';
import { Store } from './store.ts';
import { createApp } from './web/app.ts';
import { startScheduler } from './scheduler.ts';

const store = new Store(join(config.dataDir, 'lapse.db'));
const app = createApp(store);

if (config.scheduler) startScheduler(store);
else console.log('[lapse] scheduler is off: no scans, no alerts');

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`[lapse] running at ${config.baseUrl}`);
  if (!config.user) console.log('[lapse] no LAPSE_USER/LAPSE_PASSWORD set: the UI is unauthenticated');
});
