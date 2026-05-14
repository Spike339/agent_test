# 12 个月 Agent 学习路线：前端 -> Agent 工程师

这版路线的定位不是“AI 研究员”，而是：

> 从 React / 前端工程能力出发，成长为能独立做 Agent 产品和 Agent 系统的工程师。

你的优势：

- React / 前端工程基础
- 状态管理和 UI 工作流思维
- 对用户交互、工具面板、可视化调试有天然优势
- 能把 Agent 能力做成真正可用的产品，而不只是脚本 Demo

12 个月后的目标：

- 能独立开发一个 Agent 产品
- 理解 LLM、Tool Calling、Agent Loop、Workflow、Memory、Runtime
- 能开发 MCP Server / MCP Tool
- 能做 RAG、Coding Agent、Browser Agent、Multi-Agent
- 能做 Agent 的日志、评估、调试、权限和成本控制
- 能拿出一个能写进简历的 AI 前端开发助手项目

---

## 总原则

不要把重点放在“学很多框架”上。

框架会变，模型会变，但这些核心能力长期稳定：

- Tool：Agent 如何调用外部能力
- Workflow：Agent 如何按步骤完成任务
- Memory：Agent 如何管理上下文和长期信息
- Runtime：Agent 如何调度、恢复、限制和观测
- Eval：Agent 如何证明自己真的变好了

你每个月都要交付一个可以运行、可以复测、可以展示的小系统，而不是只看教程。

---

## 每周固定节奏

```txt
周一~周二：理解核心概念
周三~周四：实现核心 Demo
周五：做一个小项目或补全功能
周六：复盘失败案例、记录问题
周日：输出博客 / GitHub / 总结
```

每周至少沉淀：

- 1 个可运行 Demo
- 1 篇学习笔记
- 3~10 条固定测试用例
- 1 次失败复盘

---

## 每个 Agent 项目的统一验收标准

从第 2 个月开始，每个项目都要记录：

- 工具调用是否正确
- 输出格式是否稳定
- 失败时是否能复现
- 是否有日志和 Trace
- token、耗时、成本是多少
- 是否有危险操作的确认机制
- 是否有 10 条左右的固定测试任务

Agent 工程的重点不是“偶尔成功”，而是“可复现、可调试、可改进”。

---

# 第 1 个月：LLM 与 Agent 基础

目标：

```txt
真正理解：
LLM
Prompt
上下文
Tool Calling
Agent Loop
```

## 第 1 周：LLM 基础认知

学习：

- 什么是 Token
- 什么是 Prompt
- 什么是上下文窗口
- Temperature / Top-p 的作用
- LLM 为什么会产生幻觉

任务：

- 调通 OpenAI API 或其他 LLM API
- 做一个最简单的 Chat UI
- 支持多轮对话
- 记录每次请求的输入、输出、token 和耗时

成果：

```txt
拥有自己的最小 ChatGPT
```

## 第 2 周：Tool Calling / Function Calling

学习：

- Tool Calling
- JSON Schema
- ReAct 思想
- 为什么 Tool 是 Agent 的核心

任务：

实现天气查询 Demo：

```txt
用户：北京天气怎么样？
Agent：自动调用 getWeather(city)
Agent：根据工具结果回答用户
```

要求：

- 工具参数必须由模型生成
- 工具结果必须回传给模型再总结
- 记录工具调用日志

成果：

```txt
第一次真正做出可调用工具的 Agent
```

## 第 3 周：手写 Agent Loop

学习：

- think -> act -> observe
- Agent Runtime 的最小形态
- 为什么 Agent 会循环
- 最大步数、超时、错误处理

任务：

自己实现最小 Agent Loop：

```ts
while (!done && step < maxSteps) {
  const decision = await llm(messages, tools);
  const result = await runTool(decision.toolCall);
  messages.push(result);
}
```

要求：

- 支持最大循环步数
- 支持工具失败重试
- 支持终止条件
- 打印每一步的 Trace

成果：

```txt
理解 Agent 的本质：模型决策 + 工具执行 + 状态循环
```

## 第 4 周：第一个 Agent 项目

项目：

## React 项目分析 Agent（初级）

功能：

- 读取 package.json
- 分析依赖版本
- 发现可能的依赖问题
- 输出优化建议

验收：

- 能分析至少 3 个不同 React 项目
- 输出结构化报告
- 有工具调用日志
- 有 5 条固定测试样例

---

# 第 2 个月：Workflow、MCP 入门与 Agent 评估

