# 实测优化：Element Plus 样式按需加载

首个生产构建输出 CSS 376.84 kB（gzip 55.24 kB）。页面仅使用 Dialog、Drawer、Message、MessageBox，却引入了全部组件库样式。

将全量 `element-plus/dist/index.css` 替换成这四个组件的 style/css 入口，其他业务页面继续使用项目自己的 CSS。相同环境再次 Vite build 得到 CSS 89.27 kB（gzip 16.64 kB），原始体积减少约 76.3%，gzip 减少约 69.9%。后续文案/样式微调可能造成少量变化。

这只证明构建资源体积下降；没有据此声称首屏渲染提升了相同比例。页面仍通过类型检查和构建，弹窗和抽屉需在浏览器继续验证。
