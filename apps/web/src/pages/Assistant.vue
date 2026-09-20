<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { useConversation } from '../composables/useConversation';
import { api, post, date } from '../services/api';
import { ElMessage } from 'element-plus';
import Icon from '../components/Icon.vue';
import Markdown from '../components/Markdown.vue';
import TicketForm from '../components/TicketForm.vue';
const auth = useAuth(),
  router = useRouter();
const { conversations, current, messages, busy, error, phase, list, select, newChat, send, cancel } =
  useConversation();
const question = ref(''),
  composing = ref(false),
  scenario = ref('normal'),
  scroller = ref<HTMLElement>(),
  follow = ref(true),
  sourceOpen = ref(false),
  source = ref<any>(null),
  sourceError = ref(''),
  sourceLoading = ref(false),
  draft = ref<any>(null),
  draftEdit = ref<any>({}),
  draftBusy = ref(false),
  draftOpen = ref(false),
  members = ref<any[]>([]),
  manual = ref(false);
let confirmKey = crypto.randomUUID();
let pendingVersion: number | null = null;
const currentTitle = computed(
  () => conversations.value.find((c) => c.id === current.value)?.title || '新的开始',
);
const statuses: Record<string, string> = {
  retrieving: '检索中',
  generating: '生成中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '生成失败',
  interrupted: '已中断',
};
async function init() {
  if (!auth.canWrite) return;
  try {
    await list();
    members.value = (await api(auth.base + '/members')).items.filter((m: any) => m.role !== 'viewer');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function scrollBottom() {
  follow.value = true;
  void nextTick(() => {
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' });
  });
}
function onScroll() {
  const el = scroller.value;
  if (el) follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
}
watch(
  () => messages.value.map((m) => m.content).join(''),
  () => {
    if (follow.value)
      void nextTick(() => {
        const el = scroller.value;
        if (el) el.scrollTop = el.scrollHeight;
      });
  },
);
watch(current, async (cid) => {
  draft.value = null;
  follow.value = true;
  scrollBottom();
  if (cid) {
    try {
      const result = await api(auth.base + '/conversations/' + cid + '/ticket-drafts');
      if (current.value === cid) {
        const pending = result.items.find(
          (d: any) => d.status === 'pending' && new Date(d.expires_at).getTime() > Date.now(),
        );
        if (pending) {
          draft.value = pending;
          draftEdit.value = { ...pending.payload };
          pendingVersion = null;
          confirmKey = crypto.randomUUID();
        }
      }
    } catch {
      /* A failed draft lookup does not block the conversation. */
    }
  }
});
async function submit(text = question.value, regeneratedFrom?: string) {
  if (!text.trim() || busy.value) return;
  question.value = '';
  follow.value = true;
  await send(text, scenario.value, regeneratedFrom);
}
function keydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing.value) {
    e.preventDefault();
    void submit();
  }
}
async function viewSource(s: any) {
  sourceOpen.value = true;
  source.value = null;
  sourceLoading.value = true;
  sourceError.value = '';
  try {
    source.value = await api(auth.base + '/citations/' + s.citationId);
  } catch (e) {
    sourceError.value = (e as Error).message;
  } finally {
    sourceLoading.value = false;
  }
}
async function copy(m: any) {
  try {
    await navigator.clipboard.writeText(
      m.content + '\n\n参考来源：' + m.sources.map((s: any) => `[${s.label}] ${s.title}`).join('；'),
    );
    ElMessage.success('已复制答复与来源');
  } catch {
    ElMessage.error('复制失败，请选择文本手动复制');
  }
}
async function makeDraft(runId?: string) {
  draftBusy.value = true;
  try {
    draft.value = await post(auth.base + '/conversations/' + current.value + '/ticket-drafts', { runId });
    draftEdit.value = { ...draft.value.payload };
    confirmKey = crypto.randomUUID();
    pendingVersion = null;
    draftOpen.value = true;
  } catch (e) {
    ElMessage.error((e as Error).message);
    manual.value = true;
  } finally {
    draftBusy.value = false;
  }
}
async function confirm() {
  draftBusy.value = true;
  try {
    if (pendingVersion === null) {
      const updated = await api(auth.base + '/ticket-drafts/' + draft.value.id, {
        method: 'PATCH',
        body: JSON.stringify({ ...draftEdit.value, version: draft.value.version }),
      });
      draft.value = updated;
      pendingVersion = updated.version;
    }
    const t = await post(
      auth.base + '/ticket-drafts/' + draft.value.id + '/confirm',
      { version: pendingVersion },
      { 'Idempotency-Key': confirmKey },
    );
    draft.value.status = 'confirmed';
    draftOpen.value = false;
    ElMessage.success('工单已创建，准备继续跟进');
    await router.push('/tickets/' + t.id);
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    draftBusy.value = false;
  }
}
async function cancelDraft() {
  try {
    await post(auth.base + '/ticket-drafts/' + draft.value.id + '/cancel');
    draftOpen.value = false;
    draft.value = null;
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
onMounted(init);
</script>
<template>
  <div v-if="!auth.canWrite" class="state-panel">
    <Icon name="shield" :size="36" />
    <h2>访客暂不支持 AI 会话</h2>
    <p>你仍可查看工作区的工单和知识库。请使用管理员或客服账号体验 AI 工作台。</p>
    <router-link class="btn" to="/tickets">查看工单</router-link>
  </div>
  <div v-else class="assistant-layout">
    <aside class="conversation-sidebar">
      <div class="conversation-heading">
        <strong>我的会话</strong><span>{{ conversations.length }}</span>
      </div>
      <button class="btn new-chat" :disabled="busy" @click="newChat"><Icon name="plus" />新建会话</button>
      <div class="conversation-list">
        <div class="nav-label">最近会话</div>
        <button
          v-for="c in conversations"
          :key="c.id"
          :disabled="busy"
          :class="{ active: current === c.id }"
          @click="select(c.id)"
        >
          <Icon name="chat" :size="16" />
          <div>
            <span>{{ c.title }}</span
            ><small>{{ date(c.updated_at) }}</small>
          </div>
        </button>
        <p v-if="!conversations.length" class="empty-conversations">
          从一个客户问题开始，<br />让知识帮你找到答案。
        </p>
      </div>
      <div class="private-note"><Icon name="shield" :size="15" /><span>会话仅你自己可见</span></div>
    </aside>
    <section class="chat-main">
      <header class="chat-header">
        <div>
          <Icon name="sparkles" /><strong>{{ currentTitle }}</strong>
        </div>
        <span class="model-label"
          ><span class="online-dot"></span
          >{{ auth.mode === 'mock' ? 'MockAdapter · 模拟模式' : auth.model }}</span
        >
      </header>
      <div ref="scroller" class="message-scroll" @scroll="onScroll">
        <div v-if="!messages.length" class="chat-welcome">
          <div class="welcome-symbol"><Icon name="sparkles" :size="35" /><span>✦</span></div>
          <div class="eyebrow">YOUR SUPPORT COPILOT</div>
          <h1>好答案，从好问题开始</h1>
          <p>粘贴客户的问题，我会查阅知识库，<br />为你整理一份有依据、可追溯的答复。</p>
          <div class="suggestions">
            <button @click="submit('客户无法收到密码重置邮件，该如何排查？')">
              <span class="suggestion-icon amber"><Icon name="user" /></span><strong>客户无法登录账号</strong
              ><span>查找账号与密码重置指南</span><Icon name="upRight" :size="16" /></button
            ><button @click="submit('CSV 数据导入有什么限制？导入失败如何处理？')">
              <span class="suggestion-icon blue"><Icon name="upload" /></span><strong>CSV 数据导入失败</strong
              ><span>了解导入限制与排查步骤</span><Icon name="upRight" :size="16" /></button
            ><button @click="submit('如何升级团队版套餐？升级什么时候生效？')">
              <span class="suggestion-icon purple"><Icon name="sparkles" /></span
              ><strong>了解套餐升级规则</strong><span>查阅订阅与生效时间说明</span
              ><Icon name="upRight" :size="16" />
            </button>
          </div>
          <div class="welcome-features">
            <span><Icon name="book" :size="14" />基于团队知识</span
            ><span><Icon name="file" :size="14" />引用可追溯</span
            ><span><Icon name="ticket" :size="14" />人工确认建单</span>
          </div>
        </div>
        <div v-else class="messages">
          <article v-for="(m, index) in messages" :key="m.id" class="message" :class="m.role">
            <span class="message-avatar" :class="m.role === 'assistant' ? 'ai' : 'human'"
              ><Icon v-if="m.role === 'assistant'" name="sparkles" :size="19" /><span v-else>{{
                auth.user.display_name.slice(0, 1)
              }}</span></span
            >
            <div class="message-body">
              <div class="message-label">
                <strong>{{ m.role === 'assistant' ? 'SupportDesk AI' : auth.user.display_name }}</strong
                ><span v-if="m.role === 'assistant'" class="message-status" :class="m.status">{{
                  statuses[m.status]
                }}</span
                ><span v-if="m.regenerated_from" class="muted">重新生成 · 原记录已保留</span>
              </div>
              <p v-if="m.role === 'user'" class="pre-wrap user-text">{{ m.content }}</p>
              <template v-else
                ><div v-if="!m.content && busy && index === messages.length - 1" class="thinking">
                  <Icon name="loader" :size="15" class="spin" />{{ phase }}，请稍候…
                </div>
                <Markdown :content="m.content" />
                <div v-if="m.sources?.length" class="source-chips">
                  <button v-for="s in m.sources" :key="s.citationId" @click="viewSource(s)">
                    <span>{{ s.label }}</span
                    ><Icon name="file" :size="13" />{{ s.title }}<Icon name="upRight" :size="12" />
                  </button>
                </div>
                <div v-if="!busy" class="message-actions">
                  <button title="复制答复" @click="copy(m)"><Icon name="copy" :size="14" />复制</button
                  ><button @click="submit(messages[index - 1]?.content, m.run_id)">
                    <Icon name="retry" :size="14" />重新生成</button
                  ><button :disabled="draftBusy" @click="makeDraft(m.run_id)">
                    <Icon name="ticket" :size="14" />{{ draftBusy ? '生成草稿中…' : '生成工单草稿' }}
                  </button>
                </div></template
              >
            </div>
          </article>
        </div>
      </div>
      <div class="composer-container">
        <button v-if="!follow" class="back-to-bottom btn" @click="scrollBottom">
          <Icon name="bottom" :size="14" />回到最新
        </button>
        <div v-if="error" class="chat-error" role="alert">
          <Icon name="alert" :size="16" />{{ error
          }}<button class="icon-btn" aria-label="关闭错误提示" @click="error = ''">
            <Icon name="x" :size="14" />
          </button>
        </div>
        <button v-if="draft?.status === 'pending'" class="btn draft-resume" @click="draftOpen = true">
          <Icon name="ticket" :size="15" />继续编辑待确认的工单草稿<Icon name="arrow" :size="15" />
        </button>
        <div class="composer">
          <textarea
            v-model="question"
            :disabled="busy"
            rows="2"
            placeholder="输入或粘贴客户的问题，让 AI 帮你找找答案…"
            aria-label="客户问题"
            @keydown="keydown"
            @compositionstart="composing = true"
            @compositionend="composing = false"
          ></textarea>
          <div class="composer-bottom">
            <span><Icon name="book" :size="14" />已连接工作区知识库</span>
            <div>
              <small>Enter 发送 · Shift + Enter 换行</small
              ><button
                v-if="busy"
                class="send-button stop"
                title="停止生成"
                aria-label="停止生成"
                @click="cancel"
              >
                <Icon name="stop" :size="17" /></button
              ><button
                v-else
                class="send-button"
                :disabled="!question.trim()"
                title="发送问题"
                aria-label="发送问题"
                @click="submit()"
              >
                <Icon name="arrow" :size="19" />
              </button>
            </div>
          </div>
        </div>
        <div class="composer-note">
          <span>AI 可能出错，请核对来源后再向客户发送。</span
          ><select v-if="auth.mode === 'mock'" v-model="scenario" aria-label="模拟场景">
            <option value="normal">模拟：正常回复</option>
            <option value="slow">模拟：慢速回复</option>
            <option value="failure">模拟：生成失败</option>
            <option value="empty">模拟：空输出</option>
            <option value="timeout">模拟：超时</option>
            <option value="long">模拟：超长回复</option>
            <option value="malformed">模拟：异常格式</option>
          </select>
        </div>
      </div>
    </section>
    <el-drawer v-model="sourceOpen" title="引用来源" size="520px"
      ><div v-if="sourceLoading" class="state-panel"><Icon name="loader" class="spin" />正在加载来源…</div>
      <p v-else-if="sourceError" class="error-inline">{{ sourceError }}</p>
      <div v-else-if="source" class="citation-detail">
        <span class="document-status ready"
          >{{ source.historical ? '历史版本' : '当前版本' }} · v{{ source.version_no }}</span
        >
        <h2>{{ source.title }}</h2>
        <p class="muted">{{ source.heading }} · 原文字符 {{ source.start_offset }}–{{ source.end_offset }}</p>
        <div class="citation-quote"><Markdown :content="source.quoted_text" /></div>
        <router-link :to="'/knowledge/' + source.document_id" class="btn" @click="sourceOpen = false"
          >查看完整文档<Icon name="external" :size="15"
        /></router-link></div></el-drawer
    ><el-dialog v-model="draftOpen" title="确认工单草稿" width="650px" :close-on-click-modal="false"
      ><div class="draft-notice">
        <Icon name="sparkles" :size="17" />AI 仅生成草稿，请检查内容并确认后创建工单。
      </div>
      <form class="form-stack" @submit.prevent="confirm">
        <fieldset :disabled="draftBusy || pendingVersion !== null">
          <label>标题<input v-model="draftEdit.title" required minlength="2" maxlength="160" /></label
          ><label
            >问题描述<textarea v-model="draftEdit.description" rows="8" required minlength="2"></textarea>
          </label>
          <div class="form-row">
            <label
              >优先级<select v-model="draftEdit.priority">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select></label
            ><label
              >负责人<select v-model="draftEdit.assignee_id">
                <option :value="null">暂不分配</option>
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.display_name }}</option>
              </select></label
            >
          </div>
        </fieldset>
        <p v-if="pendingVersion !== null" class="dialog-hint">
          内容已保存；若网络中断，重复确认仍只会创建一张工单。
        </p>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn"
            :disabled="draftBusy || pendingVersion !== null"
            @click="cancelDraft"
          >
            放弃草稿</button
          ><button class="btn primary" :disabled="draftBusy">
            <Icon name="check" :size="17" />{{ draftBusy ? '正在提交…' : '确认并创建工单' }}
          </button>
        </div>
      </form></el-dialog
    ><TicketForm v-model="manual" @created="(t: any) => router.push('/tickets/' + t.id)" />
  </div>
</template>
