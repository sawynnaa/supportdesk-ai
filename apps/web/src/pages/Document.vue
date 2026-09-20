<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { useAuth } from '../stores/auth';
import { api, post, date } from '../services/api';
import StatePanel from '../components/StatePanel.vue';
import Icon from '../components/Icon.vue';
import Markdown from '../components/Markdown.vue';
import { ElMessage } from 'element-plus';
const auth = useAuth(),
  route = useRoute();
const doc = ref<any>(null),
  loading = ref(true),
  error = ref(''),
  edit = ref(false),
  body = ref(''),
  busy = ref(false),
  tab = ref('body');
let poll: ReturnType<typeof setInterval>;
async function load(silent = false) {
  if (!silent) loading.value = true;
  error.value = '';
  try {
    doc.value = await api(auth.base + '/documents/' + route.params.id);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function save() {
  busy.value = true;
  try {
    await post(auth.base + '/documents/' + doc.value.id + '/versions', {
      title: doc.value.title,
      body: body.value,
      filename: 'updated.md',
    });
    edit.value = false;
    await load();
    ElMessage.success('新版本正在处理，旧版本继续可用');
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void load();
  poll = setInterval(() => {
    if (doc.value?.versions.some((v: any) => v.status === 'pending')) void load(true);
  }, 2000);
});
onBeforeUnmount(() => clearInterval(poll));
</script>
<template>
  <div class="page document-detail">
    <router-link class="back-link" to="/knowledge"><Icon name="back" :size="16" />返回知识库</router-link
    ><StatePanel :loading="loading" :error="error" @retry="load()" /><template
      v-if="doc && !loading && !error"
      ><div class="page-heading">
        <div>
          <div class="page-eyebrow">KNOWLEDGE DOCUMENT</div>
          <h1>{{ doc.title }}</h1>
          <p>{{ doc.versions.length }} 个版本 · 更新于 {{ date(doc.updated_at) }}</p>
        </div>
        <button
          v-if="auth.isAdmin"
          class="btn primary"
          @click="
            body = doc.versions[0].body;
            edit = true;
          "
        >
          <Icon name="upload" />更新版本
        </button>
      </div>
      <div class="document-detail-layout">
        <section class="panel">
          <div class="list-tabs">
            <button :class="{ active: tab === 'body' }" @click="tab = 'body'">当前版本正文</button
            ><button :class="{ active: tab === 'chunks' }" @click="tab = 'chunks'">
              知识分块<span>{{ doc.chunks.length }}</span>
            </button>
          </div>
          <div class="document-body">
            <Markdown
              v-if="tab === 'body'"
              :content="
                doc.versions.find((v: any) => v.id === doc.active_version_id)?.body ||
                '文档正在处理，暂无已就绪版本。'
              "
            /><template v-else
              ><div v-for="c in doc.chunks" :key="c.id" class="chunk-card">
                <div>
                  <strong>分块 {{ c.chunk_index + 1 }} · {{ c.heading }}</strong
                  ><small>字符 {{ c.start_offset }}–{{ c.end_offset }}</small>
                </div>
                <p class="pre-wrap">{{ c.text }}</p>
              </div></template
            >
          </div>
        </section>
        <aside class="panel version-panel">
          <h3>版本历史</h3>
          <div v-for="v in doc.versions" :key="v.id" class="version-item">
            <div>
              <strong>v{{ v.version_no }}</strong
              ><span class="document-status" :class="v.status">{{
                v.id === doc.active_version_id
                  ? '当前使用'
                  : v.status === 'pending'
                    ? '处理中'
                    : v.status === 'failed'
                      ? '失败'
                      : '历史版本'
              }}</span>
            </div>
            <small>{{ date(v.created_at) }}</small>
            <p v-if="v.error" class="error-inline">{{ v.error }}</p>
            <p v-if="v.embedding_model">{{ v.embedding_model }}<br />{{ v.embedding_dimension }} 维向量</p>
          </div>
          <p class="property-tip">新版本处理成功后自动切换；失败不影响当前可用版本。</p>
        </aside>
      </div></template
    ><el-dialog v-model="edit" title="上传新版本" width="680px"
      ><form class="form-stack" @submit.prevent="save">
        <p class="dialog-hint">新版本处理成功后会自动替换当前检索版本，历史引用仍可溯源。</p>
        <label>完整文档正文<textarea v-model="body" rows="16" required></textarea></label>
        <div class="dialog-actions">
          <button class="btn primary" :disabled="busy">{{ busy ? '正在提交…' : '提交新版本' }}</button>
        </div>
      </form></el-dialog
    >
  </div>
</template>
