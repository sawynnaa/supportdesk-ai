# 真实修复：内存测试库没有加载 vector

首次 Vitest 集成测试失败于 `extension "vector" is not available`，同一代码的文件持久化模式却能启动。

原因是 `new PGlite(undefined, { extensions: { vector } })` 在无 dataDir 时没有按预期使用第二个参数，测试环境恰好使用内存库。修改为单一 options 对象 `new PGlite({ dataDir, extensions: { vector } })`，让内存和文件模式采用相同配置路径。

修复后完整建表、12 份文档的向量化与向量检索测试执行通过。随后测试 HTTP 监听又遇到本地沙箱限制，授权本机临时端口后才得到了真正的集成测试结果；没有把跳过的测试计为通过。
