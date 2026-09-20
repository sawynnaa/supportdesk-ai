<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from './stores/auth';
import Icon from './components/Icon.vue';
const auth = useAuth(),
  route = useRoute(),
  router = useRouter();
const sidebar = ref(false),
  help = ref(false);
const page = computed(() =>
  route.path.startsWith('/tickets')
    ? '工单管理'
    : route.path.startsWith('/assistant')
      ? 'AI 工作台'
      : '知识库',
);
async function logout() {
  await auth.logout();
  await router.push('/login');
}
function switchSpace(e: Event) {
  auth.switchWorkspace((e.target as HTMLSelectElement).value);
  void router.push('/tickets');
}
</script>
<template>
  <router-view v-if="route.path === '/login'" />
  <div v-else class="app-shell">
    <aside class="sidebar" :class="{ visible: sidebar }">
      <a class="brand" href="/tickets"
        ><span class="brand-icon"><Icon name="chat" :size="23" /></span
        ><span>SupportDesk<span class="brand-ai">AI</span></span></a
      >
      <div class="workspace-select">
        <span class="workspace-avatar">F</span>
        <div>
          <small>当前工作区</small
          ><select aria-label="切换工作区" :value="auth.workspaceId" @change="switchSpace">
            <option v-for="w in auth.workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
      </div>
      <div class="nav-label">工作空间</div>
      <nav>
        <router-link
          to="/tickets"
          :class="{ active: route.path.startsWith('/tickets') }"
          @click="sidebar = false"
          ><Icon name="ticket" />工单管理</router-link
        ><router-link
          to="/assistant"
          :class="{ active: route.path.startsWith('/assistant') }"
          @click="sidebar = false"
          ><Icon name="sparkles" />AI 工作台<span class="nav-badge">AI</span></router-link
        ><router-link
          to="/knowledge"
          :class="{ active: route.path.startsWith('/knowledge') }"
          @click="sidebar = false"
          ><Icon name="book" />知识库</router-link
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="ai-tip">
          <span class="tip-icon"><Icon name="sparkles" /></span><strong>让好服务，更进一步</strong>
          <p>让 AI 帮你查找答案，<br />把时间留给真正重要的事。</p>
          <router-link to="/assistant">试试 AI 工作台 <Icon name="arrow" :size="15" /></router-link>
        </div>
        <button class="help-link" @click="help = true">
          <Icon name="help" />使用指南<Icon name="upRight" :size="14" />
        </button>
        <div class="profile">
          <span class="avatar violet">{{ auth.user?.display_name?.slice(0, 1) }}</span>
          <div>
            <strong>{{ auth.user?.display_name }}</strong
            ><small>{{
              auth.workspace?.role === 'admin'
                ? '工作区管理员'
                : auth.workspace?.role === 'agent'
                  ? '客服成员'
                  : '只读访客'
            }}</small>
          </div>
          <button class="icon-btn" title="退出登录" @click="logout"><Icon name="logout" :size="17" /></button>
        </div>
      </div>
    </aside>
    <div v-if="sidebar" class="sidebar-scrim" @click="sidebar = false"></div>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <button class="icon-btn mobile-menu" aria-label="展开导航" @click="sidebar = !sidebar">
            <Icon name="panel" /></button
          ><span>工作空间</span><Icon name="right" :size="13" /><strong>{{ page }}</strong>
        </div>
        <div class="top-actions">
          <span class="mode-pill"
            ><span class="dot"></span>{{ auth.mode === 'mock' ? '模拟模式' : '真实模型' }}</span
          ><span class="top-divider"></span
          ><button class="icon-btn" title="使用说明" @click="help = true"><Icon name="help" /></button
          ><span class="avatar small violet">{{ auth.user?.display_name?.slice(0, 1) }}</span>
        </div>
      </header>
      <main :key="auth.workspaceId" class="main-content"><router-view /></main>
      <footer class="app-footer">
        <span><span class="online-dot"></span>系统运行正常</span
        ><span>SupportDesk AI <span class="footer-dot">·</span> 每一个问题，都值得被认真对待</span>
      </footer>
    </div>
    <el-dialog v-model="help" title="欢迎使用 SupportDesk AI" width="560px"
      ><div class="guide">
        <p>这是为 FlowSpace 虚构产品打造的内部客服工作台，所有初始数据均为演示数据。</p>
        <ol>
          <li>在 AI 工作台粘贴客户问题，获取带引用的答复。</li>
          <li>点击来源核对知识库内容，复制答复给客户。</li>
          <li>需要跟进时，生成并人工确认工单草稿。</li>
          <li>在工单管理中分配负责人、记录备注并推进状态。</li>
        </ol>
        <p>模拟模式无需密钥，不向客户自动发消息。私人会话仅本人可见。</p>
      </div></el-dialog
    >
  </div>
</template>
