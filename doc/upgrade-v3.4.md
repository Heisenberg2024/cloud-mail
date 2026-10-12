# 子邮箱独立登录与多目标推送升级

本版本保留 Vue 3、Element Plus、Hono、Drizzle、D1、KV、R2/S3 技术栈；无需新增环境变量、加密密钥或 Cloudflare Queues。请先阅读本文并在数据库副本上验证，再由管理员部署。开发验证不访问生产 Cloudflare 资源，也不发送真实第三方通知。

## 已完成的功能与入口

- 用户列表 →「全部邮箱与独立登录」：搜索实际邮箱及所属用户；开通独立登录，选择角色和启用状态；管理独立账号的密码、角色、停用状态。所有管理接口后端检查 env.admin 身份。
- 系统设置 →「邮件推送管理」：独立 Telegram、第三方邮箱、Webhook 目标；邮箱/目标多选规则；复制规则、配置有效性提示、实时模拟匹配、最近投递记录。
- 不需要开通的附属邮箱维持原归属。升级后侧栏按新所有者显示，管理员从全部邮箱、用户列表及全部邮件入口继续管理。
- 浏览器 IndexedDB 草稿属于原登录用户的本地数据库，不在 D1 迁移范围，且不会被删除。可在原账号草稿页面复制正文、下载附件，再在新账号重建草稿。

## 数据模型与升级方式

沿用现有 `init/init.js` 增量初始化入口，没有改写历史版本 SQL，也不引入第二套 Wrangler migration 编号体系。

| 变更 | 用途 |
| --- | --- |
| user.session_version | 实时失效旧会话；旧 Token 缺少字段按版本 0 兼容 |
| app_migration | v3.4-schema 与 v3.4 完成标记 |
| mailbox_login_upgrade | account_id 唯一约束、原用户及升级事务凭据 |
| push_destination | 独立目标类型、状态及严格校验 JSON 配置 |
| push_rule | 状态、收件人模式、优先级 |
| push_rule_account | 规则与稳定 account_id 的联合唯一关联 |
| push_rule_recipient | 旧精确地址兼容（含未注册地址） |
| push_rule_destination | 规则与共享目标的联合唯一关联 |
| push_delivery_log | 目标、收件人、状态、尝试次数、简洁错误及时间 |

结构准备与旧配置转换分别使用 [D1 batch 原子事务](https://developers.cloudflare.com/d1/worker-api/d1-database/)。准备结构失败不会留半套结构；旧配置转换失败不会写入半套目标/规则或完成标记。配置修复后可重新执行，不重复迁移。

现有数据库首次 API/收信会准备结构，首次推送路由或管理请求会转换旧配置；原 `/api/init/<jwt_secret>` 也执行相同升级。全新数据库仍须先执行该初始化入口，再注册管理员。既有初始化入口含 JWT Secret，务必使用 HTTPS、避免将地址写入共享终端/代理日志，并沿用原有管理访问限制。

迁移成功后保留旧 setting 字段供审计和代码回退，但冻结旧推送设置写入；收信入口只调用新引擎，没有新旧逻辑同时发送。

## 旧配置兼容

- tgBotToken / tgChatId / tgBotStatus 和发件人、收件人、正文、站点模板选项 → legacy-telegram。
- forwardEmail / forwardStatus → legacy-email；地址规范化去重。
- webhookUrl / webhookSecret / webhookRetry / webhookStatus → legacy-webhook；已有 Authorization 原样保留。未写协议的旧 URL 补 HTTPS；HTTP、私网/字面 IP 等无效配置须先修复。旧重试超过 2 的值迁移时上限为 2，以限制邮件事件运行时间。
- ruleType=ALL → legacy_all，保留 Catch-all 范围，不静默缩为已注册邮箱。
- ruleType=RULE → legacy_selected，保留旧地址列表（含未注册收件人）；旧列表空时匹配为空。该模式按规范化后的完整 Envelope 地址匹配，不自动扩大 +tag 范围。
- 新 selected 模式先精确找 account，再回退 +tag 基础邮箱。显式创建的 +tag 邮箱优先；已删除邮箱、已删除所有者不进入路由。独立登录后 account_id 不变，因此规则保持有效。
- all_registered 包含后来创建的有效邮箱；账户停用仅禁登录，不删除邮件或停止原接收策略。
- 无目标、无规则也不影响正常收信；多个匹配规则叠加，按目标 ID 去重，各目标互相隔离。

旧目标非法时推送管理返回明确迁移错误，收信仍保存并记录路由不可用诊断；不得把该状态当作转发正常。部署前必须在副本中排除此类错误。

## 部署前备份与验证

以下远端命令由部署管理员在确认实际数据库及绑定后执行，本次开发没有执行。备份包含凭据，应存放在私有目录，限制文件权限，不提交 Git。

```sh
cd mail-worker
pnpm exec wrangler d1 export YOUR_DATABASE --remote --output=/private/backup/cloud-mail-before-v34.sql
pnpm exec wrangler d1 time-travel info YOUR_DATABASE
```

记录当前 Time Travel bookmark、Worker 版本及部署配置；妥善备份 KV 的 setting 配置和相关会话键。R2/S3 对象不被本次迁移修改或复制，继续使用原 Key。D1 [导入/导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)与 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)按照实际账户计划和可用保留期执行。

将 D1 导出导入隔离本地数据库，使用本地绑定和测试 JWT Secret运行新代码及初始化。不要将生产 KV/R2绑定到本地开发；数据库副本中的真实推送配置必须先停用或使用网络 Mock，避免转发真实内容。对包含旧配置的副本，检查迁移标记、各目标启用状态、规则范围和模拟匹配结果。自动测试已覆盖新数据库、旧结构、重复执行、并发及中途失败重试。

