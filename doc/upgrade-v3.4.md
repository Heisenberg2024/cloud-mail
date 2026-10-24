# 子邮箱独立登录与多目标推送升级

本版本保留 Vue 3、Element Plus、Hono、Drizzle、D1、KV、R2/S3 技术栈；无需新增环境变量、加密密钥或 Cloudflare Queues。请先阅读本文并在数据库副本上验证，再由管理员部署。开发验证不访问生产 Cloudflare 资源，也不发送真实第三方通知。

## 已完成的功能与入口

- 用户列表 →「全部邮箱与独立登录」：搜索实际邮箱及所属用户；开通独立登录，选择角色和启用状态；管理独立账号的密码、角色、停用状态。所有管理接口后端检查 env.admin 身份。
- 系统设置 →「邮件推送管理」：独立 Telegram、第三方邮箱、Webhook 目标；邮箱/目标多选规则；复制规则、配置有效性提示、实时模拟匹配、最近投递记录。
- 不需要开通的附属邮箱维持原归属。管理员侧栏“我的邮箱”按当前归属显示；“全部邮箱”显示所有有效邮箱，包括已升级的独立账号，支持搜索、分页和所属用户管理。
- 浏览器 IndexedDB 草稿属于原登录用户的本地数据库，不在 D1 迁移范围，且不会被删除。可在原账号草稿页面复制正文、下载附件，再在新账号重建草稿。

## 数据模型与升级方式

### 上游 v3.4.0 集成

本地集成上游 `c0009dd`，保留独立邮箱、管理员集中只读查看、多目标推送、投递记录分页/重投及 Telegram 响应式预览。后续 View 对比切换同时保留上游方式，当前默认值见下文。本次集成不执行推送、部署或线上数据库操作。

- `email.sender_email` 保存 SMTP Envelope Sender，`send_email` 继续保存邮件 Header From。新增字段默认空字符串，不改写历史邮件身份或附件对象 Key。
- 新增独立的 `upstream-v3.4` 迁移标记，避免已完成 fork 的 `v3.4-schema`/`v3.4` 升级时漏加字段。首次 API、收信、定时清理及显式初始化共用幂等准备；字段和该标记通过本地 D1 batch 回归验证原子完成、并发和失败回滚/重试。
- 上游分开发信共用保存函数，发件入口仍核对邮箱所有者，写入发件记录及附件时仍读取当前归属；发送中转移邮箱不会把历史写回旧用户。
- 新详情地址为 `/{inbox|starred|sent|all-mail}/messages`；管理员详情继续保留 `accountId` 与只读限制。搜索和 HTML 清理均与现有请求版本隔离并存，最终正文组件额外清理管理员直接详情与持久缓存中的 HTML。
- 沿用上游同源 KV/R2/S3 存储代理。设置刷新后运行配置不再使用独立对象存储域名，D1 原字段仍保留；历史 Key 不移动，回复图片兼容 `attachments/`、`/attachments/`、`/oss/attachments/` 及仍配置的旧存储域名前缀。
- TinyMCE 的 document_base_url 固定为站点根，并关闭 relative_urls；新嵌套详情页刷新或编辑器重建后，图片仍使用根路径，不生成 `../attachments/`。前端回归运行仓库实际 TinyMCE URL 转换代码，而非只检查配置文本。
- 新增上游运行时依赖 DOMPurify；jsdom 仅用于前端真实 DOM 安全回归，不进入生产 Worker。

GitHub 部署工作流仍按原配置监听 `main` 的前后端代码更新。本地集成分支与测试不会触发该流程；未来更新远端 `main` 前必须单独确认发布授权和备份/副本验收。

### 已升级系统的集中邮箱管理修复

这次集中查看修复只更新前端与 Worker 代码，不新增表或迁移，不需要重新执行邮箱升级或独立登录迁移。保持已有 account_id、user_id、历史邮件/附件及转发规则关联，禁止把独立邮箱重新绑定到管理员。

