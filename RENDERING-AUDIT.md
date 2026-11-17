# Pi 特性与渲染调查

## 基线与结论

- npm `latest` 与 GitHub 最新正式 Release 均为 **Pi 1.5.2**，GitHub 发布日期为 **2026-11-10**。没有把主分支或第三方包的功能当作已发布 API。
- 对照本机/开发安装的 Pi 源码、官方文档与 changelog，并搜索上游 issue 和社区渲染包。
- 本轮是显示层修复：不替换工具执行，不改模型参数、会话里的原始命令、thinking 或结果。
- 保留之前 issue #4 的编辑器协调修复；没有提交、推送或发版。

## 这次确认并修复的问题

| 问题 | 根因与处理 | 主要文件 |
|---|---|---|
| Thought trail 树枝跑到行尾，续行无树枝 | 给原始 Markdown 预换行之后，Pi 再解析；跨行反引号把我们插入的换行和树枝合并成一个 code span。每个已排版的行现在独立封装为字面文本，硬换行放在封装外。 | `extensions/zentui/thinking-trail.ts` |
| thinking 可透传终端控制字符 | 宽度计算忽略 ANSI 不等于安全过滤。排版前复用现有 sanitizer，过滤 OSC、清屏、C0/C1 和 bidi 覆盖字符。 | 同上、`extension-status.ts` |
| 极窄宽度、裁剪后的标题异常 | 原实现把宽度 ≤5 改回 100；宽字符也可能超出剩余一格。过窄时退回原生 thinking；标题按实际列宽裁剪，避免把裁剪工具插入的 ANSI 再拆开做渐变。 | 同上 |
| Bash 仍显示 `$` 且整行浅蓝 | 这是 Pi 原生 `renderCall` 和 `toolTitle` 的行为。使用公开 `registerToolRenderer` 仅装饰命令头，改为 `❯`，复用 `highlightCode` 的 Shell 语法。 | `extensions/zentui/shell-call.ts` |
| 长命令占屏、续行层级不清 | 加悬挂缩进、五个视觉行的折叠预览及单行展开提示；展开后显示完整命令。原始脚本的物理换行保留，不为了美观改写 Shell 语法。 | 同上 |
| 长命令重绘开销大 | 复核时 20 万字符单行的重复渲染约 309–449ms；增加内容/主题/宽度/展开态/timeout/按键提示缓存，复核相同输入重绘低于 0.1ms。首次高亮仍有成本。 | 同上 |
| 状态颜色不跟随主题 | 工具卡原来接收 theme getter 却不用，状态轨道全为固定 RGB。1.5.0 让状态文字和轨道使用 `toolTitle` / `success` / `error`。1.5.1 按视觉要求改为整行标题（含边框、状态字和 diff 计数）一次计算 Sakura 渐变，避免短边框重启渐变变蓝；语义主题色仅保留在轨道，仍进入缓存键。 | `tool-execution.ts` |
| 无边框编辑器丢首尾行 | 原回退分支无条件 `slice(1, -1)`。只剥离有标记证据的边框；纯文本水平线也保留，不能靠长得像边框就删除。 | `ui.ts` |
| 编辑器点击位置、补全命中错位 | 显示层增加轨道、空行和元数据，却未映射鼠标坐标。保存逐行映射，分别转换正文/补全位置，忽略 chrome。 | 同上 |
| 包装后的编辑器失去分页/拖拽结束事件 | 转发 `capturesViewportInput`，并保存捕获手势的坐标变换，使拖拽/释放落在边框外时仍送达内部编辑器。没有依赖未从公共入口导出的鼠标 dispatcher。 | 同上 |
| `NO_COLOR` 漏色 | 共享 theme 颜色辅助函数和由宿主着色的展开提示可能绕过本包颜色模式。现在本包产生的颜色遵循关闭状态；不剥除 Pi 自己的结果正文颜色。 | `style.ts`、`shell-call.ts` |
| 用户消息颜色来源设置无效 | `colorSources.userMessages` 未使用，缓存也不含解析后的样式。1.5.0 让 theme 模式使用主题边框/强调色，但随后确认默认 `borderMuted` 会使发送后的渐变边框变暗。1.5.1 保留品牌渐变边框，颜色来源只影响轨道，并继续在切换后重绘。 | `user-message.ts` |
| diff 统计漏计 `+++` / `---` 内容 | 原实现把所有此类行都当文件头。现在根据 unified diff 的 hunk 位置及行计数区分文件头与改动内容；Pi 的带行号 display diff 继续支持。 | `tool-execution.ts` |
| 最新 Pi 的主题测试实际没跑 | 仍只找旧 schema 路径。先查 `schemas/theme.schema.json`，再回退旧路径；宿主已安装却无 schema 时失败而非静默跳过。 | `test/theme.test.ts` |
| 旧版主题 schema 不兼容 | 实际安装 Pi 0.87.1 后，证实它不接受可选的 `appearance` 顶层键。移除此键，不提高最低支持版本；新 Pi 可推断暗色外观。 | `themes/sakura-macaron.json` |
| 默认 fullscreen 的迁移提示错误 | 成功取得设置但没有 `tuiMode` 时，Pi 1.5.2 实际默认为 fullscreen；现在解析此默认值，旧宿主无 API 时仍用通用提示。 | `index.ts` |
| Node 语法检查漏掉逗号后的参数属性 | 用 Node 自带 `stripTypeScriptTypes(..., { mode: "strip" })` 解析，不执行代码，替换构造函数正则。开发工具默认对齐 Pi 1.5.2。 | `scripts/check.mjs`、`scripts/dev-setup.mjs` |

