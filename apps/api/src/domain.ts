import { randomUUID, createHash } from 'node:crypto';
import type { Sql } from './db.js';
import { transitions } from '../../../packages/contracts/src/index.js';
export const id = () => randomUUID();
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
export async function member(tx: Sql, wid: string, uid: string, write = false, admin = false) {
  const [m] = await tx.query('SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2', [wid, uid]);
  requireThat(m, 404, 'NOT_FOUND', '工作区不存在或无权访问');
  requireThat(!write || m.role !== 'viewer', 403, 'FORBIDDEN', '访客仅可查看');
  requireThat(!admin || m.role === 'admin', 403, 'FORBIDDEN', '仅管理员可管理知识库');
  return m;
}
export async function ownConversation(tx: Sql, wid: string, cid: string, uid: string) {
  const [c] = await tx.query('SELECT * FROM conversations WHERE workspace_id=$1 AND id=$2 AND owner_id=$3', [
    wid,
    cid,
    uid,
  ]);
  requireThat(c, 404, 'NOT_FOUND', '会话不存在或无权访问');
  return c;
}
export function checkTransition(from: string, to: string) {
  requireThat(transitions[from]?.includes(to), 422, 'INVALID_TRANSITION', '不允许此状态流转');
}
export async function audit(
  tx: Sql,
  wid: string,
  uid: string,
  entity: string,
  action: string,
  before: any,
  after: any,
  requestId: string,
) {
  await tx.query(
    'INSERT INTO audit_logs(id,workspace_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)',
    [
      id(),
      wid,
      uid,
      'ticket',
      entity,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      requestId,
    ],
  );
}
export async function validateAssignee(tx: Sql, wid: string, uid?: string | null) {
  if (uid) {
    const [m] = await tx.query(
      "SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=$2 AND role<>'viewer'",
      [wid, uid],
    );
    requireThat(m, 422, 'INVALID_ASSIGNEE', '负责人必须是本工作区客服或管理员');
  }
}
export async function createTicket(
  tx: Sql,
  wid: string,
  uid: string,
  input: any,
  requestId: string,
  cid: string | null = null,
) {
  await validateAssignee(tx, wid, input.assignee_id);
  const data = {
    id: id(),
    workspace_id: wid,
    title: input.title,
    description: input.description,
    priority: input.priority,
    assignee_id: input.assignee_id || null,
    created_by: uid,
    source_conversation_id: cid,
  };
  const t = tx.prisma
    ? await tx.prisma.ticket.create({ data })
    : (
        await tx.query(
          'INSERT INTO tickets(id,workspace_id,title,description,priority,assignee_id,created_by,source_conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
          [data.id, wid, data.title, data.description, data.priority, data.assignee_id, uid, cid],
        )
      )[0];
  await audit(tx, wid, uid, t.id, 'created', null, t, requestId);
  return t;
}
export async function idempotent(
  tx: Sql,
  wid: string,
  uid: string,
  operation: string,
  key: string,
  body: any,
  fn: () => Promise<any>,
) {
  requireThat(
    key && key.length >= 8 && key.length <= 100,
    400,
    'IDEMPOTENCY_REQUIRED',
    '需要有效的 Idempotency-Key',
  );
  // Lock the membership row: serializes per-actor creation, including different keys.
  await tx.query('SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE', [
    wid,
    uid,
  ]);
  const digest = hash(JSON.stringify(body));
  const [old] = await tx.query(
    'SELECT * FROM idempotency_records WHERE workspace_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4',
    [wid, uid, operation, key],
  );
  if (old) {
    requireThat(old.request_hash === digest, 409, 'IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同内容');
    return old.response;
  }
  const response = await fn();
  await tx.query(
    'INSERT INTO idempotency_records(workspace_id,actor_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
    [wid, uid, operation, key, digest, JSON.stringify(response)],
  );
  return response;
}