目标：

```txt
理解：
Workflow
状态流转
任务编排
MCP 的基本思想
Agent Eval / Trace
```

这个月要开始建立工程化意识：Agent 不只是会调用工具，还要能被观察、测试和调试。

## 第 1 周：状态机与 Workflow

学习：

- Agent 状态机
- Planning
- Retry
- Error Recovery
- Human-in-the-loop

任务：

把 Agent 抽象成状态机：

```txt
idle
planning
acting
observing
retrying
done
error
```

成果：

```txt
第一次把 Agent 从脚本升级为 Workflow
```

## 第 2 周：可视化 Workflow

学习：

- DAG
- Node / Edge
- React Flow
- 工作流编排

任务：

用 React Flow 做一个简单的 AI Workflow 编辑器：

- Start 节点
- LLM 节点
- Tool 节点
- Condition 节点
- End 节点

成果：

```txt
开始做真正像产品的 Agent 工具
```

## 第 3 周：MCP 入门

学习：

- MCP 是什么
- Tools / Resources / Prompts
- MCP Server 和 MCP Client
- 为什么 MCP 是 Agent 工具生态的重要标准

任务：

自己写一个最小 MCP Server：

- 提供 read_file 工具
- 提供 list_files 工具
- 提供一个固定 Prompt

成果：

```txt
理解 MCP 的本质：用标准协议暴露工具和上下文
```

## 第 4 周：Trace 与 Eval

学习：

- 什么是 Trace
- 什么是 Agent Eval
- 如何设计测试任务集
- 如何判断 Agent 是否真的变好了

任务：

给前面的 React 项目分析 Agent 加上：

- Trace 日志
- 10 条固定测试任务
- 成功 / 失败判断
- 工具调用统计
- token、耗时、成本统计

成果：

```txt
Agent 从“能跑”变成“能评估”
```

---

# 第 3 个月：RAG 与代码库知识库

目标：

```txt
理解：
Embedding
向量搜索
Chunk
Retrieval
Rerank
代码库问答
```

## 第 1 周：Embedding 与相似度搜索

学习：

- 向量是什么
- Embedding 是什么
- Cosine Similarity
- 为什么语义搜索不是关键词搜索

任务：

- 调用 Embedding API
- 实现文本向量搜索
- 对比关键词搜索和向量搜索效果

成果：

```txt
理解 RAG 的检索基础
```

## 第 2 周：向量数据库

学习：

- Chroma
- pgvector
- Pinecone
- 本地向量库和云向量库的取舍

任务：

- 做一个本地知识库搜索
- 支持文档增删
- 支持搜索结果排序

成果：

```txt
拥有自己的最小知识库
```

## 第 3 周：RAG 问答

学习：

- Chunk
- Retrieval
- Rerank
- 引用来源
- 上下文拼接策略

任务：

实现：

```txt
上传文档 -> 切分 -> 向量化 -> 检索 -> 问答
```

要求：

- 回答必须带来源片段
- 检索不到时要明确说不知道
- 记录每次命中的 chunk

成果：

```txt
能做一个可靠的文档问答 Agent
```

## 第 4 周：React 项目知识库 Agent

项目：

## React 项目知识库 Agent

功能：

- 上传或读取整个 React 项目
- 建立代码索引
- 回答代码问题
- 引用相关文件路径

验收：

- 能回答“这个组件在哪里被使用”
- 能回答“这个状态从哪里来”
- 能回答“这个 API 在哪里调用”
- 回答中必须带文件路径和代码片段

---

# 第 4 个月：Coding Agent 基础

目标：

```txt
进入 AI Coding，但先做小闭环，不急着做完整 Cursor。
```

## 第 1 周：代码结构理解

学习：

- AST
- Babel
- TypeScript Compiler API
- import/export 分析

任务：

- 分析 React 文件 AST
- 提取组件名、props、hooks、依赖
- 生成结构化 JSON

成果：

```txt
让 Agent 不只“读文本”，而是理解代码结构
```

## 第 2 周：代码风险检测

任务：

实现：

```txt
自动检测 useEffect 风险
```

检测项：

- 依赖数组缺失
- 依赖项可能不完整
- effect 中直接发请求但缺少取消逻辑
- setState 可能造成循环

成果：

```txt
第一个代码审查型 Agent 能力
```

## 第 3 周：生成 Patch / Diff

任务：