## Warning / Error 的颜色规则

应区分三种信息，不要混成一个“红色失败状态”：

1. **工具执行状态**：只有 Pi 的 `result.isError` 决定 `FAILED`，不是 stderr、退出提示里的某个词或正文是否包含 `Error`。状态通过符号和文字表达；轨道跟随主题语义色，整行标题保持连续 Sakura 渐变。
2. **结构化通知**：`ctx.ui.notify(..., "warning" | "error")`、原生截断警告和完整输出链接继续由 Pi 渲染；主题中的 `warning`（本主题 butter）和 `error`（coral）已经定义。
3. **任意日志正文**：可能是源码、测试样例、JSON、转义序列或程序自己的 ANSI。默认不扫描 `warning` / `error` 子串，不把整段输出重新染色，也不把程序已有的颜色覆盖掉。

如果以后要增加日志级别标记，建议只做**可选的行首级别标记着色**，例如 `npm warn` / `ERROR:`；不能据此改变工具成功/失败状态。要可靠覆盖各种工具，优先由工具提供结构化级别，而不是扩张正则。

## 命令行的目标与边界

短命令：

```text
❯ cd pi-sakura-cyberdeck && npm run typecheck && npm test (timeout 120s)
```

- 普通参数不再全套 `toolTitle` 浅蓝；语法片段使用宿主的 `syntax*` 角色，提示符用 `accent`，timeout 用 `muted`。
- 关键词/builtin、字符串、变量、注释由 Pi 自带语法高亮处理。它是词法高亮，**不是 Shell AST**；不保证把每个外部可执行文件、flag 或 `&&` 都识别成独立语义类别。
- 不把字符串、管道或 heredoc 按猜测“美化重写”，不执行命令来确定颜色，也不额外启动 Shell parser。
- PowerShell 用自己的语法和 `PS>`；不是把所有平台都当 Bash。
- 原生 `renderCall` 仍被调用，以保留计时器和行局部状态；`renderResult` 保持原函数，包含原生预览、截断警告、完整输出路径和耗时。
- `!` / `!!` 用户 Shell 输出不是工具 `renderCall`，本轮保持原生。旧宿主没有公开 resolver 时也保持原生命令头。
- 很长命令的首次高亮仍会消耗 CPU；缓存解决重复重绘，不假装解决首次解析成本。

## 最新 Pi 中值得用、但不应乱加的功能

| 特性 | 对本仓库的结论 |
|---|---|
| 1.5 的原生包 changelog / `collapseChangelog` | 已采用；补充文档明确需要 Pi >=1.5.0，旧版用 `/sakura-changelog`。不再复制一套通知状态机。 |
| 公开 `registerToolRenderer` | 本轮用来单独更改 Shell 命令头，不重新注册/覆盖工具执行。完整外壳暂保留既有 guarded hook：全迁移需要重新验证图片、鼠标、展开态与其他扩展，不能把换接口当成免费优化。 |
| 1.5 的高亮/Markdown 复用与逐帧调度 | 本轮复用宿主高亮并缓存命令布局。不要让我们的渲染在每次计时刷新时重新处理整条长命令。 |
| 注入的 `keyHint` / `keyText` | 展开提示取 renderer context，不硬编码 Ctrl+O；同时处理本包的 NO_COLOR。 |
| `MarkdownTransformContext.availableWidth` | 是内容区域的精确列宽，已经扣除 outputPad；不能再扣一次。最终 Markdown 渲染仍需测试，不只测试 transformer 输出。 |
| 1.5.1 transformer 的 custom/summary/changelog 范围、messageId/timestamp | 目前只压缩 thinking 是明确的产品选择；不要扩大到回复、摘要、更新日志，也不为新字段建立未经证实的跨会话缓存。 |
| `ctx.ui.addAutocompleteProvider` | 建议相关搜索扩展优先叠加补全 provider，而不是替换整个编辑器；本仓库仍需包装不能正确组合的旧扩展。 |
| `theme.style`、具体 theme colors、自动 light/dark | 语义状态应跟随主题；品牌渐变可保留。本包仍要求暗色背景，不借此声称完成浅色主题适配。 |
| `agent_settled`、阻塞 UI 生命周期 | shimmer 已采用最终 settled 语义，footer 已在阻塞对话框期间暂停。没有证据表明要再加一套 loader 或定时器。 |
| 1.5.1 idle cache warming、Anthropic message threads、1.5.2 session fork | 属于宿主传输/会话功能，不应让视觉包修改用户的模型、缓存或会话策略。 |