管理员登录 → 侧栏“全部邮箱” → 按地址或所有者搜索/翻页 → 点击邮箱，以管理员只读模式查看收件箱、发件记录、正文及附件。“账户管理”复用现有独立登录管理弹窗，并精确限定所属用户，可改角色、重置密码及启停账户。“全部邮箱”按钮返回列表；普通用户仍只看到自己的邮箱。

- `/account/all` 与 `/mailbox-login/accounts` 共用 `accountService.adminList`，在服务中明确校验管理员身份；返回当前所有者、独立登录、用户启停及邮箱状态。
- `/allEmail/*` 明确校验管理员，不能仅凭角色中的旧全部邮件权限放行。沿用现有 API 响应格式，权限拒绝返回业务 `code: 403`。
- 指定 `accountId` 时，列表、总数、最新邮件和 `/allEmail/detail` 统一按 `email.account_id` 精确筛选，邮箱 ID 非法/不存在不会退回全局查询；收发件视图排除已删除和保存中的邮件。全局全部邮件原有筛选/删除管理仍保留。
- 管理邮箱与管理员自有发件邮箱分开保存，普通 `/email/list`、`/email/latest`、`/email/send` 等仍检查真实登录用户的归属。只读页面不标记已读，不收藏/删除/回复/转发；查看正文及附件只查询历史数据。
- 切换邮箱、搜索和刷新使旧列表请求失效，正文/附件另发带相同 accountId 的详情请求；旧用户缓存不能覆盖管理详情。独立登录升级、角色或启停变更会刷新邮箱状态列表。

本次回归验证：Worker 72 项测试与前端 7 项测试通过；前端生产构建与 Worker dry-run 通过。隔离本地页面确认管理员 A/B 邮箱切换、历史收发件、正文/附件、用户管理入口、邮箱分页和窄屏返回行为；独立用户 A 登录仅看到自己的邮箱和邮件。没有操作线上数据库或部署。

沿用现有 `init/init.js` 增量初始化入口，没有改写历史版本 SQL，也不引入第二套 Wrangler migration 编号体系。