- 让 Agent 根据问题生成 diff
- 不直接覆盖文件
- 先展示修改建议
- 用户确认后再应用

要求：

- 修改范围尽量小
- diff 必须可读
- 修改前后要能对比

成果：

```txt
从“回答问题”进入“修改代码”
```

## 第 4 周：Mini Coding Assistant v1

项目：

## Mini Coding Assistant v1

支持：

- 问代码
- 找相关文件
- 解释组件
- 生成单文件 diff
- 检测 useEffect 风险

暂时不追求完整自动修复，先把“理解代码 + 生成小补丁”做稳。

---

# 第 5 个月：Coding Agent 闭环

目标：

```txt
实现：
修改 -> 测试 -> 观察结果 -> 再修复
```

## 第 1 周：文件修改工具

学习：

- 安全写文件
- Patch 应用
- Git diff
- 回滚策略

任务：

- 实现 applyPatch 工具
- 应用前展示 diff
- 应用后记录修改文件

## 第 2 周：测试命令接入

学习：

- npm test
- npm run lint
- npm run typecheck
- 命令执行日志

任务：

- 让 Agent 能运行测试命令
- 读取失败输出
- 总结失败原因

## 第 3 周：自动修复循环

任务：

实现：

```txt
修改代码
运行测试
读取错误
再次修改
直到通过或达到最大步数
```

要求：

- 设置最大修复轮数
- 每轮都记录 diff
- 失败时输出清楚原因

## 第 4 周：Mini Coding Assistant v2

项目：

## Mini Coding Assistant v2

支持：

- 问代码
- 改代码
- 运行测试
- 根据报错再次修复
- 输出完整修复报告

验收：

- 用 3 个真实小 bug 测试
- 至少 1 个 bug 能完成自动修复闭环
- 所有修改都有 diff 和日志

---

# 第 6 个月：Browser Agent

目标：

```txt
理解：
Playwright
DOM
Screenshot
网页操作 Agent
```

## 第 1 周：Playwright 基础

学习：

- Browser Automation
- Locator
- 点击、输入、等待
- 截图和页面状态

任务：

- 自动打开网页
- 搜索关键词
- 点击结果
- 保存截图

## 第 2 周：Agent 操作网页

任务：

实现：

```txt
用户目标 -> Agent 拆解步骤 -> Playwright 执行
```

例如：

- 搜索商品
- 查询天气
- 填写简单表单

要求：

- 每一步操作都有日志
- 操作失败要能重试
- 高风险操作需要确认

## 第 3 周：DOM 与 Screenshot 理解

学习：

- DOM 快照
- Accessibility Tree
- Screenshot 理解
- 视觉信息和结构信息如何结合

任务：

- 让 Agent 同时使用 DOM 文本和截图信息
- 判断按钮、输入框、列表的位置和含义

## 第 4 周：网页操作 Agent

项目：

## Web Task Agent

示例任务：

```txt
帮我查某个城市的酒店价格
帮我搜索某个技术问题
帮我比较两个商品页面
```

验收：

- 能完成 3 类网页任务
- 有截图、操作日志和失败原因
- 不自动提交订单、付款、删除数据等高风险操作

---

# 第 7 个月：Memory 系统

目标：

```txt
理解：
短期记忆
长期记忆
用户偏好
Context Compression
```

学习：

- Conversation Memory
- Summary Memory
- Vector Memory
- Profile Memory
- Context Compression

项目：

## 有记忆的 AI 助手

功能：

- 记住用户偏好
- 记住历史任务
- 能总结长期上下文
- 能区分“事实记忆”和“临时上下文”
- 支持用户查看、编辑、删除记忆

验收：

- 不把所有聊天记录无脑塞进上下文
- 记忆有来源和更新时间
- 用户可以控制哪些内容被记住

---

# 第 8 个月：Multi-Agent

目标：

```txt
理解：
Planner
Executor
Reviewer
多角色协作
```

学习：

- Planner / Executor / Reviewer
- 任务拆解
- Agent 间消息协议
- 多 Agent 的成本和复杂度

项目：

## 多 Agent Coding System

角色：

- Planner：拆解任务
- Coder：修改代码
- Reviewer：检查风险
- Tester：运行测试

要求：

- 不要一开始做很多 Agent
- 先做 3~4 个明确分工的角色
- 每个角色有清楚输入输出

验收：

- 能完成一个小型代码修改任务
- Reviewer 能发现至少一种真实问题
- Tester 能反馈测试结果
- 最终输出完整执行报告

