<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { api, post, date } from '../services/api';
import Icon from '../components/Icon.vue';
import StatePanel from '../components/StatePanel.vue';
import { ElMessage, ElMessageBox } from 'element-plus';
const auth = useAuth(),
  router = useRouter(),
  items = ref<any[]>([]),
  search = ref(''),
  loading = ref(true),
  error = ref(''),
  upload = ref(false),
  busy = ref(false),
  title = ref(''),
  body = ref(''),
  filename = ref('notes.md'),
  uploadError = ref('');
let timer: ReturnType<typeof setInterval>;
let alive = true;
const filtered = computed(() =>
  items.value.filter((d) => d.title.toLowerCase().includes(search.value.toLowerCase())),
);
const ready = computed(() => items.value.filter((d) => d.active_version_id).length);
async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    const d = await api(auth.base + '/documents');
    if (alive) {
      items.value = d.items;
      error.value = '';
    }
  } catch (e) {
    if (alive) error.value = (e as Error).message;
  } finally {
    if (alive) loading.value = false;
  }
}
async function fileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 1048576 || !/\.(md|txt)$/i.test(file.name)) {
    uploadError.value = '仅支持不超过 1 MB 的 Markdown / TXT 文件';
    return;
  }
  try {
    body.value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    title.value = file.name.replace(/\.[^.]+$/, '');
    filename.value = file.name;
    uploadError.value = '';
  } catch {
    uploadError.value = '请上传有效的 UTF-8 文本';
  }
}
async function submit() {
  busy.value = true;
  uploadError.value = '';
  try {
    await post(auth.base + '/documents', { title: title.value, body: body.value, filename: filename.value });
    upload.value = false;
    title.value = '';
    body.value = '';
    await load();
    ElMessage.success('文档已加入处理队列');
  } catch (e) {
    uploadError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function remove(d: any) {
  try {
    await ElMessageBox.confirm(
      `删除「${d.title}」后将立即停止用于新回答，历史引用入口也将不可查看。`,
      '删除文档',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    );
    await api(auth.base + '/documents/' + d.id, { method: 'DELETE' });
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function retry(d: any) {
  try {
    await post(auth.base + '/documents/' + d.id + '/retry');
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (items.value.some((d) => d.status === 'pending')) void load(true);
  }, 2000);
});
onBeforeUnmount(() => {
  alive = false;
  clearInterval(timer);
});
</script>
<template>
  <div class="page knowledge-page">
    <div class="page-heading">
      <div>
        <div class="page-eyebrow">TEAM KNOWLEDGE</div>
        <h1>
          知识库<span class="heading-count">{{ items.length }}</span>
        </h1>
        <p>汇聚团队知识，让每个答案都有可靠的依据。</p>
      </div>
      <button v-if="auth.isAdmin" class="btn primary" @click="upload = true">
        <Icon name="upload" />上传文档
      </button>
    </div>
    <div class="knowledge-banner">
      <div class="knowledge-banner-icon"><Icon name="book" :size="27" /></div>
      <div>
        <h3>让知识，成为每一次回应的底气</h3>
        <p>
          已就绪的 {{ ready }} 份文档会用于 AI 检索。上传 Markdown 或 TXT 文件，系统将自动解析并建立索引。
        </p>
      </div>
      <span class="knowledge-safe"><Icon name="shield" :size="15" />仅当前工作区可见</span>
    </div>
    <div class="knowledge-toolbar">
      <div class="section-title">
        全部文档 <span>{{ items.length }}</span>
      </div>
      <div class="search-input">
        <Icon name="search" :size="17" /><input v-model="search" placeholder="搜索知识文档…" />
      </div>
    </div>
    <StatePanel :loading="loading" :error="error" :empty="!filtered.length" @retry="load()" />
    <div v-if="!loading && !error" class="document-grid">
      <article v-for="d in filtered" :key="d.id" class="document-card">
        <div class="document-card-top">
          <span class="file-icon"><Icon name="file" :size="24" /></span
          ><span class="document-status" :class="d.status"
            ><span class="tiny-dot"></span
            >{{ d.status === 'ready' ? '已就绪' : d.status === 'failed' ? '处理失败' : '处理中' }}</span
          >
        </div>
        <router-link :to="'/knowledge/' + d.id" class="document-title">{{ d.title }}</router-link>
        <p>
          {{ d.chunks || 0 }} 个知识分块 <span>·</span> {{ Math.ceil((d.size || 0) / 1024) || 1 }} KB
          <span>·</span> v{{ d.version_no }}
        </p>
        <p v-if="d.error" class="error-inline">{{ d.error }}</p>
        <div class="document-card-bottom">
          <span>更新于 {{ date(d.updated_at) }}</span>
          <div>
            <button
              v-if="auth.isAdmin && d.status === 'failed'"
              class="icon-btn"
              title="重试处理"
              @click="retry(d)"
            >
              <Icon name="retry" :size="16" /></button
            ><button v-if="auth.isAdmin" class="icon-btn" title="删除文档" @click="remove(d)">
              <Icon name="trash" :size="16" /></button
            ><button class="icon-btn" title="查看文档" @click="router.push('/knowledge/' + d.id)">
              <Icon name="upRight" :size="17" />
            </button>
          </div>
        </div>
      </article>
    </div>
    <el-dialog v-model="upload" title="添加知识文档" width="620px"
      ><form class="form-stack" @submit.prevent="submit">
        <label class="upload-zone"
          ><Icon name="upload" :size="28" /><strong>选择文档，或直接在下方粘贴内容</strong
          ><span>UTF-8 编码 · Markdown / TXT · 最大 1 MB</span
          ><input type="file" accept=".md,.txt" @change="fileChange" /></label
        ><label
          >文档标题<input
            v-model="title"
            required
            maxlength="160"
            placeholder="例如：CSV 数据导入指南" /></label
        ><label
          >文档内容<textarea
            v-model="body"
            rows="8"
            required
            placeholder="# 文档标题&#10;&#10;输入知识正文…"
          ></textarea>
        </label>
        <p v-if="uploadError" class="error-inline">{{ uploadError }}</p>
        <div class="dialog-actions">
          <button type="button" class="btn" @click="upload = false">取消</button
          ><button class="btn primary" :disabled="busy">{{ busy ? '正在上传…' : '上传并处理' }}</button>
        </div>
      </form></el-dialog
    >
  </div>
</template>
