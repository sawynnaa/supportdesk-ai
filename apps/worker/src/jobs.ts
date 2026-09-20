import type { Database } from '../../api/src/db.js';
import { embed, embeddingName, splitDocument } from '../../api/src/ai.js';
import { id } from '../../api/src/domain.js';
export async function processJob(db: Database) {
  const workerId = id();
  const job = await db.transaction(async (tx) => {
    const [j] = await tx.query(
      `SELECT * FROM jobs WHERE ((status='pending' AND run_after<=now()) OR (status='running' AND locked_until<now())) AND attempts<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    if (!j) return null;
    await tx.query(
      "UPDATE jobs SET status='running',attempts=attempts+1,locked_until=now()+interval '120 seconds',locked_by=$2 WHERE id=$1",
      [j.id, workerId],
    );
    return { ...j, attempts: j.attempts + 1 };
  });
  if (!job) return false;
  try {
    const [v] = await db.query(
      'SELECT v.*,d.deleted_at FROM document_versions v JOIN documents d ON d.id=v.document_id AND d.workspace_id=v.workspace_id WHERE v.id=$1 AND v.workspace_id=$2',
      [job.payload.versionId, job.workspace_id],
    );
    if (!v || v.deleted_at) throw new Error('文档已删除');
    const chunks = splitDocument(v.body);
    const vectors: number[][] = [];
    for (let offset = 0; offset < chunks.length; offset += 16) {
      const [lease] = await db.query(
        "UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND locked_by=$2 AND status='running' RETURNING id",
        [job.id, workerId],
      );
      if (!lease) return true;
      vectors.push(...(await embed(chunks.slice(offset, offset + 16).map((c) => c.text))));
    }
    await db.transaction(async (tx) => {
      const [lease] = await tx.query(
        "SELECT id FROM jobs WHERE id=$1 AND locked_by=$2 AND status='running' FOR UPDATE",
        [job.id, workerId],
      );
      if (!lease) return;
      const [d] = await tx.query('SELECT * FROM documents WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        v.document_id,
        job.workspace_id,
      ]);
      if (d.deleted_at) throw new Error('文档已删除');
      await tx.query('DELETE FROM document_chunks WHERE workspace_id=$1 AND version_id=$2', [
        job.workspace_id,
        v.id,
      ]);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        await tx.query(
          'INSERT INTO document_chunks(id,workspace_id,version_id,chunk_index,heading,start_offset,end_offset,text,embedding) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)',
          [
            id(),
            job.workspace_id,
            v.id,
            c.chunk_index,
            c.heading,
            c.start_offset,
            c.end_offset,
            c.text,
            JSON.stringify(vectors[i]),
          ],
        );
      }
      await tx.query(
        "UPDATE document_versions SET status='ready',error=NULL,embedding_model=$2,embedding_dimension=$3 WHERE id=$1 AND workspace_id=$4",
        [v.id, embeddingName(), vectors[0].length, job.workspace_id],
      );
      // An older slow job must never replace a newer active version.
      await tx.query(
        'UPDATE documents SET active_version_id=$2,updated_at=now() WHERE id=$1 AND workspace_id=$3 AND (active_version_id IS NULL OR (SELECT version_no FROM document_versions WHERE id=active_version_id)<$4)',
        [v.document_id, v.id, job.workspace_id, v.version_no],
      );
      await tx.query("UPDATE jobs SET status='completed',locked_until=NULL WHERE id=$1 AND locked_by=$2", [
        job.id,
        workerId,
      ]);
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : '文档处理失败';
    await db.transaction(async (tx) => {
      const [lease] = await tx.query('SELECT id FROM jobs WHERE id=$1 AND locked_by=$2 FOR UPDATE', [
        job.id,
        workerId,
      ]);
      if (!lease) return;
      const terminal = job.attempts >= 3 || reason.includes('已删除');
      await tx.query(
        "UPDATE jobs SET status=$2,last_error=$3,locked_until=NULL,run_after=now()+($4::text||' seconds')::interval WHERE id=$1",
        [job.id, terminal ? 'failed' : 'pending', reason, 2 ** job.attempts],
      );
      await tx.query('UPDATE document_versions SET status=$2,error=$3 WHERE id=$1 AND workspace_id=$4', [
        job.payload.versionId,
        terminal ? 'failed' : 'pending',
        reason,
        job.workspace_id,
      ]);
    });
  }
  return true;
}
export function startWorker(db: Database) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await processJob(db);
      await db.transaction(async (tx) => {
        const stale = await tx.query(
          "UPDATE ai_runs SET status='interrupted',error_code='STALE_RUN',updated_at=now() WHERE status IN ('pending','retrieving','generating') AND updated_at<now()-interval '3 minutes' RETURNING id",
        );
        for (const r of stale)
          await tx.query("UPDATE messages SET status='interrupted' WHERE run_id=$1 AND role='assistant'", [
            r.id,
          ]);
        await tx.query("UPDATE tool_drafts SET status='expired' WHERE status='pending' AND expires_at<now()");
        await tx.query(
          "UPDATE jobs SET status='failed',last_error='处理租约超时，已达到重试上限' WHERE status='running' AND locked_until<now() AND attempts>=3",
        );
        await tx.query(
          "UPDATE document_versions SET status='failed',error=j.last_error FROM jobs j WHERE j.payload->>'versionId'=document_versions.id AND j.status='failed' AND document_versions.status='pending'",
        );
      });
    } catch (e) {
      console.error('worker error', e instanceof Error ? e.message : 'unknown');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 1000);
  void tick();
  return () => clearInterval(timer);
}
