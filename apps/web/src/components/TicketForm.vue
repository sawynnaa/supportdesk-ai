<script setup lang="ts">
import { ref, watch } from 'vue';
import { api, post } from '../services/api';
import { useAuth } from '../stores/auth';
import { ElMessage } from 'element-plus';
import Icon from './Icon.vue';
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits(['update:modelValue', 'created']);
const auth = useAuth();
const title = ref(''),
  description = ref(''),
  priority = ref('medium'),
  assignee = ref(''),
  members = ref<any[]>([]),
  busy = ref(false),
  error = ref('');
let requestKey = crypto.randomUUID();
let submitted = '';
watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      error.value = '';
      requestKey = crypto.randomUUID();
      submitted = '';
      try {
        members.value = (await api(auth.base + '/members')).items.filter((m: any) => m.role !== 'viewer');
      } catch (e) {
        error.value = (e as Error).message;
      }
    }
  },
);
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const payload = {
      title: title.value,
      description: description.value,
      priority: priority.value,
      assignee_id: assignee.value || null,
    };
    const body = JSON.stringify(payload);
    if (submitted && submitted !== body) requestKey = crypto.randomUUID();
    submitted = body;
    const t = await post(auth.base + '/tickets', payload, { 'Idempotency-Key': requestKey });
    ElMessage.success('工单已创建');
    emit('created', t);
    emit('update:modelValue', false);
    title.value = '';
    description.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <el-dialog
    :model-value="modelValue"
    title="创建新工单"
    width="560px"
    :close-on-click-modal="!busy"
    @update:model-value="emit('update:modelValue', $event)"
    ><p class="dialog-hint">记录客户的问题，让每一次反馈都有回应。</p>
    <form class="form-stack" @submit.prevent="submit">
      <label
        >工单标题 <span class="required">*</span
        ><input
          v-model="title"
          required
          minlength="2"
          maxlength="160"
          placeholder="用一句话描述客户遇到的问题" /></label
      ><label
        >问题描述 <span class="required">*</span
        ><textarea
          v-model="description"
          required
          minlength="2"
          rows="6"
          placeholder="补充问题背景、复现步骤和已尝试的解决方法…"
        ></textarea>
      </label>
      <div class="form-row">
        <label
          >优先级<select v-model="priority">
            <option value="low">低优先级</option>
            <option value="medium">中优先级</option>
            <option value="high">高优先级</option>
          </select></label
        ><label
          >负责人<select v-model="assignee">
            <option value="">暂不分配</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.display_name }}</option>
          </select></label
        >
      </div>
      <p v-if="error" class="error-inline">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn" :disabled="busy" @click="emit('update:modelValue', false)">
          取消</button
        ><button class="btn primary" :disabled="busy">
          <Icon :name="busy ? 'loader' : 'plus'" :class="{ spin: busy }" />{{ busy ? '创建中…' : '创建工单' }}
        </button>
      </div>
    </form></el-dialog
  >
</template>