---

# 第 9 个月：Agent Runtime

目标：

```txt
进入核心区：
调度
状态持久化
中断恢复
Token Budget
权限控制
```

学习：

- 任务队列
- 状态持久化
- 中断与恢复
- Token Budget
- 工具权限
- 长任务调度

项目：

## 自己的 Agent Runtime

功能：

- 创建任务
- 暂停任务
- 恢复任务
- 查看任务状态
- 查看每一步 Trace
- 限制最大 token、最大步骤、最大耗时

验收：

- 任务中断后可以恢复
- 每一步状态可追踪
- 工具权限可配置
- 超出预算会停止并解释原因

---

# 第 10 个月：Agent 产品化

目标：

```txt
让 Agent 从工程 Demo 变成可用产品。
```

学习：

- 可观测性
- Prompt 管理
- 日志系统
- Agent Debug
- 权限系统
- 成本统计
- 用户反馈闭环

项目：

## Agent Dashboard

功能：

- 任务列表
- Trace 查看
- 工具调用记录
- Prompt 版本管理
- Eval 结果展示
- token / cost / latency 统计
- 失败案例管理

验收：

- 能看清楚一次 Agent 任务为什么成功或失败
- 能比较两个 Prompt 版本的效果
- 能按任务查看工具调用链路

---

# 第 11 个月：长任务 Agent 与高级工程能力

目标：

```txt
处理真实复杂任务：
长上下文
长任务规划
人工确认
自我检查
```

学习：

- Context Engineering
- Long Task Planning
- Self Reflection
- Human-in-the-loop
- Guardrails
- 任务分阶段交付

项目：

## 长任务 Agent

示例：

```txt
分析一个中型 React 项目
找出 5 个可优化点
生成修改计划
等待用户确认
逐步修改
运行测试
输出报告
```

验收：

- 能处理超过 30 分钟的任务
- 中途可以暂停和恢复
- 关键修改前会请求确认
- 最终报告包含计划、执行、失败、成本和测试结果

---

# 第 12 个月：毕业项目

目标：

```txt
做一个真正完整、可展示、可写进简历的 Agent 产品。
```

建议项目：

## AI 前端开发助手

核心能力：

- 理解 React 项目
- 回答代码问题
- 自动生成组件
- 自动修复简单错误
- 自动分析 useEffect / 状态管理 / 性能问题
- 自动生成测试
- 能运行 lint / typecheck / test
- 支持 Browser 操作验证页面
- 支持 MCP Tool 接入
- 有 Dashboard、Trace、Eval、成本统计

最低可交付版本：

- 代码库问答
- 单文件 diff 修改
- 测试命令执行
- 失败后尝试修复
- Trace 和日志
- 10~20 条固定评测任务
- 一个可演示的前端 UI

最终展示内容：

- 项目 README
- 架构图
- Demo 视频
- 失败案例分析
- Eval 报告
- 成本和性能数据

---

## 推荐技术栈

前端：

- React
- TypeScript
- React Flow
- Tailwind 或现有 UI 库

Agent / 后端：

- Node.js / TypeScript
- OpenAI API 或兼容模型 API
- MCP SDK
- Playwright
- pgvector / Chroma
- SQLite / Postgres

工程化：

- Git diff / patch
- npm scripts
- Vitest / Jest
- ESLint
- TypeScript typecheck
- 日志和 Trace

---

## 最容易踩的坑

1. 疯狂学框架，但没有自己实现 Agent Loop
2. 只做 Demo，不做日志、评估和失败复盘
3. 过早做 Multi-Agent，结果复杂度爆炸
4. RAG 只做“能回答”，不检查来源和检索质量
5. Coding Agent 直接改文件，没有 diff、确认和回滚
6. Browser Agent 自动执行高风险操作，没有人工确认
7. 只追求模型聪明，不控制成本、延迟和稳定性

---

## 一句话版本

```txt
前 3 个月打基础：
LLM / Tool / Workflow / MCP / RAG / Eval

中间 3 个月做能力：
Coding Agent / Browser Agent / Memory

后 3 个月做系统：
Multi-Agent / Runtime / Dashboard

最后 3 个月做产品：
长任务 Agent / AI 前端开发助手 / 完整作品集
```

这条路线的核心不是“学会某个框架”，而是掌握 Agent 工程的底层能力：

```txt
工具调用可控
任务流程可追踪
状态可以恢复
输出可以评估
失败可以复盘
产品可以交付
```
