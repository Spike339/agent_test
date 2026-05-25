**PRD：多轮对话 Chat UI Demo**

**1. 项目目标**

做一个 Web 版 ChatGPT Demo，支持用户和 LLM 多轮对话，并记录每次请求的关键信息：

```text
用户输入
模型输出
token 用量
请求耗时
模型名称
请求时间
```

这个 Demo 的重点不是做复杂产品，而是帮助你真正理解：

```text
Prompt -> API 请求 -> LLM 生成 -> 多轮上下文 -> token 统计 -> 日志记录
```

---

**2. 核心用户**

当前阶段只有一个用户：

```text
开发者本人
```

也就是你自己。

你需要通过这个项目学会：

```text
如何接入 LLM API
如何维护多轮对话历史
如何统计 token 和耗时
如何把请求记录保存下来
```

---

**3. 功能范围**

**必须做的功能**

1. Chat UI  
   页面包含输入框、发送按钮、消息列表。

2. 多轮对话  
   每次请求都带上历史消息，让模型知道前文。

3. 调用 LLM API  
   默认支持 OpenAI API，也可以兼容其他 OpenAI-compatible API。

4. 请求日志记录  
   每次请求保存：
   ```text
   user_input
   assistant_output
   prompt_tokens
   completion_tokens
   total_tokens
   latency_ms
   model
   created_at
   ```

5. loading 状态  
   用户发送消息后，按钮禁用，页面显示模型正在回复。

6. 错误处理  
   API 报错时，前端显示错误信息，不让页面崩溃。

---

**暂时不做的功能**

第一版不做：

```text
用户登录
支付
多用户隔离
向量数据库
RAG
文件上传
语音输入
图片理解
复杂 Agent
```

这些以后可以扩展。

---

**4. 页面设计**

单页面即可。

页面结构：

```text
顶部：应用标题 + 当前模型名

中间：聊天消息区
- 用户消息靠右
- AI 消息靠左
- 支持多轮消息展示

底部：输入区
- 多行输入框
- 发送按钮
```

右侧或底部可以有一个简单的请求统计面板：

```text
本次耗时：1200ms
本次 token：856
总 token：3412
请求次数：5
```

---

**5. 用户流程**

基础流程：

```text
用户打开页面
用户输入问题
点击发送
前端把用户消息加入消息列表
前端请求后端 API
后端调用 LLM API
LLM 返回回答和 token usage
后端记录日志
前端展示 AI 回复
前端展示 token 和耗时
```

---

**6. 数据结构**

**消息结构**

```ts
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
```

**请求日志结构**

```ts
type ChatLog = {
  id: string;
  user_input: string;
  assistant_output: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  model: string;
  created_at: string;
};
```

---

**7. API 设计**

前端调用自己的后端：

```http
POST /api/chat
```

请求体：

```json
{
  "messages": [
    {
      "role": "user",
      "content": "什么是 LLM？"
    }
  ],
  "model": "your-model-name"
}
```

响应体：

```json
{
  "message": {
    "role": "assistant",
    "content": "LLM 是大语言模型..."
  },
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 300,
    "total_tokens": 420
  },
  "latency_ms": 1350,
  "model": "your-model-name"
}
```

---

**8. 技术方案建议**

推荐第一版用：

```text
前端：React / Next.js
后端：Next.js API Route
LLM：OpenAI API 或 OpenAI-compatible API
数据库：先用 SQLite，甚至第一版可以先写 JSON 文件
```

如果你想快速做出来：

```text
Next.js + API Route + SQLite
```

这是比较适合 Demo 的方案。

环境变量：

```env
OPENAI_API_KEY=你的 API Key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=你的模型名
```

这样以后换其他 LLM 服务时，只需要改：

```text
base_url
api_key
model
```

---

**9. 验收标准**

第一版完成后，应满足：

1. 可以在页面输入问题并得到模型回复。
2. 连续追问时，模型能理解前文。
3. 每次请求都能看到耗时。
4. 每次请求都能看到 token 用量。
5. 请求日志被保存下来。
6. API key 不出现在前端代码里。
7. API 报错时页面不会崩溃。

---

**10. 里程碑**

**MVP 版本**

```text
1. 搭建 Chat UI
2. 写 /api/chat 后端接口
3. 接入 LLM API
4. 支持多轮 messages
5. 返回 token usage 和 latency
6. 保存请求日志
```

**第二版**

```text
1. 增加会话列表
2. 支持新建/删除会话
3. 支持切换模型
4. 支持查看历史请求日志
```

**第三版**

```text
1. 接入 RAG
2. 支持上传文档
3. 支持 system prompt 配置
4. 支持流式输出
```

---

最小可行版本可以先只做一句话目标：

```text
做一个 Chat 页面，用户发消息，后端带历史 messages 调用 LLM API，返回回答，并记录 token 和耗时。
```

这个 PRD 已经够你开始写代码了。