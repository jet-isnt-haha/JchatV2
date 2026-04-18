# Deep Research 开发说明

本文档说明本次 Deep Research 功能的模块化实现方式、每个模块作用、回退点、关键数据流和后续扩展方向。

## 1. 目标范围

本次实现覆盖以下核心能力：

- 在聊天输入区增加深度研究模式开关。
- 用户输入研究主题后，后端创建研究任务并先返回拆分计划。
- 用户在右侧研究面板勾选并确认计划后，任务开始多轮检索与综合。
- 研究过程通过 SSE 实时推送：分支状态、证据流、预算进度、ETA。
- 完成后自动生成带句子级脚注引用的长报告，并回填主聊天时间线。
- 研究失败时清空过程面板，仅保留可操作错误提示。
- 支持 2 分钟内游标续传，超窗后快照恢复。
- 页面刷新后可恢复进行中的研究任务（P0 会话内恢复）。

## 2. 模块与回退点

每个模块都独立提交，可通过 git revert 或检出到对应提交快速回退。

### 模块 A：共享协议 + 后端 API 骨架

- Commit: fe9c827
- 作用：
  - 在 shared 中定义 deep research 类型协议（任务、分支、证据、预算、结果、流事件）。
  - 在 server controller/service 增加 deep research 路由和基础流接口。

### 模块 B：后端执行引擎 + Tavily 适配层

- Commit: 8e8eedc
- 作用：
  - 新增 Tavily 适配器（可替换检索层）。
  - 深度研究任务从“骨架”升级为可执行状态机。
  - 增加分支状态推进、证据流事件、预算事件、报告完成事件。

### 模块 C：后端策略增强（多轮、证据、报告）

- Commit: 640dee1
- 作用：
  - 强化任务执行细节，输出可用研究结果。
  - 将研究结果上下文注入后续普通聊天，满足“追问复用研究上下文”。

### 模块 D：前端状态机 + 右侧研究面板 + 输入开关

- Commit: 8e09f04
- 作用：
  - ChatProvider 增加研究任务生命周期状态。
  - ChatInput 增加深度研究开关与输入锁定。
  - ChatWorkspace 接入右侧 ResearchPanel，展示计划、分支、证据、预算、成本。
  - 研究完成后自动将报告作为 assistant 消息回填主时间线。

### 模块 E：后端调度与可解释性细化

- Commit: 6170b98
- 作用：
  - 分支队列轮转调度（避免前 3 分支长期占用）。
  - 失败/跳过次数累计。
  - 参考来源摘录支持“默认 200 字 + 可展开”。

### 模块 F：刷新恢复能力

- Commit: f3b66c2
- 作用：
  - 前端将 active task（chatId/taskId/streamSessionId）持久化到 sessionStorage。
  - 刷新后用 snapshot 恢复状态，并在任务未结束时继续流式订阅。

## 3. 关键文件说明

### 后端

- server/src/chat/chat.controller.ts
  - Deep Research API 路由入口。
  - chat 与 research 两套 SSE 构建函数。

- server/src/chat/chat.service.ts
  - 深度研究任务状态机核心。
  - Tavily 检索重试、分支调度、证据采纳/拒绝、报告组装、失败终止。
  - 研究结果上下文注入普通聊天（follow-up 复用）。

- server/src/chat/research-search.adapter.ts
  - Tavily 检索适配器。
  - 后续可替换为其他搜索供应商而不改任务主流程。

- server/src/chat/chat.module.ts
  - 注册 TavilyResearchSearchAdapter Provider。

### 前端

- client/src/services/chatApi.ts
  - Deep Research 相关 HTTP + SSE API 封装。

- client/src/providers/chat/ChatProvider.tsx
  - 研究模式状态机、事件处理、恢复逻辑。
  - 研究报告回填主时间线。

- client/src/components/ChatInput.tsx
  - 深度研究开关、输入锁定、主题占位文案。

- client/src/components/business/ChatWorkspace.tsx
  - 三栏布局接入研究面板。

- client/src/components/business/chat/ResearchPanel.tsx
  - 计划确认、分支进度、证据流、预算、错误、成本展示。

- shared/types/chat.ts
  - 全部 deep research 协议定义。

- shared/index.ts
  - deep research 类型导出。

## 4. 后端状态机简图

1. startResearchTask -> waiting_confirm
2. confirmResearchPlan -> running
3. 每轮执行：
   - 选取分支（并发上限 3）
   - retrieving -> reading -> synthesizing -> completed/pending
   - 推送 evidence_added/evidence_rejected/budget_progress/eta_updated
4. 结束条件：
   - 覆盖达标 或 连续低增益 或 轮次/时长上限（含 +1 扩展）
5. 成功：finalizing -> completed -> report_ready(done=true)
6. 失败：failed -> task_failed(done=true)

## 5. 配置项

请在 server 环境变量中配置：

- TAVILY_API_KEY: Tavily API Key（必填）
- TAVILY_BASE_URL: 可选，默认 https://api.tavily.com
- OPENAI_API_KEY / OPENAI_BASE_URL / LLM_MODEL: 现有聊天与报告生成所需

## 6. 已满足的产品约束映射

- 前台可见同步流程：已支持（右侧实时面板）。
- 句子级脚注引用：已支持（报告正文 -> 底部锚点）。
- 引用编号全局连续：已支持。
- 同源多次引用新编号：已支持（每次 appendFootnote 都分配新序号）。
- 非白名单来源可引用但降权：已支持（置信度评分中降权）。
- 分支并发上限 3 + 队列：已支持（轮转调度）。
- API 失败重试 2 次：已支持（1s、2s）。
- 失败时仅显示错误：已支持（前端清空面板状态）。
- 刷新后继续与恢复：已支持（sessionStorage + snapshot + SSE）。

## 7. 验证建议

建议按以下顺序人工验证：

1. 开启深度研究开关，输入研究主题。
2. 查看计划确认 UI（默认全选）。
3. 确认后观察分支状态与证据流实时变化。
4. 任务结束后检查：
   - 报告是否自动回填聊天时间线。
   - 报告脚注是否可跳转到底部参考条目。
   - 成本估算是否显示。
5. 研究进行中刷新页面，检查恢复与续流。
6. 模拟 Tavily key 缺失，检查失败提示和面板清空行为。

## 8. 当前已知环境问题（非本次功能引入）

以下问题来自现有仓库工具链配置，不属于 deep research 代码逻辑错误：

- client build 报错：tsconfig.app.json 中 ignoreDeprecations 值异常。
- client lint 报错：eslint 配置依赖导出路径异常。

建议后续单独提交一个“工具链修复”模块处理，不与业务功能混合。
