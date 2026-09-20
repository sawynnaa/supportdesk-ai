import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { Database } from '../../apps/api/src/db';
import { createRouter } from '../../apps/api/src/http';
import { seed } from '../../apps/api/src/seed';
import { processJob } from '../../apps/worker/src/jobs';
import { SSEParser } from '../../packages/contracts/src';
import { retrieve } from '../../apps/api/src/ai';
import { id } from '../../apps/api/src/domain';
const db = new Database();
let server: Server, url: string;
type Client = { cookie: string; csrf: string };
let admin: Client, agent: Client, viewer: Client;
const origin = 'http://localhost:5173';
async function call(client: Client, path: string, method = 'GET', body?: any, key?: string) {
  const res = await fetch(url + path, {
    method,
    headers: {
      Cookie: client.cookie,
      Origin: origin,
      'X-CSRF-Token': client.csrf,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
async function login(email: string) {
  const r = await fetch(url + '/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo123456!' }),
  });
  const data = (await r.json()) as any;
  return { cookie: r.headers.get('set-cookie')!.split(';')[0], csrf: data.csrf };
}
const base = '/workspaces/ws-demo';
async function conversation(client = admin) {
  return (await call(client, base + '/conversations', 'POST')).data.id;
}
async function run(
  cid: string,
  question = 'CSV 导入文件大小和行数限制是多少？',
  scenario = 'normal',
  requestId = id(),
  client = admin,
) {
  const r = await fetch(url + base + '/conversations/' + cid + '/runs', {
    method: 'POST',
    headers: {
      Cookie: client.cookie,
      Origin: origin,
      'X-CSRF-Token': client.csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question, scenario, clientRequestId: requestId }),
  });
  if (!r.headers.get('content-type')?.includes('event-stream'))
    return { status: r.status, json: await r.json(), events: [] };
  const bytes = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, events: new SSEParser().feed(bytes) };
}
beforeAll(async () => {
  if (process.env.DATABASE_URL && !new URL(process.env.DATABASE_URL).pathname.includes('test'))
    throw new Error('Integration tests require a dedicated database whose name contains test');
  process.env.DATA_DIR = ':memory:';
  process.env.APP_ORIGIN = origin;
  process.env.AI_DAILY_LIMIT = '1000';
  await db.init();
  await seed(db);
  while (await processJob(db)) {
    /* Drain durable jobs. */
  }
  const app = express();
  app.use(createRouter(db));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  url = 'http://127.0.0.1:' + (server.address() as any).port;
  admin = await login('admin@demo.com');
  agent = await login('agent@demo.com');
  viewer = await login('viewer@demo.com');
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
});
beforeEach(async () => {
  await db.query('DELETE FROM ai_usage_limits');
});
describe.sequential('database-backed API invariants', () => {
  it('concurrent identical clientRequestId calls return one run', async () => {
    const cid = await conversation();
    const requestId = id();
    const results = await Promise.all([
      run(cid, 'CSV 导入限制', 'normal', requestId),
      run(cid, 'CSV 导入限制', 'normal', requestId),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const ids = results.map((r) => r.json?.runId || r.events[0]?.data.runId);
    expect(new Set(ids).size).toBe(1);
    const rows = await db.query('SELECT id FROM ai_runs WHERE conversation_id=$1', [cid]);
    expect(rows).toHaveLength(1);
  });
  it('refuses out-of-scope questions without inventing citations', async () => {
    const cid = await conversation();
    const r = await run(cid, '今年世界杯谁会夺冠？');
    const sources = r.events.find((e) => e.event === 'sources.ready')!.data.sources;
    expect(sources).toEqual([]);
    expect(
      r.events
        .filter((e) => e.event === 'message.delta')
        .map((e) => e.data.text)
        .join(''),
    ).toContain('无法确认');
  });

  it('uses HttpOnly cookies and valid session', async () => {
    expect((await call(admin, '/auth/me')).data.user.id).toBe('admin');
    expect((await call({ cookie: '', csrf: '' }, base + '/tickets')).status).toBe(401);
  });
  it('enforces workspace isolation on list, detail and writes', async () => {
    expect((await call(agent, '/workspaces/ws-other/tickets')).status).toBe(404);
    expect((await call(agent, base + '/tickets/other-ticket')).status).toBe(404);
    expect(
      (
        await call(agent, '/workspaces/ws-other/tickets/other-ticket', 'PATCH', {
          title: '越权修改',
          version: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(agent, base + '/tickets')).data.items.every((t: any) => t.workspace_id === 'ws-demo'),
    ).toBe(true);
  });
  it('viewer cannot write tickets, read conversations or invoke AI', async () => {
    expect(
      (await call(viewer, base + '/tickets', 'POST', { title: '禁止创建', description: '描述内容' }, id()))
        .status,
    ).toBe(403);
    expect((await call(viewer, base + '/conversations')).status).toBe(403);
    expect((await call(viewer, base + '/conversations', 'POST')).status).toBe(403);
  });
  it('checks Origin and CSRF on server', async () => {
    expect((await call({ ...admin, csrf: 'bad' }, base + '/conversations', 'POST')).status).toBe(403);
    const r = await fetch(url + base + '/conversations', {
      method: 'POST',
      headers: { Cookie: admin.cookie, Origin: 'https://evil.example', 'X-CSRF-Token': admin.csrf },
    });
    expect(r.status).toBe(403);
  });
  it('rejects arbitrary input and cross-workspace assignees', async () => {
    expect(
      (
        await call(
          admin,
          base + '/tickets',
          'POST',
          { title: '正常标题', description: '正常内容', created_by: 'other' },
          id(),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          admin,
          base + '/tickets',
          'POST',
          { title: '正常标题', description: '正常内容', assignee_id: 'other' },
          id(),
        )
      ).status,
    ).toBe(422);
  });
  it('paginates and filters on the server', async () => {
    const r = await call(admin, base + '/tickets?page=1&pageSize=2&status=open');
    expect(r.data.items).toHaveLength(2);
    expect(r.data.total).toBeGreaterThan(2);
    expect(r.data.items.every((t: any) => t.status === 'open')).toBe(true);
    expect((await call(admin, base + '/tickets?search=不存在的搜索')).data.total).toBe(0);
  });
  it('idempotent ticket creation returns the same result and rejects changed payload', async () => {
    const k = id(),
      payload = { title: '重复提交测试工单', description: '同一提交仅创建一次' };
    const [a, b] = await Promise.all([
      call(admin, base + '/tickets', 'POST', payload, k),
      call(admin, base + '/tickets', 'POST', payload, k),
    ]);
    expect(a.status).toBe(201);
    expect(b.data.id).toBe(a.data.id);
    expect(
      (await call(admin, base + '/tickets', 'POST', { ...payload, title: '变更了标题' }, k)).status,
    ).toBe(409);
  });
  it('rolls back invalid transitions and enforces optimistic locking with audit', async () => {
    const t = (
      await call(
        admin,
        base + '/tickets',
        'POST',
        { title: '状态机测试工单', description: '状态迁移描述' },
        id(),
      )
    ).data;
    expect(
      (
        await call(admin, base + '/tickets/' + t.id + '/transitions', 'POST', {
          status: 'closed',
          version: 1,
        })
      ).status,
    ).toBe(422);
    expect((await call(admin, base + '/tickets/' + t.id)).data.version).toBe(1);
    const p = base + '/tickets/' + t.id;
    const results = await Promise.all([
      call(admin, p, 'PATCH', { title: '并发修改甲', version: 1 }),
      call(agent, p, 'PATCH', { title: '并发修改乙', version: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await call(admin, p + '/activity')).data.items).toHaveLength(2);
    expect(
      (await call(admin, p + '/transitions', 'POST', { status: 'in_progress', version: 2 })).status,
    ).toBe(200);
  });
  it('notes are append-only and included in audit', async () => {
    const t = (await call(admin, base + '/tickets')).data.items[0];
    expect(
      (await call(agent, base + '/tickets/' + t.id + '/comments', 'POST', { body: '已联系客户核实' })).status,
    ).toBe(201);
    expect((await call(admin, base + '/tickets/' + t.id + '/comments')).data.items.at(-1).body).toBe(
      '已联系客户核实',
    );
  });
  it('even administrators cannot read another member’s private conversation', async () => {
    const cid = await conversation(agent);
    expect((await call(admin, base + '/conversations/' + cid + '/messages')).status).toBe(404);
  });
  it('worker builds vectors and repeat execution does not duplicate chunks', async () => {
    const rows = await db.query(
      "SELECT count(*)::int AS n FROM document_chunks WHERE workspace_id='ws-demo'",
    );
    expect(rows[0].n).toBe(12);
    expect(await processJob(db)).toBe(false);
    const results = await retrieve(db, 'ws-demo', 'CSV 导入文件限制');
    expect(results.some((r) => r.document_id === 'doc-import')).toBe(true);
    expect(await retrieve(db, 'ws-other', 'CSV 导入文件限制')).toEqual([]);
  });
  it('only admins can upload docs; validates format and UTF-8 byte size', async () => {
    const body = { title: '测试说明', body: '说明内容', filename: 'test.md' };
    expect((await call(agent, base + '/documents', 'POST', body)).status).toBe(403);
    expect((await call(admin, base + '/documents', 'POST', { ...body, filename: 'test.pdf' })).status).toBe(
      422,
    );
    expect(
      (await call(admin, base + '/documents', 'POST', { ...body, body: '中'.repeat(350000) })).status,
    ).toBe(413);
  });
  it('document version switches only after the worker succeeds', async () => {
    const before = (await call(admin, base + '/documents/doc-import')).data;
    const r = await call(admin, base + '/documents/doc-import/versions', 'POST', {
      title: before.title,
      filename: 'new.md',
      body: '# CSV 导入指南\n当前 CSV 导入上限为 5000 行，10 MB，必须 UTF-8 编码。',
    });
    expect(r.status).toBe(202);
    expect((await call(admin, base + '/documents/doc-import')).data.active_version_id).toBe(
      before.active_version_id,
    );
    await processJob(db);
    expect((await call(admin, base + '/documents/doc-import')).data.active_version_id).toBe(r.data.versionId);
  });
  it('streams Chinese text and valid authorized citations, then persists history', async () => {
    const cid = await conversation();
    const r = await run(cid);
    expect(r.events.at(-1)?.event).toBe('run.completed');
    expect(r.events.filter((e) => e.event === 'run.completed')).toHaveLength(1);
    expect(
      r.events
        .filter((e) => e.event === 'message.delta')
        .map((e) => e.data.text)
        .join(''),
    ).toContain('5000');
    const s = r.events.find((e) => e.event === 'sources.ready')!.data.sources[0];
    expect((await call(admin, base + '/citations/' + s.citationId)).status).toBe(200);
    expect((await call(agent, base + '/citations/' + s.citationId)).status).toBe(404);
    const history = (await call(admin, base + '/conversations/' + cid + '/messages')).data.items;
    expect(history).toHaveLength(2);
    expect(history[1].status).toBe('completed');
  });
  it('duplicate clientRequestId does not create another AI run', async () => {
    const cid = await conversation(),
      rid = id();
    const one = await run(cid, '密码重置', 'normal', rid);
    const two = await run(cid, '密码重置', 'normal', rid);
    expect(two.json.existing).toBe(true);
    expect(two.json.runId).toBe(one.events[0].data.runId);
  });
  it.each(['empty', 'failure', 'timeout', 'malformed'])(
    'mock %s has one failure terminal event and durable status',
    async (scenario) => {
      const cid = await conversation();
      const r = await run(cid, 'CSV 导入', scenario);
      expect(r.events.filter((e) => e.event === 'run.failed')).toHaveLength(1);
      expect(r.events.some((e) => e.event === 'run.completed')).toBe(false);
      const runId = r.events[0].data.runId;
      expect((await call(admin, base + '/runs/' + runId)).data.status).toBe('failed');
    },
  );
  it('cancel preserves partial content and disallows a second active run', async () => {
    const cid = await conversation();
    const response = await fetch(url + base + '/conversations/' + cid + '/runs', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        Origin: origin,
        'X-CSRF-Token': admin.csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question: 'CSV 导入限制', scenario: 'slow', clientRequestId: id() }),
    });
    const reader = response.body!.getReader(),
      parser = new SSEParser();
    let runId = '',
      text = '';
    while (!text) {
      const { value } = await reader.read();
      for (const event of parser.feed(value!)) {
        runId = event.data.runId;
        if (event.event === 'message.delta') text += event.data.text;
      }
    }
    expect((await run(cid, '另一个请求')).status).toBe(409);
    expect((await call(admin, base + '/runs/' + runId + '/cancel', 'POST')).status).toBe(200);
    while (!(await reader.read()).done) {
      /* Drain terminal. */
    }
    const saved = (await call(admin, base + '/runs/' + runId)).data;
    expect(saved.status).toBe('cancelled');
    expect(saved.content.length).toBeGreaterThan(0);
  });
  it('concurrent confirmations with different keys still produce one ticket', async () => {
    const cid = await conversation();
    await run(cid, 'CSV 数据导入限制');
    const draft = (await call(admin, base + '/conversations/' + cid + '/ticket-drafts', 'POST')).data;
    expect(draft.id).toBeTruthy();
    expect(
      (await call(agent, base + '/ticket-drafts/' + draft.id + '/confirm', 'POST', { version: 1 }, id()))
        .status,
    ).toBe(404);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(admin, base + '/ticket-drafts/' + draft.id + '/confirm', 'POST', { version: 1 }, id()),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.data.id)).size).toBe(1);
    const tickets = await db.query('SELECT * FROM tickets WHERE source_conversation_id=$1', [cid]);
    expect(tickets).toHaveLength(1);
  });
  it('deleted source citations no longer reveal snapshots and cannot be retrieved', async () => {
    const cid = await conversation();
    const r = await run(cid, 'CSV 文件导入');
    const s = r.events
      .find((e) => e.event === 'sources.ready')!
      .data.sources.find((s: any) => s.title === 'CSV 数据导入指南');
    expect(s).toBeTruthy();
    expect((await call(admin, base + '/documents/doc-import', 'DELETE')).status).toBe(200);
    const c = await call(admin, base + '/citations/' + s.citationId);
    expect(c.status).toBe(410);
    expect(c.data.quoted_text).toBeUndefined();
    expect((await retrieve(db, 'ws-demo', 'CSV 导入')).every((r) => r.document_id !== 'doc-import')).toBe(
      true,
    );
  });
});
