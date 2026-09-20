<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, post, date } from '../services/api';
import { useAuth } from '../stores/auth';
import { statusLabels, priorityLabels, transitions } from '../../../../packages/contracts/src';
import Icon from '../components/Icon.vue';
import StatePanel from '../components/StatePanel.vue';
import { ElMessage } from 'element-plus';
const auth = useAuth(),
  route = useRoute();
const t = ref<any>(null),
  comments = ref<any[]>([]),
  activity = ref<any[]>([]),
  members = ref<any[]>([]),
  loading = ref(true),
  error = ref(''),
  busy = ref(false),
  note = ref(''),
  editing = ref(false),
  edit = ref<any>({});
const path = () => auth.base + '/tickets/' + route.params.id;
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [ticket, c, a, m] = await Promise.all([
      api(path()),
      api(path() + '/comments'),
      api(path() + '/activity'),
      api(auth.base + '/members'),
    ]);
    t.value = ticket;
    comments.value = c.items;
    activity.value = a.items;
    members.value = m.items.filter((x: any) => x.role !== 'viewer');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function action(fn: () => Promise<any>) {
  busy.value = true;
  try {
    await fn();
    await load();
    ElMessage.success('已保存');
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function assign(e: Event) {
  await action(() =>
    api(path(), {
      method: 'PATCH',
      body: JSON.stringify({
        assignee_id: (e.target as HTMLSelectElement).value || null,
        version: t.value.version,
      }),
    }),
  );
}
async function comment() {
  if (!note.value.trim()) return;
  await action(async () => {
    await post(path() + '/comments', { body: note.value });
    note.value = '';
  });
}
function startEdit() {
  edit.value = { title: t.value.title, description: t.value.description, priority: t.value.priority };
  editing.value = true;
}
async function saveEdit() {
  await action(async () => {
    await api(path(), { method: 'PATCH', body: JSON.stringify({ ...edit.value, version: t.value.version }) });
    editing.value = false;
  });
}
onMounted(load);
const actionNames: Record<string, string> = {
  created: '创建了工单',
  updated: '更新了工单内容或负责人',
  status_changed: '修改了工单状态',
  comment_added: '添加了内部备注',
};
</script>
<template>
  <div class="page detail-page">
    <router-link class="back-link" to="/tickets"><Icon name="back" :size="16" />返回工单列表</router-link
    ><StatePanel :loading="loading" :error="error" @retry="load" /><template v-if="t && !loading && !error"
      ><div class="detail-heading">
        <div>
          <div class="detail-kicker">
            SD-{{ String(t.number).padStart(4, '0')
            }}<span class="status-badge" :class="t.status"
              ><span class="tiny-dot"></span>{{ statusLabels[t.status] }}</span
            >
          </div>
          <h1>{{ t.title }}</h1>
          <p class="muted">
            {{ t.creator_name }} 创建于 {{ date(t.created_at) }}
            <span v-if="t.source_conversation_id"> · 来自 AI 会话</span>
          </p>
        </div>
        <button v-if="auth.canWrite" class="btn" @click="startEdit"><Icon name="edit" />编辑工单</button>
      </div>
      <div class="detail-grid">
        <div class="detail-main">
          <section class="panel detail-section">
            <h3><Icon name="file" />问题描述</h3>
            <div class="pre-wrap description">{{ t.description }}</div>
          </section>
          <section class="panel detail-section">
            <h3>
              <Icon name="chat" />内部备注 <span class="muted">{{ comments.length }}</span>
            </h3>
            <div v-if="!comments.length" class="small-empty">暂无备注，记录一次排查进展吧。</div>
            <div v-for="c in comments" :key="c.id" class="comment">
              <span class="avatar violet">{{ c.author_name.slice(0, 1) }}</span>
              <div>
                <strong>{{ c.author_name }}</strong
                ><small>{{ date(c.created_at) }}</small>
                <p class="pre-wrap">{{ c.body }}</p>
              </div>
            </div>
            <form v-if="auth.canWrite" class="note-form" @submit.prevent="comment">
              <textarea
                v-model="note"
                rows="3"
                placeholder="添加内部备注，仅工作区成员可见…"
                maxlength="5000"
                required
              ></textarea>
              <div>
                <span><Icon name="shield" :size="13" />仅供团队内部协作</span
                ><button class="btn primary" :disabled="busy || !note.trim()">添加备注</button>
              </div>
            </form>
          </section>
          <section class="panel detail-section">
            <h3><Icon name="clock" />操作时间线</h3>
            <div v-if="!activity.length" class="small-empty">
              种子演示工单暂无操作历史，后续更改会记录在这里。
            </div>
            <div v-for="a in activity" :key="a.id" class="timeline-item">
              <span class="timeline-dot"></span>
              <div>
                <p>
                  <strong>{{ a.actor_name }}</strong> {{ actionNames[a.action] || a.action
                  }}<span v-if="a.action === 'status_changed'"
                    >：{{ statusLabels[a.before_data?.status] }} →
                    {{ statusLabels[a.after_data?.status] }}</span
                  >
                </p>
                <small>{{ date(a.created_at) }}</small>
              </div>
            </div>
          </section>
        </div>
        <aside class="panel detail-properties">
          <h3>工单属性</h3>
          <label
            >负责人<select :disabled="!auth.canWrite || busy" :value="t.assignee_id || ''" @change="assign">
              <option value="">未分配</option>
              <option v-for="m in members" :key="m.id" :value="m.id">{{ m.display_name }}</option>
            </select></label
          ><label
            >优先级<span class="priority" :class="t.priority"
              ><span class="priority-bars"><i></i><i></i><i></i></span
              >{{ priorityLabels[t.priority] }}优先级</span
            ></label
          ><label
            >当前状态<span class="status-badge" :class="t.status"
              ><span class="tiny-dot"></span>{{ statusLabels[t.status] }}</span
            ></label
          ><label
            >最近更新<span>{{ date(t.updated_at) }}</span></label
          ><label
            >数据版本<span>v{{ t.version }}</span></label
          >
          <div v-if="auth.canWrite" class="transition-actions">
            <button
              v-for="s in transitions[t.status]"
              :key="s"
              class="btn primary"
              :disabled="busy"
              @click="action(() => post(path() + '/transitions', { status: s, version: t.version }))"
            >
              <Icon name="arrow" :size="16" />{{
                s === 'open'
                  ? '重新打开'
                  : s === 'in_progress'
                    ? '开始处理'
                    : s === 'resolved'
                      ? '标记已解决'
                      : '关闭工单'
              }}
            </button>
          </div>
          <p class="property-tip"><Icon name="info" :size="15" />每次状态变更都会记录在操作历史中。</p>
        </aside>
      </div></template
    ><el-dialog v-model="editing" title="编辑工单" width="560px"
      ><form class="form-stack" @submit.prevent="saveEdit">
        <label>标题<input v-model="edit.title" required minlength="2" maxlength="160" /></label
        ><label>描述<textarea v-model="edit.description" rows="7" required minlength="2"></textarea></label
        ><label
          >优先级<select v-model="edit.priority">
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select></label
        >
        <div class="dialog-actions"><button class="btn primary" :disabled="busy">保存更改</button></div>
      </form></el-dialog
    >
  </div>
</template>