## 社区方案与取舍

- **pi-pigment** 已实现 Shiki/TextMate、Shell AST、heredoc 和 `python -c` 等嵌入语言高亮。适合用户明确需要高精度语法时评估；页面列出 9 个依赖，不应为了一个 `❯` 或几种颜色引入整套系统。
- **pi-boxed-tools / pi-tools-style** 可参考可展开预览、语义色、窄宽度降级等设计，但不能据 README 推断它们与本仓库的 native-body/鼠标/扩展兼容约束相同。
- 上游关于 thinking soft breaks、代码块显示和 tool output cap 的 issue 提供问题背景；没有把所有视觉问题都归咎于上游。本次断树直接来自本仓库“先排版、再让 Markdown 改写”的组合错误。

## 验证

Node v26.10.0；没有对最低 Node 版本做额外实机验证。

| 宿主 | 测试结果 |
|---|---|
| Pi 1.5.2（`.dev`） | `npm run verify`：check、typecheck、126/126 tests，0 skip |
| Pi 0.99.1（`PI_HOST_ROOT`） | 126/126 tests，0 skip |
| Pi 0.87.1（`PI_HOST_ROOT`） | 126/126 tests，0 skip |

- 覆盖真实 Markdown 渲染，不只是源字符串：3 个颜色模式、宽度 7/30/120/140/160、长 code span、链接、math、未闭合反引号、中文/组合字符/emoji、控制字符；宽度 0/1/5/6 验证原生降级。
- 真实 `ToolExecutionComponent` + 原生 Bash renderer 验证 `❯`、RUNNING/COMPLETE、timeout、原生结果/警告/完整输出路径/计时结束。
- 真实 Pi Editor 点击测试，以及 fake foreign editor 的正文/补全坐标、borderless 水平线、viewport capture 和边框外 release 回归测试。
- 独立只读复核发现的缓存、提示行高度和 NO_COLOR 问题均已补回归。
- 以上是程序化真实组件测试，不冒充实际终端截图。字体的树线连接、不同终端的 emoji 宽度、实际 RPC/TTY 混用、多扩展动态更换主题，仍适合用户在所用终端做 smoke test。

## 资料

1. [Pi 最新 Release](https://github.com/earendil-works/pi/releases/tag/v1.5.2)；另用 `npm view @earendil-works/pi-coding-agent version dist-tags --json` 与 GitHub releases/latest 交叉确认。
2. [官方 changelog](https://pi.dev/changelog)；[Pi 1.5.0](https://pi.dev/changelog/releases/1.5.0)；[Pi 1.5.1](https://github.com/earendil-works/pi/releases/tag/v1.5.1)。
3. [Extension API 文档](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/extensions.md)、[TUI 文档](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/tui.md)、[主题 schema](https://pi.dev/schemas/theme.schema.json)。
4. [上游 Markdown transformer 讨论 #6747](https://github.com/earendil-works/pi/issues/6747)、[thinking soft-break 问题 #8673](https://github.com/earendil-works/pi/issues/8673)、[工具输出显示限制 #1795](https://github.com/earendil-works/pi/issues/1795)。
5. [pi-pigment](https://pi.dev/packages/pi-pigment)、[Shell AST / @aliou/sh](https://github.com/aliou/sh)、[pi-boxed-tools](https://github.com/BubbatheVTOG/pi-boxed-tools)、[pi-tools-style](https://github.com/Anthodev/pi-tools-style)。
6. [Shiki CLI/ANSI API](https://shiki.style/packages/cli)。本次没有为此安装新运行时依赖。
