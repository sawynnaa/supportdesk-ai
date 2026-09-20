<script setup lang="ts">
import Icon from './Icon.vue';
defineProps<{ loading?: boolean; error?: string; empty?: boolean; title?: string }>();
defineEmits(['retry']);
</script>
<template>
  <div v-if="loading || error || empty" class="state-panel" role="status">
    <Icon :name="loading ? 'loader' : error ? 'alert' : 'inbox'" :size="32" :class="{ spin: loading }" />
    <h3>{{ loading ? '正在加载…' : error ? '暂时无法加载' : title || '这里还没有内容' }}</h3>
    <p v-if="error">{{ error }}</p>
    <p v-else-if="empty">试试调整筛选条件，或者创建第一条记录。</p>
    <button v-if="error" class="btn" @click="$emit('retry')">重新加载</button>
  </div>
</template>
