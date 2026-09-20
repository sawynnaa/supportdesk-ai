import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, post, setCsrf } from '../services/api';
export const useAuth = defineStore('auth', () => {
  const user = ref<any>(null),
    workspaces = ref<any[]>([]),
    workspaceId = ref(localStorage.getItem('workspace') || 'ws-demo'),
    ready = ref(false),
    mode = ref('mock'),
    model = ref('MockAdapter');
  const workspace = computed(() => workspaces.value.find((w) => w.id === workspaceId.value));
  const canWrite = computed(() => workspace.value?.role !== 'viewer');
  const isAdmin = computed(() => workspace.value?.role === 'admin');
  const base = computed(() => `/workspaces/${workspaceId.value}`);
  async function loadWorkspaces() {
    const d = await api('/workspaces');
    workspaces.value = d.items;
    if (!workspace.value) workspaceId.value = d.items[0]?.id;
  }
  async function restore() {
    try {
      const d = await api('/auth/me');
      user.value = d.user;
      setCsrf(d.csrf);
      mode.value = d.mode;
      model.value = d.model;
      await loadWorkspaces();
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
  }
  async function login(email: string, password: string) {
    const d = await post('/auth/login', { email, password });
    user.value = d.user;
    setCsrf(d.csrf);
    await restore();
  }
  async function logout() {
    await post('/auth/logout');
    user.value = null;
    setCsrf('');
  }
  function switchWorkspace(wid: string) {
    workspaceId.value = wid;
    localStorage.setItem('workspace', wid);
  }
  return {
    user,
    workspaces,
    workspaceId,
    workspace,
    canWrite,
    isAdmin,
    base,
    ready,
    mode,
    model,
    restore,
    login,
    logout,
    switchWorkspace,
  };
});
