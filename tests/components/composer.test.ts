// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { useAuth } from '../../apps/web/src/stores/auth';
import Assistant from '../../apps/web/src/pages/Assistant.vue';
const mocks = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  messages: { value: [] as any[] },
}));
vi.mock('../../apps/web/src/composables/useConversation', async () => {
  const { ref } = await import('vue');
  return {
    useConversation: () => ({
      conversations: ref([]),
      current: ref(''),
      messages: ref([]),
      busy: ref(false),
      error: ref(''),
      phase: ref(''),
      list: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(),
      newChat: vi.fn(),
      send: mocks.send,
      cancel: mocks.cancel,
    }),
  };
});
vi.mock('../../apps/web/src/services/api', () => ({
  api: vi.fn().mockResolvedValue({ items: [] }),
  post: vi.fn(),
  date: () => '',
}));
afterEach(() => vi.clearAllMocks());
async function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuth();
  auth.user = { id: 'admin', display_name: '测试' };
  auth.workspaces = [{ id: 'ws-demo', role: 'admin' }];
  auth.workspaceId = 'ws-demo';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div/>' } }],
  });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(Assistant, {
    global: {
      plugins: [pinia, router],
      stubs: { Icon: true, Markdown: true, TicketForm: true, 'el-dialog': true, 'el-drawer': true },
    },
  });
  await flushPromises();
  return wrapper;
}
describe('Chinese customer input', () => {
  it('does not send Enter during composition or Shift+Enter; sends exactly once after composition', async () => {
    const w = await setup();
    const input = w.get('textarea');
    await input.setValue('客户无法登录');
    await input.trigger('compositionstart');
    await input.trigger('keydown', { key: 'Enter' });
    expect(mocks.send).not.toHaveBeenCalled();
    await input.trigger('compositionend');
    await input.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(mocks.send).not.toHaveBeenCalled();
    await input.trigger('keydown', { key: 'Enter' });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('客户无法登录', 'normal', undefined);
    w.unmount();
  });
  it('does not send blank input', async () => {
    const w = await setup();
    await w.get('textarea').setValue('  ');
    await w.get('textarea').trigger('keydown', { key: 'Enter' });
    expect(mocks.send).not.toHaveBeenCalled();
    w.unmount();
  });
});
