import { z } from 'zod';
export const prioritySchema = z.enum(['low', 'medium', 'high']);
export const statusSchema = z.enum(['open', 'in_progress', 'resolved', 'closed']);
export const ticketInput = z
  .object({
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().min(2).max(20000),
    priority: prioritySchema.default('medium'),
    assignee_id: z.string().max(100).nullable().optional(),
  })
  .strict();
export const ticketPatch = ticketInput.partial().extend({ version: z.number().int().positive() }).strict();
export const documentInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().min(1).max(1048576),
    filename: z.string().regex(/\.(md|txt)$/i),
  })
  .strict();
export const runInput = z
  .object({
    question: z.string().trim().min(1).max(6000),
    clientRequestId: z.string().min(8).max(100),
    scenario: z
      .enum(['normal', 'slow', 'empty', 'failure', 'timeout', 'long', 'malformed'])
      .default('normal'),
    regeneratedFrom: z.string().optional(),
  })
  .strict();
export const transitions: Record<string, string[]> = {
  open: ['in_progress'],
  in_progress: ['resolved'],
  resolved: ['in_progress', 'closed'],
  closed: ['open'],
};
export const statusLabels: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};
export const priorityLabels: Record<string, string> = { low: '低', medium: '中', high: '高' };
export type Role = 'admin' | 'agent' | 'viewer';
export type Ticket = z.infer<typeof ticketInput> & {
  id: string;
  number: number;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  assignee_name: string | null;
  creator_name: string;
};
export type StreamEvent = { event: string; data: Record<string, any> };
/** Incremental SSE parser. The decoder is retained across UTF-8 chunks. */
export class SSEParser {
  private decoder = new TextDecoder();
  private buffer = '';
  feed(chunk: Uint8Array, final = false): StreamEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: !final });
    const result: StreamEvent[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) result.push({ event, data: JSON.parse(data.join('\n')) });
    }
    return result;
  }
}
