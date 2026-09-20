import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { z, ZodError } from 'zod';
import type { Database, Sql } from './db.js';
import {
  AppError,
  requireThat,
  id,
  hash,
  member,
  ownConversation,
  createTicket,
  audit,
  validateAssignee,
  checkTransition,
  idempotent,
} from './domain.js';
import {
  ticketInput,
  ticketPatch,
  statusSchema,
  documentInput,
  runInput,
} from '../../../packages/contracts/src/index.js';
import { retrieve, answer, generateDraft, modelName, realMode } from './ai.js';

type Context = { uid: string; wid: string; requestId: string };
type Req = Request & { ctx: Context; session?: any };
const active = new Map<string, AbortController>();
const loginAttempts = new Map<string, { count: number; until: number }>();
const wrap =
  (fn: (req: Req, res: Response) => Promise<any>) => (req: Request, res: Response, next: NextFunction) => {
    void fn(req as Req, res).catch(next);
  };
const key = (r: Request) => r.get('Idempotency-Key') || '';
export function createRouter(db: Database) {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));
  r.use(cookieParser());
  r.use((req, res, next) => {
    (req as Req).ctx = { uid: '', wid: '', requestId: id() };
    res.setHeader('X-Request-Id', (req as Req).ctx.requestId);
    const started = Date.now();
    res.on('finish', () => {
      if (process.env.REQUEST_LOGS === 'true')
        console.log(
          JSON.stringify({
            requestId: (req as Req).ctx.requestId,
            workspaceId: (req as Req).ctx.wid,
            method: req.method,
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  r.get(
    '/health',
    wrap(async (_req, res) => {
      await db.query('SELECT 1');
      res.json({ status: 'ok', mode: realMode() ? 'real' : 'mock', model: modelName() });
    }),
  );
  r.use((req: Request, _res: Response, next: NextFunction) => {
    void (async () => {
      const rr = req as Req;
      const token = req.cookies.sd_session;
      if (token) {
        const [s] = await db.query(
          'SELECT s.*,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
          [hash(token)],
        );
        if (s) {
          rr.ctx.uid = s.user_id;
          rr.session = s;
        }
      }
      next();
    })().catch(next);
  });
  r.use((req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.get('Origin');
        const allowed = process.env.APP_ORIGIN
          ? [process.env.APP_ORIGIN]
          : [
              'http://localhost:5173',
              'http://127.0.0.1:5173',
              'http://localhost:3001',
              'http://127.0.0.1:3001',
            ];
        requireThat(origin && allowed.includes(origin), 403, 'INVALID_ORIGIN', '请求来源不受信任');
        if (req.path !== '/auth/login') {
          requireThat((req as Req).session, 401, 'UNAUTHENTICATED', '请登录后继续');
          requireThat(
            req.get('X-CSRF-Token') === (req as Req).session.csrf,
            403,
            'CSRF',
            '请求校验失败，请刷新或重新登录',
          );
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  r.post(
    '/auth/login',
    wrap(async (req, res) => {
      const input = z
        .object({ email: z.string().email(), password: z.string().min(1).max(128) })
        .parse(req.body);
      const ip = req.ip || 'local';
      const now = Date.now();
      if (loginAttempts.size > 1000)
        for (const [k, v] of loginAttempts) if (v.until < now) loginAttempts.delete(k);
      let rate = loginAttempts.get(ip);
      if (!rate || rate.until < now) {
        rate = { count: 0, until: now + 60000 };
        loginAttempts.set(ip, rate);
      }
      requireThat(rate.count++ < 15, 429, 'RATE_LIMIT', '登录尝试过多，请一分钟后重试');
      const u = db.prisma
        ? await db.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } })
        : (await db.query('SELECT * FROM users WHERE email=$1', [input.email.toLowerCase()]))[0];
      const valid = await bcrypt.compare(
        input.password,
        u?.password_hash || '$2b$10$7EqJtq98hPqEX7fNZaFWoOBG6AQBZ2WyG5F/./QzDnx.QOqiOzVKW',
      );
      requireThat(u && valid, 401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
      const token = id() + id(),
        csrf = id();
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [hash(token), u.id, csrf],
      );
      res.cookie('sd_session', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 86400000,
        path: '/',
      });
      res.json({ user: { id: u.id, email: u.email, display_name: u.display_name }, csrf });
    }),
  );
  r.use((req, res, next) => {
    if (!(req as Req).ctx.uid)
      return res
        .status(401)
        .json({ code: 'UNAUTHENTICATED', message: '请登录后继续', requestId: (req as Req).ctx.requestId });
    next();
  });
  r.get(
    '/auth/me',
    wrap(async (req, res) =>
      res.json({
        user: { id: req.ctx.uid, email: req.session.email, display_name: req.session.display_name },
        csrf: req.session.csrf,
        mode: realMode() ? 'real' : 'mock',
        model: modelName(),
      }),
    ),
  );
  r.post(
    '/auth/logout',
    wrap(async (req, res) => {
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [req.session.token_hash]);
      res.clearCookie('sd_session', { path: '/' });
      res.json({ ok: true });
    }),
  );
  r.get(
    '/workspaces',
    wrap(async (req, res) =>
      res.json({
        items: await db.query(
          'SELECT w.*,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.id',
          [req.ctx.uid],
        ),
      }),
    ),
  );
  r.use('/workspaces/:wid', (req, res, next) => {
    const rr = req as unknown as Req;
    rr.ctx.wid = String(req.params.wid);
    void member(db, rr.ctx.wid, rr.ctx.uid, !['GET', 'HEAD'].includes(req.method))
      .then(() => next())
      .catch(next);
  });
  r.use('/workspaces/:wid/:resource', (req, res, next) => {
    if (['conversations', 'runs', 'ticket-drafts', 'citations'].includes(String(req.params.resource))) {
      const rr = req as unknown as Req;
      void member(db, rr.ctx.wid, rr.ctx.uid, true)
        .then(() => next())
        .catch(next);
    } else next();
  });
  const base = '/workspaces/:wid';
  r.get(
    base + '/members',
    wrap(async (req, res) =>
      res.json({
        items: await db.query(
          'SELECT u.id,u.display_name,u.email,m.role FROM users u JOIN memberships m ON u.id=m.user_id WHERE m.workspace_id=$1',
          [req.ctx.wid],
        ),
      }),
    ),
  );
  r.get(
    base + '/stats',
    wrap(async (req, res) => {
      const items = await db.query(
        'SELECT status,count(*)::int AS count FROM tickets WHERE workspace_id=$1 GROUP BY status',
        [req.ctx.wid],
      );
      res.json({ items });
    }),
  );
  r.get(
    base + '/tickets',
    wrap(async (req, res) => {
      const q = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(8),
          search: z.string().max(160).default(''),
          status: statusSchema.optional(),
          priority: z.enum(['low', 'medium', 'high']).optional(),
          assignee: z.string().optional(),
        })
        .parse(req.query);
      const args: any[] = [req.ctx.wid];
      let where = 't.workspace_id=$1';
      for (const [field, value] of [
        ['status', q.status],
        ['priority', q.priority],
        ['assignee_id', q.assignee],
      ]) {
        if (value) {
          if (value === 'unassigned') where += ' AND t.assignee_id IS NULL';
          else {
            args.push(value);
            where += ` AND t.${field}=$${args.length}`;
          }
        }
      }
      if (q.search) {
        args.push(`%${q.search.replace(/[\\%_]/g, '\\$&')}%`);
        where += ` AND t.title ILIKE $${args.length}`;
      }
      const [{ total }] = await db.query(`SELECT count(*)::int AS total FROM tickets t WHERE ${where}`, args);
      const items = await db.query(
        `SELECT t.*,u.display_name AS assignee_name,c.display_name AS creator_name FROM tickets t LEFT JOIN users u ON u.id=t.assignee_id JOIN users c ON c.id=t.created_by WHERE ${where} ORDER BY t.updated_at DESC,t.id LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, q.pageSize, (q.page - 1) * q.pageSize],
      );
      res.json({ items, total, page: q.page, pageSize: q.pageSize });
    }),
  );
  r.post(
    base + '/tickets',
    wrap(async (req, res) => {
      const input = ticketInput.parse(req.body);
      res
        .status(201)
        .json(
          await db.transaction((tx) =>
            idempotent(tx, req.ctx.wid, req.ctx.uid, 'ticket.create', key(req), input, () =>
              createTicket(tx, req.ctx.wid, req.ctx.uid, input, req.ctx.requestId),
            ),
          ),
        );
    }),
  );
  async function ticket(req: Req, tx = db) {
    const [t] = await tx.query(
      'SELECT t.*,u.display_name AS assignee_name,c.display_name AS creator_name FROM tickets t LEFT JOIN users u ON u.id=t.assignee_id JOIN users c ON c.id=t.created_by WHERE t.workspace_id=$1 AND t.id=$2',
      [req.ctx.wid, req.params.id],
    );
    requireThat(t, 404, 'NOT_FOUND', '工单不存在或无权访问');
    return t;
  }
  r.get(
    base + '/tickets/:id',
    wrap(async (req, res) => res.json(await ticket(req))),
  );
  r.patch(
    base + '/tickets/:id',
    wrap(async (req, res) => {
      const input = ticketPatch.parse(req.body);
      res.json(
        await db.transaction(async (tx) => {
          const [t] = await tx.query('SELECT * FROM tickets WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
            req.ctx.wid,
            req.params.id,
          ]);
          requireThat(t, 404, 'NOT_FOUND', '工单不存在');
          requireThat(
            t.version === input.version,
            409,
            'VERSION_CONFLICT',
            '工单已被其他人修改，请刷新后重试',
          );
          await validateAssignee(tx, req.ctx.wid, input.assignee_id);
          const merged = { ...t, ...input };
          const updated = tx.prisma
            ? await tx.prisma.ticket.update({
                where: { workspace_id_id: { workspace_id: req.ctx.wid, id: t.id } },
                data: {
                  title: merged.title,
                  description: merged.description,
                  priority: merged.priority,
                  assignee_id: merged.assignee_id,
                  version: { increment: 1 },
                  updated_at: new Date(),
                },
              })
            : (
                await tx.query(
                  'UPDATE tickets SET title=$3,description=$4,priority=$5,assignee_id=$6,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *',
                  [req.ctx.wid, t.id, merged.title, merged.description, merged.priority, merged.assignee_id],
                )
              )[0];
          await audit(tx, req.ctx.wid, req.ctx.uid, t.id, 'updated', t, updated, req.ctx.requestId);
          return updated;
        }),
      );
    }),
  );
  r.post(
    base + '/tickets/:id/transitions',
    wrap(async (req, res) => {
      const input = z.object({ status: statusSchema, version: z.number().int().positive() }).parse(req.body);
      res.json(
        await db.transaction(async (tx) => {
          const [t] = await tx.query('SELECT * FROM tickets WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [
            req.ctx.wid,
            req.params.id,
          ]);
          requireThat(t, 404, 'NOT_FOUND', '工单不存在');
          requireThat(t.version === input.version, 409, 'VERSION_CONFLICT', '工单已更新，请刷新');
          checkTransition(t.status, input.status);
          const [u] = await tx.query(
            'UPDATE tickets SET status=$3,version=version+1,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING *',
            [req.ctx.wid, t.id, input.status],
          );
          await audit(tx, req.ctx.wid, req.ctx.uid, t.id, 'status_changed', t, u, req.ctx.requestId);
          return u;
        }),
      );
    }),
  );
  r.get(
    base + '/tickets/:id/comments',
    wrap(async (req, res) => {
      await ticket(req);
      res.json({
        items: await db.query(
          'SELECT c.*,u.display_name AS author_name FROM ticket_comments c JOIN users u ON u.id=c.author_id WHERE c.workspace_id=$1 AND c.ticket_id=$2 ORDER BY c.created_at',
          [req.ctx.wid, req.params.id],
        ),
      });
    }),
  );
  r.post(
    base + '/tickets/:id/comments',
    wrap(async (req, res) => {
      await ticket(req);
      const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
      const [c] = await db.transaction(async (tx) => {
        const rows = await tx.query(
          'INSERT INTO ticket_comments(id,workspace_id,ticket_id,author_id,body) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [id(), req.ctx.wid, req.params.id, req.ctx.uid, body],
        );
        await audit(
          tx,
          req.ctx.wid,
          req.ctx.uid,
          String(req.params.id),
          'comment_added',
          null,
          { commentId: rows[0].id },
          req.ctx.requestId,
        );
        return rows;
      });
      res.status(201).json(c);
    }),
  );
  r.get(
    base + '/tickets/:id/activity',
    wrap(async (req, res) => {
      await ticket(req);
      res.json({
        items: await db.query(
          'SELECT a.*,u.display_name AS actor_name FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=$1 AND a.entity_id=$2 ORDER BY a.created_at DESC',
          [req.ctx.wid, req.params.id],
        ),
      });
    }),
  );
  r.get(
    base + '/conversations',
    wrap(async (req, res) => {
      await member(db, req.ctx.wid, req.ctx.uid, true);
      res.json({
        items: await db.query(
          'SELECT * FROM conversations WHERE workspace_id=$1 AND owner_id=$2 ORDER BY updated_at DESC',
          [req.ctx.wid, req.ctx.uid],
        ),
      });
    }),
  );
  r.post(
    base + '/conversations',
    wrap(async (req, res) => {
      const [c] = await db.query(
        'INSERT INTO conversations(id,workspace_id,owner_id,title) VALUES($1,$2,$3,$4) RETURNING *',
        [id(), req.ctx.wid, req.ctx.uid, '新会话'],
      );
      res.status(201).json(c);
    }),
  );
  r.get(
    base + '/conversations/:id/messages',
    wrap(async (req, res) => {
      await ownConversation(db, req.ctx.wid, String(req.params.id), req.ctx.uid);
      const items = await db.query(
        'SELECT m.*,r.regenerated_from,r.model,r.error_code FROM messages m JOIN ai_runs r ON r.id=m.run_id WHERE m.workspace_id=$1 AND m.conversation_id=$2 ORDER BY m.created_at,m.role DESC',
        [req.ctx.wid, req.params.id],
      );
      for (const m of items)
        m.sources = await db.query(
          'SELECT c.id AS "citationId",c.label,d.title,d.deleted_at IS NOT NULL AS deleted FROM message_citations c JOIN document_versions v ON v.id=c.version_id JOIN documents d ON d.id=v.document_id WHERE c.workspace_id=$1 AND c.message_id=$2 ORDER BY c.label::int',
          [req.ctx.wid, m.id],
        );
      res.json({ items });
    }),
  );
  r.get(
    base + '/runs/:id',
    wrap(async (req, res) => {
      const [run] = await db.query('SELECT * FROM ai_runs WHERE workspace_id=$1 AND id=$2 AND owner_id=$3', [
        req.ctx.wid,
        req.params.id,
        req.ctx.uid,
      ]);
      requireThat(run, 404, 'NOT_FOUND', '运行不存在');
      res.json(run);
    }),
  );
  r.post(
    base + '/runs/:id/cancel',
    wrap(async (req, res) => {
      const [run] = await db.query('SELECT * FROM ai_runs WHERE workspace_id=$1 AND id=$2 AND owner_id=$3', [
        req.ctx.wid,
        req.params.id,
        req.ctx.uid,
      ]);
      requireThat(run, 404, 'NOT_FOUND', '运行不存在');
      const local = active.get(run.id);
      if (local) local.abort(new AppError(499, 'CANCELLED', '已取消'));
      else await finalize(db, run.id, 'cancelled', run.content, 'CANCELLED');
      res.json({ ok: true });
    }),
  );
  r.post(
    base + '/conversations/:id/runs',
    wrap(async (req, res) => streamRun(db, req, res)),
  );
  r.get(
    base + '/documents',
    wrap(async (req, res) =>
      res.json({
        items: await db.query(
          `SELECT d.*,v.status,v.version_no,v.error,length(v.body) AS size,(SELECT count(*)::int FROM document_chunks c WHERE c.version_id=d.active_version_id) AS chunks FROM documents d LEFT JOIN document_versions v ON v.id=(SELECT id FROM document_versions WHERE document_id=d.id AND workspace_id=d.workspace_id ORDER BY version_no DESC LIMIT 1) WHERE d.workspace_id=$1 AND d.deleted_at IS NULL ORDER BY d.updated_at DESC`,
          [req.ctx.wid],
        ),
      }),
    ),
  );
  async function upload(req: Req, existing = false) {
    await member(db, req.ctx.wid, req.ctx.uid, true, true);
    const input = documentInput.parse(req.body);
    requireThat(
      Buffer.byteLength(input.body, 'utf8') <= 1048576,
      413,
      'DOCUMENT_TOO_LARGE',
      '文档不能超过 1 MB',
    );
    requireThat(
      !input.body.includes('\u0000') && !input.body.includes('\uFFFD'),
      422,
      'INVALID_ENCODING',
      '文档必须为有效 UTF-8 文本',
    );
    return db.transaction(async (tx) => {
      const did = existing ? String(req.params.id) : id();
      let version = 1;
      if (existing) {
        const [d] = await tx.query(
          'SELECT * FROM documents WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE',
          [did, req.ctx.wid],
        );
        requireThat(d, 404, 'NOT_FOUND', '文档不存在');
        const [v] = await tx.query(
          'SELECT max(version_no)::int AS n FROM document_versions WHERE workspace_id=$1 AND document_id=$2',
          [req.ctx.wid, did],
        );
        version = v.n + 1;
      } else
        await tx.query('INSERT INTO documents(id,workspace_id,title) VALUES($1,$2,$3)', [
          did,
          req.ctx.wid,
          input.title,
        ]);
      const vid = id(),
        jobId = id();
      await tx.query(
        'INSERT INTO document_versions(id,workspace_id,document_id,version_no,body,content_hash) VALUES($1,$2,$3,$4,$5,$6)',
        [vid, req.ctx.wid, did, version, input.body, hash(input.body)],
      );
      await tx.query('INSERT INTO jobs(id,workspace_id,type,payload) VALUES($1,$2,$3,$4::jsonb)', [
        jobId,
        req.ctx.wid,
        'document.embed',
        JSON.stringify({ versionId: vid }),
      ]);
      return { id: did, jobId, versionId: vid };
    });
  }
  r.post(
    base + '/documents',
    wrap(async (req, res) => res.status(202).json(await upload(req))),
  );
  r.post(
    base + '/documents/:id/versions',
    wrap(async (req, res) => res.status(202).json(await upload(req, true))),
  );
  r.get(
    base + '/documents/:id',
    wrap(async (req, res) => {
      const [d] = await db.query(
        'SELECT * FROM documents WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL',
        [req.ctx.wid, req.params.id],
      );
      requireThat(d, 404, 'NOT_FOUND', '文档不存在');
      const versions = await db.query(
        'SELECT * FROM document_versions WHERE workspace_id=$1 AND document_id=$2 ORDER BY version_no DESC',
        [req.ctx.wid, d.id],
      );
      const chunks = await db.query(
        'SELECT id,chunk_index,heading,start_offset,end_offset,text FROM document_chunks WHERE workspace_id=$1 AND version_id=$2 ORDER BY chunk_index',
        [req.ctx.wid, d.active_version_id],
      );
      res.json({ ...d, versions, chunks });
    }),
  );
  r.delete(
    base + '/documents/:id',
    wrap(async (req, res) => {
      await member(db, req.ctx.wid, req.ctx.uid, true, true);
      const [d] = await db.query(
        'UPDATE documents SET deleted_at=now() WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id',
        [req.ctx.wid, req.params.id],
      );
      requireThat(d, 404, 'NOT_FOUND', '文档不存在');
      const runs = await db.query(
        "SELECT DISTINCT r.id FROM ai_runs r JOIN messages m ON m.run_id=r.id JOIN message_citations c ON c.message_id=m.id JOIN document_versions v ON v.id=c.version_id WHERE r.workspace_id=$1 AND v.document_id=$2 AND r.status IN ('pending','retrieving','generating')",
        [req.ctx.wid, d.id],
      );
      for (const run of runs)
        active.get(run.id)?.abort(new AppError(409, 'SOURCE_DELETED', '引用来源已删除'));
      res.json({ ok: true });
    }),
  );
  r.post(
    base + '/documents/:id/retry',
    wrap(async (req, res) => {
      await member(db, req.ctx.wid, req.ctx.uid, true, true);
      const result = await db.transaction(async (tx) => {
        const [d] = await tx.query(
          'SELECT id FROM documents WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
          [req.ctx.wid, req.params.id],
        );
        requireThat(d, 404, 'NOT_FOUND', '文档不存在');
        const [v] = await tx.query(
          'SELECT * FROM document_versions WHERE workspace_id=$1 AND document_id=$2 ORDER BY version_no DESC LIMIT 1 FOR UPDATE',
          [req.ctx.wid, d.id],
        );
        requireThat(v?.status === 'failed', 409, 'NOT_FAILED', '仅失败的版本可以重试');
        await tx.query(
          "UPDATE document_versions SET status='pending',error=NULL WHERE id=$1 AND workspace_id=$2",
          [v.id, req.ctx.wid],
        );
        const jid = id();
        await tx.query(
          "INSERT INTO jobs(id,workspace_id,type,payload) VALUES($1,$2,'document.embed',$3::jsonb)",
          [jid, req.ctx.wid, JSON.stringify({ versionId: v.id })],
        );
        return { jobId: jid };
      });
      res.status(202).json(result);
    }),
  );
  r.get(
    base + '/jobs/:id',
    wrap(async (req, res) => {
      const [j] = await db.query('SELECT * FROM jobs WHERE workspace_id=$1 AND id=$2', [
        req.ctx.wid,
        req.params.id,
      ]);
      requireThat(j, 404, 'NOT_FOUND', '任务不存在');
      res.json(j);
    }),
  );
  r.get(
    base + '/citations/:id',
    wrap(async (req, res) => {
      const [c] = await db.query(
        'SELECT c.*,d.title,d.deleted_at,d.active_version_id,v.document_id,v.version_no,ch.start_offset,ch.end_offset,ch.heading FROM message_citations c JOIN messages m ON m.id=c.message_id JOIN conversations co ON co.id=m.conversation_id JOIN document_versions v ON v.id=c.version_id JOIN documents d ON d.id=v.document_id JOIN document_chunks ch ON ch.id=c.chunk_id WHERE c.workspace_id=$1 AND c.id=$2 AND co.owner_id=$3',
        [req.ctx.wid, req.params.id, req.ctx.uid],
      );
      requireThat(c, 404, 'NOT_FOUND', '引用不存在或无权访问');
      requireThat(!c.deleted_at, 410, 'SOURCE_DELETED', '来源已删除，无法查看引用正文');
      res.json({ ...c, historical: c.version_id !== c.active_version_id });
    }),
  );
  r.get(
    base + '/conversations/:id/ticket-drafts',
    wrap(async (req, res) => {
      await ownConversation(db, req.ctx.wid, String(req.params.id), req.ctx.uid);
      res.json({
        items: await db.query(
          'SELECT * FROM tool_drafts WHERE workspace_id=$1 AND conversation_id=$2 AND created_by=$3 ORDER BY created_at DESC',
          [req.ctx.wid, req.params.id, req.ctx.uid],
        ),
      });
    }),
  );
  r.post(
    base + '/conversations/:id/ticket-drafts',
    wrap(async (req, res) => {
      await ownConversation(db, req.ctx.wid, String(req.params.id), req.ctx.uid);
      await aiBudget(db, req.ctx.uid);
      const input = z.object({ runId: z.string().optional() }).parse(req.body);
      const [run] = await db.query(
        "SELECT * FROM ai_runs WHERE workspace_id=$1 AND conversation_id=$2 AND ($3::text IS NULL OR id=$3) AND status IN ('completed','failed','cancelled','interrupted') ORDER BY created_at DESC LIMIT 1",
        [req.ctx.wid, req.params.id, input.runId || null],
      );
      requireThat(run, 422, 'NO_MESSAGES', '请先发送客户问题');
      const payload = await generateDraft(run.question, run.content);
      const [d] = await db.query(
        "INSERT INTO tool_drafts(id,workspace_id,conversation_id,run_id,created_by,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,now()+interval '24 hours') RETURNING *",
        [id(), req.ctx.wid, req.params.id, run.id, req.ctx.uid, JSON.stringify(payload)],
      );
      res.status(201).json(d);
    }),
  );
  async function draft(req: Req, tx: any, lock = false) {
    const [d] = await tx.query(
      `SELECT * FROM tool_drafts WHERE workspace_id=$1 AND id=$2 AND created_by=$3${lock ? ' FOR UPDATE' : ''}`,
      [req.ctx.wid, req.params.id, req.ctx.uid],
    );
    requireThat(d, 404, 'NOT_FOUND', '草稿不存在或无权访问');
    return d;
  }
  r.patch(
    base + '/ticket-drafts/:id',
    wrap(async (req, res) => {
      const input = ticketInput.extend({ version: z.number().int().positive() }).parse(req.body);
      res.json(
        await db.transaction(async (tx) => {
          const d = await draft(req, tx, true);
          requireThat(
            d.status === 'pending' && new Date(d.expires_at).getTime() > Date.now(),
            409,
            'DRAFT_NOT_PENDING',
            '草稿已提交、取消或过期',
          );
          requireThat(d.version === input.version, 409, 'VERSION_CONFLICT', '草稿版本冲突');
          const { version: _version, ...payload } = input;
          await validateAssignee(tx, req.ctx.wid, input.assignee_id);
          const [u] = await tx.query(
            'UPDATE tool_drafts SET payload=$3::jsonb,version=version+1 WHERE workspace_id=$1 AND id=$2 RETURNING *',
            [req.ctx.wid, d.id, JSON.stringify(payload)],
          );
          return u;
        }),
      );
    }),
  );
  r.post(
    base + '/ticket-drafts/:id/cancel',
    wrap(async (req, res) => {
      const d = await draft(req, db);
      const [u] = await db.query(
        "UPDATE tool_drafts SET status='cancelled' WHERE workspace_id=$1 AND id=$2 AND status='pending' RETURNING *",
        [req.ctx.wid, d.id],
      );
      requireThat(u, 409, 'DRAFT_NOT_PENDING', '草稿已提交或不可取消');
      res.json(u);
    }),
  );
  r.post(
    base + '/ticket-drafts/:id/confirm',
    wrap(async (req, res) => {
      const input = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
      res.json(
        await db.transaction((tx) =>
          idempotent(
            tx,
            req.ctx.wid,
            req.ctx.uid,
            'draft.confirm',
            key(req),
            { id: req.params.id, ...input },
            async () => {
              const d = await draft(req, tx, true);
              if (d.status === 'confirmed') {
                const [t] = await tx.query('SELECT * FROM tickets WHERE workspace_id=$1 AND id=$2', [
                  req.ctx.wid,
                  d.ticket_id,
                ]);
                return t;
              }
              requireThat(
                d.status === 'pending' && new Date(d.expires_at).getTime() > Date.now(),
                409,
                'DRAFT_NOT_PENDING',
                '草稿已取消或过期',
              );
              requireThat(d.version === input.version, 409, 'VERSION_CONFLICT', '草稿已更新，请刷新');
              const t = await createTicket(
                tx,
                req.ctx.wid,
                req.ctx.uid,
                ticketInput.parse(d.payload),
                req.ctx.requestId,
                d.conversation_id,
              );
              await tx.query(
                "UPDATE tool_drafts SET status='confirmed',ticket_id=$3 WHERE workspace_id=$1 AND id=$2",
                [req.ctx.wid, d.id, t.id],
              );
              return t;
            },
          ),
        ),
      );
    }),
  );
  r.use((req, res) =>
    res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在', requestId: (req as Req).ctx.requestId }),
  );
  r.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const isValidation = err instanceof ZodError;
    const code = isValidation
      ? 'VALIDATION_ERROR'
      : err.code === '23505' || err.code === 'P2002' || err.meta?.code === '23505'
        ? 'CONFLICT'
        : err instanceof AppError
          ? err.code
          : 'INTERNAL_ERROR';
    const status = isValidation
      ? 422
      : err.code === '23505' || err.code === 'P2002' || err.meta?.code === '23505'
        ? 409
        : err instanceof AppError
          ? err.status
          : err.type === 'entity.too.large'
            ? 413
            : 500;
    const message = isValidation
      ? '输入格式不正确，请检查必填项与长度'
      : err.code === '23505' || err.code === 'P2002' || err.meta?.code === '23505'
        ? '记录已存在或同一会话正在生成'
        : err instanceof AppError
          ? err.message
          : status === 413
            ? '请求体过大'
            : '服务暂时不可用，请稍后重试';
    console.error(
      JSON.stringify({ requestId: (req as Req).ctx?.requestId, code, status, method: req.method }),
    );
    res.status(status).json({
      code,
      message,
      requestId: (req as Req).ctx?.requestId,
      details: isValidation ? err.flatten() : undefined,
    });
  });
  return r;
}
async function reserveAiBudget(tx: Sql, uid: string) {
  const now = new Date();
  const minute = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const [scope, window, limit, code, message] of [
    [`user:${uid}`, minute, 12, 'RATE_LIMIT', 'AI 请求过于频繁，请稍后重试'],
    ['global', day, Number(process.env.AI_DAILY_LIMIT || 100), 'DAILY_LIMIT', '今日 AI 调用额度已用完'],
  ] as const) {
    requireThat(Number.isInteger(limit) && limit > 0, 429, code, message);
    const [reservation] = await tx.query(
      'INSERT INTO ai_usage_limits(scope,window_start,used) VALUES($1,$2,1) ON CONFLICT(scope,window_start) DO UPDATE SET used=ai_usage_limits.used+1 WHERE ai_usage_limits.used<$3 RETURNING used',
      [scope, window, limit],
    );
    requireThat(reservation, 429, code, message);
  }
}
async function aiBudget(db: Database, uid: string) {
  await db.transaction((tx) => reserveAiBudget(tx, uid));
}
async function finalize(
  db: Database,
  runId: string,
  status: string,
  content: string,
  code: string | null = null,
) {
  return db.transaction(async (tx) => {
    const [run] = await tx.query(
      "UPDATE ai_runs SET status=$2,content=$3,error_code=$4,latency=extract(epoch FROM(now()-created_at))*1000,updated_at=now() WHERE id=$1 AND status IN ('pending','retrieving','generating') RETURNING *",
      [runId, status, content, code],
    );
    if (run)
      await tx.query("UPDATE messages SET status=$2,content=$3 WHERE run_id=$1 AND role='assistant'", [
        runId,
        status,
        content,
      ]);
    return run;
  });
}
async function streamRun(db: Database, req: Req, res: Response) {
  const input = runInput.parse(req.body);
  const { wid, uid } = req.ctx;
  const cid = String(req.params.id);
  await ownConversation(db, wid, cid, uid);
  const [old] = await db.query(
    'SELECT id,status FROM ai_runs WHERE workspace_id=$1 AND conversation_id=$2 AND client_request_id=$3',
    [wid, cid, input.clientRequestId],
  );
  if (old) {
    res.status(200).json({ runId: old.id, status: old.status, existing: true });
    return;
  }
  const runId = id(),
    messageId = id();
  const duplicate = await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM conversations WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [cid, wid]);
    const [duplicate] = await tx.query(
      'SELECT id,status FROM ai_runs WHERE workspace_id=$1 AND conversation_id=$2 AND client_request_id=$3',
      [wid, cid, input.clientRequestId],
    );
    if (duplicate) return duplicate;
    const [busy] = await tx.query(
      "SELECT id FROM ai_runs WHERE owner_id=$1 AND status IN ('pending','retrieving','generating')",
      [uid],
    );
    requireThat(!busy, 409, 'RUN_ACTIVE', '当前已有正在生成的回答，请完成或停止后重试');
    await reserveAiBudget(tx, uid);
    if (input.regeneratedFrom) {
      const [previous] = await tx.query(
        'SELECT id FROM ai_runs WHERE workspace_id=$1 AND conversation_id=$2 AND id=$3',
        [wid, cid, input.regeneratedFrom],
      );
      requireThat(previous, 422, 'INVALID_RUN', '原始运行不属于本会话');
    }
    await tx.query(
      "INSERT INTO ai_runs(id,workspace_id,conversation_id,owner_id,status,model,question,client_request_id,regenerated_from) VALUES($1,$2,$3,$4,'retrieving',$5,$6,$7,$8)",
      [
        runId,
        wid,
        cid,
        uid,
        modelName(),
        input.question,
        input.clientRequestId,
        input.regeneratedFrom || null,
      ],
    );
    await tx.query(
      "INSERT INTO messages(id,workspace_id,conversation_id,role,content,status,run_id) VALUES($1,$2,$3,'user',$4,'completed',$5)",
      [id(), wid, cid, input.question, runId],
    );
    await tx.query(
      "INSERT INTO messages(id,workspace_id,conversation_id,role,status,run_id) VALUES($1,$2,$3,'assistant','retrieving',$4)",
      [messageId, wid, cid, runId],
    );
    await tx.query('UPDATE conversations SET title=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2', [
      wid,
      cid,
      input.question.slice(0, 60),
    ]);
  });
  if (duplicate) {
    res.status(200).json({ runId: duplicate.id, status: duplicate.status, existing: true });
    return;
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const controller = new AbortController();
  active.set(runId, controller);
  let seq = 0,
    content = '',
    terminal = false,
    lastSave = Date.now();
  const started = Date.now();
  const send = (event: string, data: any = {}) => {
    if (!res.destroyed && !res.writableEnded)
      res.write(`event: ${event}\ndata: ${JSON.stringify({ runId, ...data, seq: ++seq })}\n\n`);
  };
  const onClose = () => {
    if (!terminal) controller.abort(new AppError(499, 'DISCONNECTED', '连接已中断'));
  };
  res.on('close', onClose);
  const timeout = setTimeout(() => controller.abort(new AppError(504, 'MODEL_TIMEOUT', '生成超时')), 90000);
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(': heartbeat\n\n');
  }, 15000);
  try {
    send('run.started', { messageId, model: modelName() });
    send('retrieval.started');
    const sources = await retrieve(db, wid, input.question, controller.signal);
    await db.transaction(async (tx) => {
      for (const s of sources) {
        s.citationId = id();
        await tx.query(
          'INSERT INTO message_citations(id,workspace_id,message_id,chunk_id,version_id,label,quoted_text) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [s.citationId, wid, messageId, s.id, s.version_id, s.label, s.text],
        );
      }
      await tx.query(
        "UPDATE ai_runs SET status='generating',updated_at=now() WHERE id=$1 AND status='retrieving'",
        [runId],
      );
    });
    send('sources.ready', {
      sources: sources.map((s) => ({ citationId: s.citationId, label: s.label, title: s.title })),
    });
    for await (const text of answer(input.question, sources, input.scenario, controller.signal)) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const [state] = await db.query('SELECT status FROM ai_runs WHERE id=$1', [runId]);
      if (state.status === 'cancelled') throw new AppError(499, 'CANCELLED', '已取消');
      requireThat(content.length + text.length <= 24000, 502, 'OUTPUT_LIMIT', '回答超过长度限制');
      const invalid = await db.query(
        'SELECT id FROM documents WHERE workspace_id=$1 AND id=ANY($2::text[]) AND deleted_at IS NOT NULL',
        [wid, sources.map((s) => s.document_id)],
      );
      requireThat(!invalid.length, 409, 'SOURCE_DELETED', '回答的来源已删除，请重新提问');
      content += text;
      send('message.delta', { text });
      if (Date.now() - lastSave > 400) {
        await db.transaction(async (tx) => {
          await tx.query(
            "UPDATE ai_runs SET content=$2,updated_at=now() WHERE id=$1 AND status='generating'",
            [runId, content],
          );
          await tx.query(
            "UPDATE messages SET content=$2,status='generating' WHERE run_id=$1 AND role='assistant' AND status IN ('retrieving','generating')",
            [runId, content],
          );
        });
        lastSave = Date.now();
      }
    }
    requireThat(content.trim(), 502, 'EMPTY_RESPONSE', '模型返回了空内容，请重试');
    const labels = [...content.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);
    requireThat(
      labels.every((l) => sources.some((s) => s.label === l)),
      502,
      'INVALID_CITATION',
      '模型返回了无效引用编号',
    );
    const saved = await finalize(db, runId, 'completed', content);
    if (saved) send('run.completed', { durationMs: Date.now() - started });
    else send('run.cancelled');
  } catch (e) {
    const error =
      e instanceof AppError
        ? e
        : controller.signal.aborted
          ? controller.signal.reason
          : new AppError(502, 'GENERATION_FAILED', '生成失败，请稍后重试');
    const status =
      error?.code === 'CANCELLED' ? 'cancelled' : error?.code === 'DISCONNECTED' ? 'interrupted' : 'failed';
    await finalize(db, runId, status, content, error?.code || 'GENERATION_FAILED');
    if (status === 'cancelled') send('run.cancelled');
    else send('run.failed', { code: error?.code, message: error?.message || '生成失败' });
  } finally {
    terminal = true;
    clearTimeout(timeout);
    clearInterval(heartbeat);
    active.delete(runId);
    res.off('close', onClose);
    res.end();
  }
}
