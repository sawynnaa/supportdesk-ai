import 'dotenv/config';
import { db } from '../../api/src/db.js';
import { startWorker } from './jobs.js';
if (!process.env.DATABASE_URL)
  throw new Error('独立 worker 需要 DATABASE_URL。本地 PGlite 模式由 API 内嵌调度 worker。');
await db.init();
const stop = startWorker(db);
console.log('SupportDesk worker ready');
process.on('SIGTERM', async () => {
  stop();
  await db.close();
  process.exit(0);
});
