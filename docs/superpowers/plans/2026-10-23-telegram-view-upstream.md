# Telegram View 上游方案对比

## 已确认范围
按用户要求同时保留上游原始展示方式和当前响应式方式，暂时默认使用上游。现有 email-html/email-text/email-view-style 三个模板不改动；不推送、部署、提交或操作线上数据库，不发送真实通知。

## 实现选择
- 原样保留集成版本上游 c0009dd 的 HTML/纯文本模板，单独放入 template/upstream/；适配器只处理资源地址及纯文本转义，不改变上游布局/缩放代码。
- 可选 Worker 变量 telegram_view_renderer：默认 upstream；responsive 调用当前模板。现有签名目的、邮箱/用户/目标绑定、15 分钟有效期和无缓存响应保留。
- 上游 HTML 仅通过当前响应的 SHA-256 CSP 哈希允许运行模板初始化脚本；sandbox 仍不授予同源权限，不允许任意 inline/eval 或邮件事件处理器。现有响应式方案继续禁止全部脚本。
- 不增加管理界面或数据库字段；回退只需将变量设为 responsive。

## 验证步骤
- [x] 先补默认上游/显式回退、脚本策略、资源路径、纯文本转义及权限回归，观察切换前两项失败。
- [x] 加入模板和适配器，路由按所选方案使用相应 CSP；当前模板及原回归保持有效。
- [x] 运行 Worker/前端离线测试与 Worker 本地 dry-run；隔离浏览器实际执行上游脚本检查正文，并以独立离线探针检查 Shadow DOM/缩放。
- [x] 用户授权 1 个只读子智能体独立复核安全边界，更新 PROJECT_MEMORY.md 与升级说明，核对完整差异并提供提交说明。

## 记录
实现与本地验收完成。Worker 140 项、前端 19 项测试及 Worker 本地 dry-run 通过；当前三个模板与 HEAD 字节一致，上游模板与固定提交一致（仅 import 路径不同）。独立复核无发现或阻断项。

证据：`/tmp/cloud-mail-view-mode-worker-final.log`、`/tmp/cloud-mail-view-mode-vue.log`、`/tmp/cloud-mail-view-mode-build.log`；浏览器实际 CSP 下的正文和脚本隔离结果位于 `/tmp/cloud-mail-view-mode-browser.json`，正文 DOM 几何及可见性属性位于 `/tmp/cloud-mail-view-mode-browser-geometry.json`。隔离浏览器确认上游正文 DOM 已渲染并位于视口内，失败图片事件和 javascript: 链接未执行。隐藏标签页截图捕获为空白，不能作为视觉证据；截图接口不提供另一种页面截图方法，未据此宣称视觉验收。离线探针另覆盖恶意闭合标签、引号、Unicode、缩放比例及资源/文本保真。

未提交、推送、部署、发送真实通知或操作线上数据库，临时服务和标签已关闭。Telegram 真机效果由用户在单独授权部署后验收。约 18 分钟，1 个只读子智能体；响应/Token 统计未提供，未新增采集。最后约 3 分钟用于核实空白截图与实际 DOM 的差异，无源码返工。
