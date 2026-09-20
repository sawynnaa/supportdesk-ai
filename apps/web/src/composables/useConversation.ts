import { ref, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, post, streamFetch } from '../services/api';
import { useAuth } from '../stores/auth';
import { SSEParser } from '../../../../packages/contracts/src';
export function useConversation() {
  const route = useRoute(),
    router = useRouter();
  const auth = useAuth(),
    conversations = ref<any[]>([]),
    current = ref(''),
    messages = ref<any[]>([]),
    busy = ref(false),
    error = ref(''),
    phase = ref(''),
    runId = ref('');
  let controller: AbortController | null = null;
  let selection = 0;
  let activePath = '';
  const path = () => auth.base + '/conversations';
  async function list() {
    conversations.value = (await api(path())).items;
    if (
      !current.value &&
      typeof route.query.c === 'string' &&
      conversations.value.some((c) => c.id === route.query.c)
    )
      await select(route.query.c);
  }
  async function select(cid: string) {
    if (busy.value) return;
    const serial = ++selection;
    error.value = '';
    current.value = cid;
    void router.replace({ query: { ...route.query, c: cid } });
    try {
      const d = await api(path() + '/' + cid + '/messages');
      if (serial === selection) messages.value = d.items;
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  async function newChat() {
    if (busy.value) return;
    try {
      const c = await post(path());
      await list();
      await select(c.id);
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  async function refresh() {
    if (current.value) await select(current.value);
  }
  async function send(question: string, scenario = 'normal', regeneratedFrom?: string) {
    if (!question.trim() || busy.value) return;
    error.value = '';
    try {
      if (!current.value) {
        await newChat();
        if (!current.value) return;
      }
    } catch (e) {
      error.value = (e as Error).message;
      return;
    }
    busy.value = true;
    phase.value = '检索中';
    runId.value = '';
    controller = new AbortController();
    activePath = auth.base;
    const cid = current.value;
    const pending: any = {
      id: 'pending-' + crypto.randomUUID(),
      role: 'assistant',
      content: '',
      status: 'retrieving',
      sources: [],
      regenerated_from: regeneratedFrom,
      model: auth.model,
    };
    messages.value.push(
      { id: crypto.randomUUID(), role: 'user', content: question, status: 'completed' },
      pending,
    );
    let buffer = '';
    let interval: ReturnType<typeof setInterval> | undefined;
    const flush = () => {
      if (buffer) {
        const m = messages.value.find((m) => m.id === pending.id);
        if (m) m.content += buffer;
        buffer = '';
      }
    };
    try {
      interval = setInterval(flush, 45);
      const response = await streamFetch(
        path() + '/' + cid + '/runs',
        { question, clientRequestId: crypto.randomUUID(), scenario, regeneratedFrom },
        controller.signal,
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || '请求失败');
      }
      if (response.headers.get('Content-Type')?.includes('application/json')) {
        await response.json();
        return;
      }
      if (!response.body) throw new Error('浏览器未收到响应流');
      const reader = response.body.getReader(),
        parser = new SSEParser();
      let terminal = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const e of parser.feed(value)) {
          const m = messages.value.find((m) => m.id === pending.id);
          if (!m) continue;
          if (e.event === 'run.started') {
            runId.value = e.data.runId;
            m.run_id = e.data.runId;
            m.model = e.data.model;
          }
          if (e.event === 'sources.ready') {
            m.sources = e.data.sources;
            m.status = 'generating';
            phase.value = '生成中';
          }
          if (e.event === 'message.delta') buffer += e.data.text;
          if (e.event === 'run.completed') {
            m.status = 'completed';
            phase.value = '已完成';
            terminal = true;
          }
          if (e.event === 'run.cancelled') {
            m.status = 'cancelled';
            phase.value = '已取消';
            terminal = true;
          }
          if (e.event === 'run.failed') {
            m.status = 'failed';
            error.value = e.data.message;
            phase.value = '失败';
            terminal = true;
          }
        }
      }
      flush();
      if (!terminal) error.value = '连接已中断，已保存的内容可通过刷新恢复。';
    } catch (e) {
      flush();
      if ((e as Error).name !== 'AbortError') error.value = (e as Error).message;
    } finally {
      if (interval) clearInterval(interval);
      busy.value = false;
      controller = null;
      try {
        await list();
        await refresh();
      } catch {
        /* Keep partial content if offline. */
      }
    }
  }
  async function cancel() {
    if (!runId.value) return;
    try {
      await post(activePath + '/runs/' + runId.value + '/cancel');
      controller?.abort();
      phase.value = '已取消';
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  onBeforeUnmount(() => {
    selection++;
    controller?.abort();
  });
  return {
    conversations,
    current,
    messages,
    busy,
    error,
    phase,
    runId,
    list,
    select,
    newChat,
    send,
    cancel,
    refresh,
  };
}
