import { describe, it, expect, vi } from 'vitest';
import { SSEParser, ticketInput, transitions } from '../../packages/contracts/src';
import { splitDocument, mockEmbedding, realMode, embed, generateDraft } from '../../apps/api/src/ai';
import { checkTransition } from '../../apps/api/src/domain';
describe('SSE incremental decoding', () => {
  it('handles every UTF-8 byte split, multiple frames and comments', () => {
    const parser = new SSEParser();
    const bytes = new TextEncoder().encode(
      ': keepalive\r\n\r\nevent: message.delta\r\ndata: {"text":"中文🙂跨块"}\r\n\r\nevent: run.completed\ndata: {"seq":2}\n\n',
    );
    const events = [];
    for (const b of bytes) events.push(...parser.feed(new Uint8Array([b])));
    expect(events).toEqual([
      { event: 'message.delta', data: { text: '中文🙂跨块' } },
      { event: 'run.completed', data: { seq: 2 } },
    ]);
  });
  it('does not emit a partial frame', () => {
    const p = new SSEParser();
    expect(p.feed(new TextEncoder().encode('event: message.delta\ndata: {"text":"hi"}'))).toEqual([]);
    expect(p.feed(new TextEncoder().encode('\n\n'))).toHaveLength(1);
  });
});
describe('business contracts', () => {
  it('rejects skipping ticket states', () => {
    expect(() => checkTransition('open', 'closed')).toThrow();
    expect(() => checkTransition('closed', 'resolved')).toThrow();
    for (const [from, tos] of Object.entries(transitions))
      for (const to of tos) expect(() => checkTransition(from, to)).not.toThrow();
  });
  it('rejects spoofed ownership fields and blank titles', () => {
    expect(ticketInput.safeParse({ title: '  ', description: 'valid' }).success).toBe(false);
    expect(
      ticketInput.safeParse({ title: '正常标题', description: '正常描述', workspace_id: 'evil' }).success,
    ).toBe(false);
  });
  it('retains original offsets and bounded chunks with overlap', () => {
    const text = '# 标题\n\n' + '中文段落 '.repeat(1900);
    const parts = splitDocument(text);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) {
      expect(p.text).toBe(text.slice(p.start_offset, p.end_offset));
      expect(p.text.length).toBeLessThanOrEqual(650);
    }
    for (let i = 1; i < parts.length; i++) expect(parts[i - 1].end_offset - parts[i].start_offset).toBe(80);
    expect(parts.at(-1)?.end_offset).toBe(text.length);
  });
  it('mock embeddings are deterministic and normalized', () => {
    expect(mockEmbedding('测试')).toEqual(mockEmbedding('测试'));
    expect(Math.hypot(...mockEmbedding('支持文档'))).toBeCloseTo(1);
  });
});

describe('AI configuration is opt-in', () => {
  it('stays with local templates without credentials even if the real switch is on', async () => {
    vi.stubEnv('AI_MODE', 'real');
    vi.stubEnv('REAL_AI_ENABLED', 'true');
    vi.stubEnv('MODEL_API_KEY', '');
    const network = vi.spyOn(globalThis, 'fetch');
    expect(realMode()).toBe(false);
    expect(await embed(['问题'])).toEqual([mockEmbedding('问题')]);
    expect((await generateDraft('客户无法登录', '')).title).toBe('客户无法登录');
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
    vi.unstubAllEnvs();
  });
});