完成备份和副本验证后：

1. 运行自动测试及两端构建。
2. 保留现有 db/kv/r2/assets/domain/admin/jwt_secret 等生产绑定与 Secret，按原流程部署新 Worker/前端。
3. 立即执行原初始化入口并确认 success；检查 app_migration 的 v3.4-schema 和 v3.4 两个标记。首次使用自动升级与此步骤共用事务，重复执行安全。
4. 用模拟匹配核对 A/B/C 对应的最终目标；确认 legacy_all 等兼容模式符合原范围。
5. 在管理员主动授权后，才点击 Telegram / Webhook 的真实连接测试。保存配置、复制规则和模拟不会发送通知。
6. 选一个子邮箱开通独立登录，记录其 account_id 及邮件数量；升级后确认 ID、收发件、附件 Key、收藏一致；新账号只能访问自己的邮箱。修改密码/角色、停用后旧 Token 都应失效。
7. 检查正常收信和投递日志。第三方邮箱只有实际 Email Routing 事件能执行 message.forward；管理界面不会伪造验证成功。

本次验证：50 项 Vitest 本地 D1/KV 测试通过；前端生产构建、Worker dry-run 打包通过；本地浏览器验证了 A/B 路由模拟、真实邮箱多选、开通提示及 1280px/390px 的布局边界。浏览器发现的翻译键和管理员身份显示问题已修复。

## 本地验证命令

```sh
pnpm --prefix mail-worker install --frozen-lockfile
pnpm --prefix mail-vue install --frozen-lockfile
pnpm --prefix mail-worker test
pnpm --prefix mail-vue build
cd mail-worker
pnpm run build:check
pnpm exec wrangler dev --local --config wrangler-local.toml --persist-to /tmp/cloud-mail-ui-state
```

wrangler-unit.toml 是独立 Worker 测试配置，不需要先构建前端；wrangler-local.toml 用于包含 assets 的本地页面及 dry-run。两份配置中 ID 全为本地模拟值、Secret 为测试专用；不得用于线上部署。`test` 已改为 Vitest 本地测试；原测试环境部署命令改名 `test:deploy`，不会作为测试调用。Workers 测试池沿用锁定版本，其 workerd 最高兼容日期 2025-03-10，低于生产配置 2025-06-04；生产行为仍需部署管理员验收。

## 执行与安全边界

- 沿用既有 Salt + SHA-256 密码机制，不存明文。新独立密码及重置密码须 8–128 位；注册流程沿用原约束。
- 新目标 Token/Secret 仅写入 D1 配置；查询只返回 hasToken/hasSecret，不回显密钥。编辑留空保留；清除必须显式 clearToken/clearSecret。清除 Telegram Token 时须停用目标，重新启用时重新校验。
- 旧设置查询也完整遮蔽 TG/Webhook 密钥与 OAuth Secret，读取脱敏副本，不污染当前请求中的真实配置。
- Telegram 查看链接最长 15 分钟，检查用途、签名、过期、邮件归属及目标启用状态；所有权转移、邮箱或所属用户删除后旧链接失效；旧系统的永久查看链接也会被拒绝，需要正常登录或使用新通知链接。no-store 和 sandbox CSP 禁止邮件脚本执行。
- Webhook 要求公共 HTTPS DNS 域名，拒绝字面 IP/localhost/私网 DNS/重定向，不把响应正文或认证信息写入错误；A/AAAA 通过 Cloudflare DoH 检查。DNS检查与 fetch 之间无法在 Workers 中绑定同一目标 IP，存在 DNS 重绑定的剩余边界，只配置可信域名；需要更严隔离时增加平台级出口策略。
- Cloudflare [目标地址验证](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)须事先完成；本站域名被拒绝以避免循环。目标内部分收件人失败记录 partial，其他目标继续执行。
- 推送在邮件事件内 await，第三方转发保持原始邮件及附件，不依赖无限 waitUntil。Webhook 最多额外重试 2 次、每次 1–5 秒；Telegram 请求 5 秒超时。没有 Queues，因此不存在持久重试/恰好一次投递保证；平台重复投递、超时后对端实际接收可能造成事件间重复。
- 日志 pending 表示尚未完成或事件被中断；成功/失败/部分失败会记录最终状态，保留 30 天，管理员界面展示最近 100 条。日志不存邮件正文、Token、Secret；高流量需监控 D1 容量和清理耗时。
- 第三方网络测试使用 Mock，不验证真实 Bot 权限、Chat ID、Webhook 服务可达性或 Cloudflare 邮件目标验证状态。桌面/移动端通过本地浏览器检查，不属于真机或生产验收。

## 恢复方案

若只是目标配置或迁移校验失败，优先修复配置并重试初始化，不重建邮箱或数据库。旧配置未被删除；不能为了重新生成旧规则而随意删 v3.4 标记，否则会与现有目标冲突。

若必须回退 Worker：先保存当前 D1 快照并记录新产生的邮件、已升级账号和配置。新增表/列向后兼容，旧 Worker 可继续使用旧 setting 推送配置，但密码/停用的实时会话版本防护会随代码回退失效，应同时撤销相关 KV 会话；已转移所有权不会随代码回退自动复原。

整库 Time Travel 会覆盖恢复点之后的业务写入，不能宣称无损。只有在停止写入、保存恢复点后的邮件与账号变更并完成补偿方案后，由管理员执行：

```sh
pnpm exec wrangler d1 time-travel restore YOUR_DATABASE --bookmark=BACKUP_BOOKMARK
```

恢复后核对 account/email/attachments/star 的归属和数量，刷新 KV setting，撤销失效会话；保留原附件对象和 Key。已收新邮件应从恢复前快照按原 ID/归属核实补偿，不能批量删除 R2 或清空数据库。
