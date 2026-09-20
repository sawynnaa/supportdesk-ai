<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, date } from '../services/api';
import { useAuth } from '../stores/auth';
import { statusLabels, priorityLabels } from '../../../../packages/contracts/src';
import Icon from '../components/Icon.vue';
import StatePanel from '../components/StatePanel.vue';
import TicketForm from '../components/TicketForm.vue';
const auth = useAuth(),
  route = useRoute(),
  router = useRouter();
const items = ref<any[]>([]),
  total = ref(0),
  stats = ref<Record<string, number>>({}),
  members = ref<any[]>([]),
  loading = ref(true),
  error = ref(''),
  create = ref(false),
  search = ref(String(route.query.search || ''));
let seq = 0,
  timer: ReturnType<typeof setTimeout>;
const status = computed(() => String(route.query.status || '')),
  page = computed(() => Number(route.query.page || 1));
const all = computed(() => Object.values(stats.value).reduce((a, b) => a + b, 0));
async function load() {
  const request = ++seq;
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(route.query)) if (v) params.set(k, String(v));
    const d = await api(auth.base + '/tickets?' + params.toString());
    if (request !== seq) return;
    items.value = d.items;
    total.value = d.total;
  } catch (e) {
    if (request === seq) error.value = (e as Error).message;
  } finally {
    if (request === seq) loading.value = false;
  }
}
async function loadStats() {
  stats.value = Object.fromEntries(
    (await api(auth.base + '/stats')).items.map((s: any) => [s.status, s.count]),
  );
}
function filter(k: string, v: string) {
  void router.replace({ query: { ...route.query, [k]: v || undefined, page: k === 'page' ? v : undefined } });
}
watch(search, (v) => {
  clearTimeout(timer);
  timer = setTimeout(() => filter('search', v), 300);
});
watch(
  () => route.query,
  () => {
    search.value = String(route.query.search || '');
    void load();
  },
);
onMounted(async () => {
  void load();
  try {
    await loadStats();
    members.value = (await api(auth.base + '/members')).items;
  } catch (e) {
    error.value = (e as Error).message;
  }
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  seq++;
});
async function created() {
  await Promise.all([load(), loadStats()]);
}
</script>
<template>
  <div class="page tickets-page">
    <div class="page-heading">
      <div>
        <div class="page-eyebrow">CUSTOMER SUPPORT</div>
        <h1>
          工单管理<span class="heading-count">{{ all }}</span>
        </h1>
        <p>有序跟进每一个问题，让客户支持更进一步。</p>
      </div>
      <div class="heading-actions">
        <router-link class="btn" to="/assistant"><Icon name="sparkles" />AI 工作台</router-link
        ><button v-if="auth.canWrite" class="btn primary" @click="create = true">
          <Icon name="plus" />创建工单
        </button>
      </div>
    </div>
    <div class="stats-grid">
      <button
        class="stat-card"
        :class="{ selected: status === 'open' }"
        @click="filter('status', status === 'open' ? '' : 'open')"
      >
        <div class="stat-top">
          <span>待处理</span><span class="stat-icon amber"><Icon name="inbox" /></span>
        </div>
        <div class="stat-number">{{ stats.open || 0 }}<span>个工单</span></div>
        <div class="stat-foot">
          <span class="tiny-dot amber-bg"></span>等待团队响应<Icon name="upRight" :size="14" />
        </div></button
      ><button
        class="stat-card"
        :class="{ selected: status === 'in_progress' }"
        @click="filter('status', status === 'in_progress' ? '' : 'in_progress')"
      >
        <div class="stat-top">
          <span>处理中</span><span class="stat-icon blue"><Icon name="clock" /></span>
        </div>
        <div class="stat-number">{{ stats.in_progress || 0 }}<span>个工单</span></div>
        <div class="stat-foot">
          <span class="tiny-dot blue-bg"></span>正在积极跟进<Icon name="upRight" :size="14" />
        </div></button
      ><button
        class="stat-card"
        :class="{ selected: status === 'resolved' }"
        @click="filter('status', status === 'resolved' ? '' : 'resolved')"
      >
        <div class="stat-top">
          <span>已解决</span><span class="stat-icon green"><Icon name="done" /></span>
        </div>
        <div class="stat-number">{{ stats.resolved || 0 }}<span>个工单</span></div>
        <div class="stat-foot">
          <span class="tiny-dot green-bg"></span>等待确认关闭<Icon name="upRight" :size="14" />
        </div></button
      ><button
        class="stat-card"
        :class="{ selected: status === 'closed' }"
        @click="filter('status', status === 'closed' ? '' : 'closed')"
      >
        <div class="stat-top">
          <span>已关闭</span><span class="stat-icon gray"><Icon name="check" /></span>
        </div>
        <div class="stat-number">{{ stats.closed || 0 }}<span>个工单</span></div>
        <div class="stat-foot">
          <span class="tiny-dot gray-bg"></span>每一次回应都算数<Icon name="upRight" :size="14" />
        </div>
      </button>
    </div>
    <div class="ticket-panel">
      <div class="list-tabs">
        <button :class="{ active: !status }" @click="filter('status', '')">
          全部工单<span>{{ all }}</span></button
        ><button
          v-for="(label, s) in statusLabels"
          :key="s"
          :class="{ active: status === s }"
          @click="filter('status', String(s))"
        >
          {{ label }}<span v-if="stats[s]">{{ stats[s] }}</span>
        </button>
        <div class="list-tabs-right"><Icon name="shield" :size="14" />工作区数据隔离</div>
      </div>
      <div class="filter-bar">
        <div class="search-input">
          <Icon name="search" :size="17" /><input
            v-model="search"
            placeholder="搜索工单标题…"
            aria-label="搜索工单标题"
          /><kbd>⌕</kbd>
        </div>
        <div class="filter-group">
          <select
            aria-label="优先级筛选"
            :value="route.query.priority || ''"
            @change="filter('priority', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">全部优先级</option>
            <option value="high">高优先级</option>
            <option value="medium">中优先级</option>
            <option value="low">低优先级</option></select
          ><select
            aria-label="负责人筛选"
            :value="route.query.assignee || ''"
            @change="filter('assignee', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">全部负责人</option>
            <option value="unassigned">未分配</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.display_name }}</option></select
          ><button class="icon-btn filter-reset" title="清除筛选" @click="router.replace({ query: {} })">
            <Icon name="filter" />
          </button>
        </div>
      </div>
      <StatePanel
        :loading="loading"
        :error="error"
        :empty="!items.length"
        title="没有找到符合条件的工单"
        @retry="load"
      />
      <div v-if="!loading && !error && items.length" class="table-scroll">
        <table class="ticket-table">
          <thead>
            <tr>
              <th class="id-col">工单编号</th>
              <th>标题</th>
              <th>状态</th>
              <th>优先级</th>
              <th>负责人</th>
              <th>更新时间<Icon name="down" :size="12" /></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in items" :key="t.id" @click="router.push('/tickets/' + t.id)">
              <td class="ticket-number">SD-{{ String(t.number).padStart(4, '0') }}</td>
              <td class="title-cell">
                <router-link :to="'/tickets/' + t.id">{{ t.title }}</router-link
                ><span v-if="t.source_conversation_id" class="ai-small"
                  ><Icon name="sparkles" :size="11" />AI</span
                >
              </td>
              <td>
                <span class="status-badge" :class="t.status"
                  ><span class="tiny-dot"></span>{{ statusLabels[t.status] }}</span
                >
              </td>
              <td>
                <span class="priority" :class="t.priority"
                  ><span class="priority-bars"><i></i><i></i><i></i></span
                  >{{ priorityLabels[t.priority] }}</span
                >
              </td>
              <td>
                <div class="assignee">
                  <span
                    v-if="t.assignee_name"
                    class="avatar mini"
                    :class="t.assignee_id === 'admin' ? 'violet' : 'peach'"
                    >{{ t.assignee_name.slice(0, 1) }}</span
                  ><span v-else class="unassigned-avatar"><Icon name="user" :size="13" /></span
                  ><span :class="{ muted: !t.assignee_name }">{{ t.assignee_name || '未分配' }}</span>
                </div>
              </td>
              <td class="time-cell">{{ date(t.updated_at) }}</td>
              <td><Icon name="right" :size="15" class="row-arrow" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span
          >共 <strong>{{ total }}</strong> 条工单<span class="pagination-hint"> · 每页 8 条</span></span
        >
        <div>
          <button
            class="page-button"
            aria-label="上一页"
            :disabled="page <= 1"
            @click="filter('page', String(page - 1))"
          >
            <Icon name="back" :size="15" /></button
          ><button
            v-for="p in Math.max(1, Math.ceil(total / 8))"
            :key="p"
            class="page-button"
            :class="{ active: page === p }"
            @click="filter('page', String(p))"
          >
            {{ p }}</button
          ><button
            class="page-button"
            aria-label="下一页"
            :disabled="page >= Math.ceil(total / 8)"
            @click="filter('page', String(page + 1))"
          >
            <Icon name="arrow" :size="15" />
          </button>
        </div>
      </div>
    </div>
    <div class="bottom-tip">
      <Icon name="sparkles" :size="16" /><span
        >让 AI 成为你的支持搭档：从知识库中寻找答案，一键生成工单草稿。</span
      ><router-link to="/assistant">开始体验<Icon name="arrow" :size="14" /></router-link>
    </div>
    <TicketForm v-model="create" @created="created" />
  </div>
</template>
