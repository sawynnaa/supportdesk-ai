// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Markdown from '../../apps/web/src/components/Markdown.vue';
describe('untrusted model output', () => {
  it('removes scripts, javascript links and inline event handlers', () => {
    const wrapper = mount(Markdown, {
      props: {
        content:
          '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a>\n\n[good](https://example.com)',
      },
    });
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('onerror');
    expect(wrapper.html()).not.toContain('javascript:');
    expect(wrapper.find('a[href="https://example.com"]').exists()).toBe(true);
  });
});
