<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
const props = defineProps<{ content: string }>();
const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.content, { async: false }) as string, {
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'img'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  }),
);
</script>
<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown" v-html="html"></div>
</template>
