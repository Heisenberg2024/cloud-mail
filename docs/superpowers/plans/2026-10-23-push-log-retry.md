# 投递记录分页与再次投递 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans；本任务由主代理实现，不执行 Git 提交。用户后续明确授权 1 个只读子代理做独立复核。

**Goal:** 投递记录默认每页 10 条，允许管理员将 Telegram/Webhook 记录对应的邮件再次投递给原目标。

**Architecture:** GET /push/logs 返回服务端分页结果；POST /push/logs/:id/retry 仅从日志读取邮件与目标 ID，不接受客户端覆盖，不重新匹配规则。重投新增独立结果记录，以 D1 原子条件插入阻止同邮件、同目标并发投递。

**Tech Stack:** 现有 Vue 3、Element Plus、Hono、D1、Vitest，无新增依赖或数据库迁移。

**Spec:** 用户本轮要求及已确认范围：邮箱记录不重投，显示原因；Telegram/Webhook 取原目标当前启用配置。历史投递结果保留。

## Global Constraints

- requireAdmin；保留所有权、密钥脱敏、Webhook 出站安全、Telegram 查看链接权限约束。
- 不访问生产、不部署、不发送真实消息；测试使用本地 D1/KV 及原生 fetchMock。
- 连接测试、已删除邮件或邮箱、已删除或停用目标、类型不符及收件人不符均不可重投。
- pending 有效期按 60 秒判断，避免永久阻塞被中断的旧记录。

## Review Focus

- 页码越界或清理导致末页变化：后端回落有效页，前端忽略迟到响应。
- 同一邮箱多目标或规则变化：只投原记录 target，不重新 resolve。
- 客户端篡改邮件/目标 ID：请求体不能覆盖服务端关联。
- 连续点击或并发请求：界面禁用重复操作，后端原子占用。
- 目标失效、原邮件删除或连接测试：清晰说明原因，无网络副作用。

### Task 1: 后端分页与重投

**Files:** `mail-worker/src/service/push-service.js`、`push-router-service.js`、`src/api/push-api.js`、`test/index.spec.js`。

**Interfaces:** `logs(c,{page,size}) -> {list,total,page,size}`；`retry(c,id) -> {logId,status,attempts,error}`；列表提供 `retry_reason` 供界面禁用与提示。

- [x] 写分页、边界、原邮件/目标准确性、原记录保留、并发及权限失败测试并确认失败。
- [x] 实现参数校验、10 条默认分页、记录关联校验、原子 pending 记录和现有 deliver 复用。
- [x] 运行 `pnpm --prefix mail-worker test`，98 项测试通过。

### Task 2: 前端交互与文档

**Files:** `mail-vue/src/components/push-manager/index.vue`、`src/request/push.js`、`src/i18n/{zh,en}.js`、`test/mailbox-view.test.mjs`、`doc/upgrade-v3.4.md`、`PROJECT_MEMORY.md`。

- [x] 写每页 10 条、翻页请求竞态、按记录 ID 重投、重复点击及失败恢复测试并确认失败。
- [x] 增加页码按钮、加载态、重投按钮及不可重投原因；结果按实际状态提示并刷新当前页。
- [x] 运行 `pnpm --prefix mail-vue test`（16 项）和 Vue SFC 编译检查，更新文档与项目记忆。
- [x] 检查整个工作区差异，提供中文 Conventional Commit，不暂存、提交或推送。

## 执行记录

- 原分页测试先复现旧接口一次返回 100 条；重投接口与前端行为测试先失败后通过。
- 接口完整回归额外复现收件人在查验后变化的竞态，补充发送前核对并通过。
- 既有只读快照曾因比较 D1 meta.duration 偶发失败；改为仍比较全部业务表、全部行和字段，排除执行耗时元数据。
- 1 个用户授权的只读子代理审核发现唯一 P2：翻页失败时新页码仍展示旧记录。新增测试复现并修复为恢复最后成功页码；前端完整 16 项通过。后端未发现实质问题，98 项完整测试仍有效。
- 验证证据：`/tmp/cloud-mail-worker-final-tests.log`、`/tmp/cloud-mail-vue-final-tests.log`。Vue SFC 编译与 `git diff --check` 通过；无构建、部署或真实通知。Token 与响应统计未提供。
