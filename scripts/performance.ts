import { Database } from '../apps/api/src/db.js';
import { seed } from '../apps/api/src/seed.js';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
delete process.env.DATABASE_URL; // Always isolate measurements from application data.
process.env.DATA_DIR = ':memory:';
const db = new Database();
await db.init();
await seed(db);
await db.query(
  `INSERT INTO tickets(id,workspace_id,title,description,priority,status,created_by,updated_at) SELECT 'perf-'||n,'ws-demo','性能样例工单 '||n,'仅测试数据','medium',CASE WHEN n%3=0 THEN 'in_progress' ELSE 'open' END,'admin',now()-(n||' seconds')::interval FROM generate_series(1,10000) AS n`,
);
const sql =
  'SELECT t.*,u.display_name FROM tickets t LEFT JOIN users u ON t.assignee_id=u.id WHERE t.workspace_id=$1 AND t.status=$2 ORDER BY t.updated_at DESC,t.id LIMIT 8 OFFSET 0';
const args = ['ws-demo', 'open'];
const samples = [];
const cold = performance.now();
await db.query(sql, args);
const coldMs = performance.now() - cold;
for (let i = 0; i < 20; i++) await db.query(sql, args);
for (let i = 0; i < 200; i++) {
  const start = performance.now();
  await db.query(sql, args);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const result = {
  date: new Date().toISOString(),
  engine: process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite WASM PostgreSQL',
  hardware: os.cpus()[0].model,
  platform: `${os.platform()} ${os.arch()}`,
  node: process.version,
  memoryGB: Math.round(os.totalmem() / 1024 ** 3),
  rows: 10012,
  concurrency: 1,
  warmup: 20,
  samples: 200,
  coldMs,
  p50: samples[99],
  p95: samples[189],
  p99: samples[197],
  scope: 'DB 查询耗时，不含 HTTP、网络、鉴权，不能宣称普通 API p95 达标',
};
await writeFile('evals/reports/performance.json', JSON.stringify(result, null, 2));
console.log(result);
await db.close();
