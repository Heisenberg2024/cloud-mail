# 上游 v3.4.0 本地集成计划

> 执行方式：主代理按 executing-plans 在当前本地集成分支实现；用户后续明确授权 1 个只读子智能体独立复核。

**目标：** 合入 maillab/cloud-mail 的 c0009dd，保留当前 2d0c80b 的全部定制并完成隔离测试。
**架构：** 沿用 Vue/Pinia 与 Hono/Drizzle/Workers；上游发信、搜索、附件代理与 HTML 清理接入现有所有权、会话、只读管理和推送边界。
**约束：** 不推送、部署、操作线上数据库或发送真实邮件/通知；仅按用户明确授权提交并合入本地 main；保留上游合并来源和现有定制历史。

## 验收与步骤
- [x] 运行 Worker/前端基线测试，创建 codex/integrate-upstream-v3.4.0。
- [x] 合并上游并解决六个文件冲突：store/email、all-email、content、init、email-service、setting-service；同时检查自动合并的相邻路径。
- [x] 回归验证 sender_email 幂等升级与老库升级、独立邮箱转移时的发信归属、管理员只读详情/新路由、搜索与 XSS 清理、多目标推送及 Telegram 静态预览。
- [x] 运行 Worker/前端全部离线测试、Vue 编译构建与 Worker 本地 dry-run；只使用 wrangler-unit/local.toml。
- [x] 审查相对 HEAD 的全部有效差异，更新 PROJECT_MEMORY.md 和升级文档，给出中文 Conventional Commit 说明及独立审核结果。

## 重点边界
- 上游 sender_email 与 fork 的 app_migration / session_version / push_* 迁移必须同时有效；旧完成标记不能阻止新字段补齐。
- 新的 sendInternal/sendCloudflare/sendResend/saveSentEmail 必须保留发件账号所有权校验和写入时实时归属。
- 管理详情必须保留 accountId、all-mail 路由参数、只读操作和请求版本隔离。
- 上游 DOMPurify 应覆盖正常详情和管理员独立详情，不能恢复 Telegram 中被 CSP 禁止的脚本初始化。
- 系统设置继续保留密钥脱敏和旧推送设置写保护，使用同源存储代理时保留历史对象 Key。

## 验证记录
- 基线：Worker 118 项、前端 16 项通过；最终 Worker 134 项、前端 19 项通过。
- 复现后修复：发信中邮箱转移时新保存函数写回旧用户；旧 fork 完成标记导致漏 sender_email；管理员详情绕过列表缓存的 HTML 清理；根路径附件未转回 CID。
- 独立复核新增发现：新嵌套路由让真实 TinyMCE 把附件转成 ../attachments；新增真实转换回归先失败后通过，固定站点根 base 与 relative_urls=false。
- 前端构建、Worker 本地 dry-run 通过，最后编辑器修复后已重新构建前端并复核 Worker 打包。
- 隔离页面已验证管理员 A/B 邮箱、只读详情/新路由、正文危险属性移除、高级搜索/高亮，以及独立用户仅看到自己的邮箱；显式初始化重复执行 success。服务及临时标签已关闭。
- 日志：`/tmp/cloud-mail-integration-{worker-final,vue-final,vue-build,worker-build,tinymce-red}.log`。截图：`/tmp/cloud-mail-integration-search.png`。
- 首次交付时保留未提交合并结果，MERGE_HEAD=c0009dd，main 与 origin/main 为 2d0c80b；用户随后明确授权完成本地提交并合入 main，禁止推送/部署或线上数据库操作。PROJECT_MEMORY.md 为既有忽略文件，仅更新本地事实。
- 独立复核：Critical 0、未解决 Important 0、Minor 0；唯一 Important 为上述 TinyMCE 图片路径，已修复。独立串联真实编辑器与附件转换函数，9 个组合均恢复 CID，证据 `/tmp/review-attachment-relative-{before,after}.json`。
- 执行约 23 分钟，包含依赖安装、构建、浏览器与并行审核等待。主代理实现、1 个只读代理独立复核；Token/缓存/响应计数未提供，未额外采集。首次 pnpm 因无 TTY 中止后通过 CI=true 重试；没有构建失败。

## 建议提交说明
```text
chore(sync): 集成上游 v3.4.0 并保留邮箱与推送定制

- 合入高级搜索、分开发信、统一存储代理、HTML 清理、邀请码与 Resend 修复，同步界面、文案及演示资源。
- 保留独立邮箱、管理员只读、多目标推送及 Telegram 静态预览，修复增量迁移、实时发件归属和回复图片路径兼容。
- 新增隔离 D1/KV、真实 DOM 和 TinyMCE 回归；Worker 134 项、前端 19 项、前端构建及 Worker 本地 dry-run 通过。
- 本地页面验证管理员邮箱切换、只读详情、搜索高亮及独立用户隔离；未推送、部署或访问线上数据库。
```
