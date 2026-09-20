<script setup lang="ts">
import { ref } from 'vue';
import { useAuth } from '../stores/auth';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
const auth = useAuth(),
  router = useRouter();
const email = ref('admin@demo.com'),
  password = ref('Demo123456!'),
  busy = ref(false),
  error = ref('');
async function login() {
  busy.value = true;
  error.value = '';
  try {
    await auth.login(email.value, password.value);
    await router.push('/tickets');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="login-page">
    <section class="login-brand">
      <div class="brand light">
        <span class="brand-icon"><Icon name="chat" :size="26" /></span><span>SupportDesk AI</span>
      </div>
      <div class="login-headline">
        <div class="eyebrow">BETTER SUPPORT, TOGETHER</div>
        <h1>让每一个问题，<br />都有温暖的回应。</h1>
        <p>知识连接答案，AI 协助思考。<br />为专注客户体验的团队，打造更从容的工作方式。</p>
        <div class="login-art">
          <div class="art-card">
            <span class="avatar mint"><Icon name="check" /></span>
            <div><strong>问题已解决</strong><small>好的服务，从了解开始</small></div>
            <span class="art-spark">✦</span>
          </div>
          <div class="art-card second">
            <span class="avatar violet"><Icon name="sparkles" /></span>
            <div><strong>答案，有据可依</strong><small>让知识成为团队的力量</small></div>
          </div>
        </div>
      </div>
      <div class="login-caption">专为小型软件团队设计的客服与工单工作台</div>
    </section>
    <section class="login-form-side">
      <div class="login-form">
        <div class="login-icon"><Icon name="chat" :size="28" /></div>
        <h2>欢迎回来</h2>
        <p>登录你的工作区，开始今天的客户支持。</p>
        <form class="form-stack" @submit.prevent="login">
          <label
            >邮箱地址<input
              v-model="email"
              type="email"
              autocomplete="username"
              required
              placeholder="name@company.com" /></label
          ><label
            >密码<input
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              minlength="1"
          /></label>
          <div v-if="error" class="error-inline" role="alert">{{ error }}</div>
          <button class="btn primary login-submit" :disabled="busy">
            {{ busy ? '正在登录…' : '登录工作区' }}<Icon name="arrow" />
          </button>
        </form>
        <div class="demo-accounts">
          <div><Icon name="info" :size="15" /><strong>演示账号 · 虚构数据</strong></div>
          <p>默认密码：Demo123456!</p>
          <div class="demo-buttons">
            <button type="button" @click="email = 'admin@demo.com'">管理员</button
            ><button type="button" @click="email = 'agent@demo.com'">客服</button
            ><button type="button" @click="email = 'viewer@demo.com'">只读访客</button>
          </div>
        </div>
        <p class="login-privacy"><Icon name="shield" :size="14" /> 会话安全隔离 · AI 回复需人工核对</p>
      </div>
    </section>
  </div>
</template>