| 变更 | 用途 |
| --- | --- |
| user.session_version | 实时失效旧会话；旧 Token 缺少字段按版本 0 兼容 |
| app_migration | v3.4-schema、v3.4 与 upstream-v3.4 独立完成标记 |
| email.sender_email | 上游 Envelope Sender 字段，旧记录默认空字符串 |
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
3. 立即执行原初始化入口并确认 success；检查 app_migration 的 v3.4-schema、v3.4 和 upstream-v3.4 三个标记及 email.sender_email。首次使用自动升级与此步骤共用事务，重复执行安全。
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
pnpm --prefix mail-vue test
pnpm --prefix mail-vue build
cd mail-worker
pnpm run build:check
pnpm exec wrangler dev --local --config wrangler-local.toml --persist-to /tmp/cloud-mail-ui-state
```

wrangler-unit.toml 是独立 Worker 测试配置，不需要先构建前端；wrangler-local.toml 用于包含 assets 的本地页面及 dry-run。两份配置中 ID 全为本地模拟值、Secret 为测试专用；不得用于线上部署。`test` 已改为 Vitest 本地测试；原测试环境部署命令改名 `test:deploy`，不会作为测试调用。Workers 测试池沿用锁定版本，其 workerd 最高兼容日期 2025-03-10，低于生产配置 2025-06-04；生产行为仍需部署管理员验收。

## Telegram 转发兼容性修复

若升级后所有 Telegram 请求出现 `network/timeout failure`，本地原生 Workers 测试已复现一个代码回归：当前 workerd 拒绝 `redirect: error`，请求在发出前就抛异常；旧测试直接替换 fetch，绕过了运行时参数校验。Telegram、Webhook 和 DoH 请求均已改为 `manual`，收到 3xx 明确失败且不跟随，继续保护 Token / Authorization。新增原生 fetch 的出站拦截回归测试，禁止实际网络连接。重新发布修复后的 Worker，无需重新迁移数据库或修改 Token/Secret。

若通知缺少 `View` 按钮，检查目标的“邮件查看链接”是否开启。目标的“邮件查看站点”留空时会回退原 `setting.customDomain`；新建或编辑目标默认填入当前 HTTPS 站点，已有专用站点和显式关闭的选项保持原值。如果目标和原站点均未配置有效 HTTPS 地址，请在目标中填写实际邮件站点并保存。无有效站点时仍正常发送通知和验证码，不生成无效的查看按钮。

`View` 按每个 Chat ID 生成：正数私聊 ID 使用 Telegram [内嵌 Web App 按钮](https://core.telegram.org/bots/api#inlinekeyboardbutton)，负数群组/超级群组/频道 ID 及 `@频道名` 使用普通 URL 按钮；同一目标可同时包含这些聊天。两种按钮都无需登录，沿用同一邮件/邮箱/用户/目标签名和 15 分钟有效期。修复发布后对新邮件通知生效，已发送的历史消息不会补加按钮；不涉及数据库迁移或 Token/Secret 变更。

若群组投递显示 `Telegram sendMessage failed (HTTP 400)`，但连接测试成功，且开启了“邮件查看链接”，旧代码可能给群组附加了仅支持私聊的 `web_app` 按钮。连接测试只发送纯文本，无法覆盖这个差异；恢复站点回退后，原本没有 View 的群组目标也会触发。修复在每次发送时选择兼容按钮，不增加失败重发，避免重复通知。发布前可临时关闭该群组目标的“邮件查看链接”恢复消息推送；发布后可重新开启，并在投递记录对原失败项手动再次投递（需实际发送授权）。本地原生 Workers 网络拦截已复现旧版 400 并验证修复，覆盖全邮件/指定邮箱双目标、站点回退、混合聊天、签名及查看响应；未发送真实 Telegram 通知。

若 `View` 已打开但 HTML 邮件正文白屏，原模板通过内联 JavaScript 将正文注入 Shadow DOM，而查看接口的 `sandbox` CSP 禁止脚本执行，最终只留下空容器。此前响应式方案改为服务端直接生成 HTML，保留原邮件样式、body 属性、表格和图片，移除脚本/嵌入框架/事件处理属性；纯文本中的 HTML 符号按字面显示。该方案仍完整保留为 `responsive` 模式，继续使用禁止脚本的原 CSP。

### View 两种展示方式与回退

为实际对比效果，当前代码默认使用上游 v3.4.0（`c0009dd`）的 View。上游模板单独保存在 `mail-worker/src/template/upstream/`，仅调整相对 import 路径；现有 `email-html.js`、`email-text.js`、`email-view-style.js` 三个响应式模板均未修改。

可选 Worker 普通变量 `telegram_view_renderer` 控制后续查看请求：

| 变量值 | 展示方式 |
| --- | --- |
| 未设置、空字符串或 `upstream` | 上游原始布局，Shadow DOM + 一次整体 zoom，HTML 默认 14px |
| `responsive` | 现有服务端响应式布局，窄屏重排、局部表格滚动，默认 16px |

若上游效果不合适，在所用 Wrangler 配置的现有 `[vars]` 中加入 `telegram_view_renderer = "responsive"`，或通过现有发布流程设置同名 Worker 变量；设为 `upstream` 可再切回。其他值会明确报配置错误。无需数据库字段、迁移、新 Secret 或前端界面改动；Worker 代码/变量需另行授权发布后才会影响线上。本轮没有发布或修改线上变量。

上游 HTML 响应在保留 sandbox 隔离的同时，仅以当前响应的精确 SHA-256 哈希允许运行模板初始化脚本；不授予同源权限或任意 inline/eval 权限，邮件脚本、事件处理器和 `javascript:` 链接仍不能执行。纯文本及拒绝页继续禁止全部脚本。适配器另外转义纯文本，并在旧存储域名为空时修正附件占位地址；不改变上游布局或缩放代码。

两种模式共用原签名校验、邮箱/用户/目标归属、15 分钟有效期、`no-store` 和 `no-referrer`。使用未过期链接重新打开即可应用当前模式；过期后需新链接，历史通知不会自动补按钮。需要发送通知或再次投递来生成链接时，另行确认实际发送授权。

本次验证：Worker 140 项、前端 19 项测试及 Worker 本地 dry-run 通过；隔离本地浏览器使用真实响应 CSP 确认上游正文 DOM 已渲染并位于视口内、失败图片事件及 `javascript:` 链接均未执行。隐藏标签页的截图捕获为空白，未作为视觉验收证据。1 个只读子智能体独立复核无阻断项。没有使用生产邮件或线上数据库，Telegram 真机效果仍待用户后续实际验收。

### 保留的响应式方案

HTML 与纯文本预览共用小窗口阅读样式：默认 16px 字号与 1.6 行高，在 600px 内使用左右 4px、上下 8px 外层留白，并考虑设备安全区。HTML 邮件的常见固定长度横向 padding/margin（内联样式及可解析样式表）和旧式 cellpadding 同时限制到每层最多 4px，避免多层卡片把正文挤窄；保留纵向间距、auto 居中和发件人移动端媒体规则，按钮及数据表保留原间距。宽度约束、nowrap 和间距通过 CSS 变量回退保留桌面值；图片的内联重要宽高约束也参与适配，窄屏保持图片比例、默认正文不做整体缩小。单列布局表限制宽度，导航等多列表保留列宽关系；固定网格在窄屏改为单列、弹性布局允许换行，长链接/代码和 nowrap 正文可换行。含表头、多列、caption、明确 table/grid 角色及无嵌套的多行多列数据表（含无表头双列账单）保留完整内容，在独立区域横向滚动，presentation/none 布局表保持流式。复杂 calc/var 间距及无法解析的样式表保留原样。

邮件正文与内部滚动区隐藏 Firefox/WebKit 滚动条，保留原生滚动行为，不用裁切正文来掩盖宽度问题。六类合成邮件样例位于 `mail-worker/test/fixtures/telegram-mail-layout.js`，覆盖多层卡片、图片/SVG、双列账单/宽数据表、长链接/代码、Grid/Flex 和纯文本。本地浏览器在 320/390/430px 的 18 组检查中页面宽度均等于视口、默认正文字号均为 16px；实际滚轮确认长邮件/纯文本末尾可达，表格可分别滑到最右端。布局测量仅对本机合成样例保留同源访问以读取尺寸/滚动值，邮件脚本仍禁用；另用原 CSP 检查实际排版，生产 CSP 未修改。

已核对[上游邮件预览模板](https://github.com/maillab/cloud-mail/blob/c0009ddae326197e22c44986b6537ca7d97e803a/mail-worker/src/template/email-html.js)：上游设置移动端 viewport，再用 JavaScript 的父容器宽度 / 正文 scrollWidth 做一次整体 zoom。保留的 `responsive` 模式通过 viewport、媒体查询和服务端样式适配实现窄屏阅读，不依赖该脚本，继续禁止脚本。该方案当时的 Worker 118 项测试通过；前轮已确认 1280px 下边距、卡片宽度和导航列宽与修改前一致。未使用生产邮件，未部署或完成 Telegram 真机验收。

## 投递记录分页与再次投递

- 投递记录按 ID 倒序在服务端分页，默认每页 10 条，可查看保留期内的全部记录。`GET /api/push/logs?page=1&size=10` 返回 `{list,total,page,size}`；size 上限 100，超出末页会回落最后一页。列表包含邮件主题、当前目标名称及不可重投原因。翻页请求失败时恢复最后成功页码，避免页码与旧记录错配。
- `POST /api/push/logs/:id/retry` 仅限管理员，只根据原记录的 email_id / destination_id 读取原邮件及目标当前启用配置，忽略客户端指定的其他邮件或目标，不重新匹配规则。原结果保留，新增一条 pending 记录，并最终写入 success / partial / failed；界面按实际结果提示并刷新当前页。
- 支持 Telegram/Webhook；邮箱转发因未保存原始 MIME、无法重建原收信事件的 forward 能力而不可重投。连接测试、已删除邮件/邮箱/所有者、已删除或停用目标、目标类型及收件人不符时同样拒绝，并在记录旁说明原因。
- 发送前重新校验当前邮件归属、收件人、目标类型及配置。通过 D1 原子条件插入阻止同邮件、同目标在 60 秒内存在另一条 pending 投递；前端同时禁止重复点击。中断超过 60 秒的 pending 可人工再次投递；若上次实际已送达但未写入结果，人工重投仍可能产生重复通知。
- 无表结构或迁移变更，不新增发件服务、Queue 或 Secret。本地测试使用原生 Workers fetchMock，未发送真实通知。

## 执行与安全边界

- 沿用既有 Salt + SHA-256 密码机制，不存明文。新独立密码及重置密码须 8–128 位；注册流程沿用原约束。
- 新目标 Token/Secret 仅写入 D1 配置；查询只返回 hasToken/hasSecret，不回显密钥。编辑留空保留；清除必须显式 clearToken/clearSecret。清除 Telegram Token 时须停用目标，重新启用时重新校验。
- 旧设置查询也完整遮蔽 TG/Webhook 密钥与 OAuth Secret，读取脱敏副本，不污染当前请求中的真实配置。
- Telegram 查看链接最长 15 分钟，检查用途、签名、过期、邮件归属及目标启用状态；所有权转移、邮箱或所属用户删除后旧链接失效；旧系统的永久查看链接也会被拒绝，需要正常登录或使用新通知链接。no-store 和 sandbox CSP 禁止邮件脚本执行。
- Webhook 要求公共 HTTPS DNS 域名，拒绝字面 IP/localhost/私网 DNS/重定向，不把响应正文或认证信息写入错误；A/AAAA 通过 Cloudflare DoH 检查。DNS检查与 fetch 之间无法在 Workers 中绑定同一目标 IP，存在 DNS 重绑定的剩余边界，只配置可信域名；需要更严隔离时增加平台级出口策略。
- Cloudflare [目标地址验证](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)须事先完成；本站域名被拒绝以避免循环。目标内部分收件人失败记录 partial，其他目标继续执行。
- 推送在邮件事件内 await，第三方转发保持原始邮件及附件，不依赖无限 waitUntil。Webhook 最多额外重试 2 次、每次 1–5 秒；Telegram 请求 5 秒超时。没有 Queues，因此不存在持久重试/恰好一次投递保证；平台重复投递、超时后对端实际接收可能造成事件间重复。
- 日志 pending 表示尚未完成或事件被中断；成功/失败/部分失败会记录最终状态，保留 30 天，管理员界面默认每页展示 10 条。日志不存邮件正文、Token、Secret；高流量需监控 D1 容量和清理耗时。
- 第三方网络测试使用 Mock，不验证真实 Bot 权限、Chat ID、Webhook 服务可达性或 Cloudflare 邮件目标验证状态。桌面/移动端通过本地浏览器检查，不属于真机或生产验收。

## 恢复方案

若只是目标配置或迁移校验失败，优先修复配置并重试初始化，不重建邮箱或数据库。旧配置未被删除；不能为了重新生成旧规则而随意删 v3.4 标记，否则会与现有目标冲突。

若必须回退 Worker：先保存当前 D1 快照并记录新产生的邮件、已升级账号和配置。新增表/列向后兼容，旧 Worker 可继续使用旧 setting 推送配置，但密码/停用的实时会话版本防护会随代码回退失效，应同时撤销相关 KV 会话；已转移所有权不会随代码回退自动复原。

整库 Time Travel 会覆盖恢复点之后的业务写入，不能宣称无损。只有在停止写入、保存恢复点后的邮件与账号变更并完成补偿方案后，由管理员执行：

```sh
pnpm exec wrangler d1 time-travel restore YOUR_DATABASE --bookmark=BACKUP_BOOKMARK
```

恢复后核对 account/email/attachments/star 的归属和数量，刷新 KV setting，撤销失效会话；保留原附件对象和 Key。已收新邮件应从恢复前快照按原 ID/归属核实补偿，不能批量删除 R2 或清空数据库。
