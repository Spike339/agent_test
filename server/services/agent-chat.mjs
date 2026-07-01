import { runAgent } from "./agent-runtime.mjs";
import { getToolDefinitions, runToolCall } from "./tools.mjs";
import { saveToolCallLog } from "./log.mjs";
import * as serverConfig from "../config.mjs";

const config = serverConfig.config ?? serverConfig.runtimeConfig;
// agent-chat 是业务适配层
export async function createAgentChatCompletion({ messages, model }) {
  const trace = [];
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const selectedModel = model ?? config.openaiModel;
  // 记录当前在第几步
  let currentStep = 0;
  // 记录模型刚决定调用哪个工具
  let currentToolCall = null;
  // 真实的调用 runAgnet，
  const agentResult = await runAgent({
    llm: createRealLLM({ model: selectedModel }),
    tools: createRuntimeTools({
      requestId,
      getExecutionContext() {
        return {
          step: currentStep,
          toolCall: currentToolCall,
        };
      },
    }),
    messages: [...messages],
    options: {
      maxSteps: 3,
      maxToolRetries: 0,
      toolTimeoutMs: 3000,
    },
    // 接入 Trace，用来观察 Agent Runtime 的执行过程
    onTrace(event) {
      if (event.type === "llm_decision") {
        currentStep = event.step ?? currentStep;
        currentToolCall = event.data?.toolCall ?? null;
      }
      trace.push(event);
      console.log("[agent trace]", event);
    },
  });

  console.log("[agent trace summary]", trace);

  return {
    message: {
      role: "assistant",
      content: getAgentContent(agentResult),
    },
    usage: agentResult.usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    model: selectedModel,
    latency_ms: Date.now() - startedAt,
    request_id: requestId,
  };
}

// 使用真实的 LLM
// 这是一个 adapter 适配器
/*
不是 runtime 直接懂 OpenAI，而是 agent-chat 
里的 llm adapter 负责把 runtime 和 OpenAI 接起来。
*/
/*
  runtime 负责流程
  OpenAI 负责决策
  adapter 负责翻译
  tools 负责执行
*/
function createRealLLM({ model }) {
  // 选择模型
  const selectedModel = model ?? config.openaiModel;
  // 返回一个LLM函数
  return async function realLLM({ messages, tools }) {
    // 校验有没有 ApiKey
    if (!config.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    // OpenAI 请求。把Runtime 的数据转换成OpenAi 需要的格式
    const data = await postOpenAiJson("chat/completions", {
      model: selectedModel,
      messages: toOpenAiMessages(messages),
      tools: toOpenAITools(tools),
      tool_choice: "auto",
    });

    const message = data.choices?.[0]?.message;

    if (!message) {
      throw new Error("OpenAI returned no message");
    }
    // 如果模型需要调用工具，转换成 tool_call
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls
      : [];

    if (toolCalls.length > 0) {
      return {
        type: "tool_call",
        // 这里还是格式转换
        toolCalls: toolCalls.map((toolCall) => ({
          id: toolCall.id ?? crypto.randomUUID(),
          name: toolCall.function?.name,
          args: parseToolArguments(toolCall.function?.arguments),
        })),
        usage: normalizeUsage(data.usage),
      };
    }

    const content = normalizeContent(message.content);

    if (!content.trim()) {
      throw new Error("OpenAI returned empty content");
    }
    // 如果模型不调用工具，转换为 final
    return {
      type: "final",
      content,
      usage: normalizeUsage(data.usage),
    };
  };
}

// 接入项目已有 tools
function createRuntimeTools({ requestId, getExecutionContext }) {
  return getToolDefinitions().map((definition) => {
    const toolDefinition = definition.function;

    return {
      name: toolDefinition.name,
      description: toolDefinition.description,
      parameters: toolDefinition.parameters,
      async run(args, context) {
        const { step, toolCall } = context ?? getExecutionContext();

        // 这里不直接走 runToolCall，而是走 runToolCallWithLog，这样每次工具执行都会落日志
        return runToolCallWithLog({
          requestId,
          provider: "agent_chat",
          iteration: step,
          toolCallId: toolCall?.id ?? crypto.randomUUID(),
          toolName: toolDefinition.name,
          rawArguments: args,
        });
      },
    };
  });
}

async function runToolCallWithLog({
  requestId,
  provider,
  iteration,
  toolCallId,
  toolName,
  rawArguments,
}) {
  const startedAt = Date.now();

  try {
    // 成功时记录 result
    const result = await runToolCall(toolName, rawArguments);

    await saveToolCallLog({
      requestId,
      provider,
      iteration,
      toolCallId,
      toolName,
      arguments: rawArguments,
      result,
      status: "success",
      latencyMs: Date.now() - startedAt,
    });

    return result;
  } catch (error) {
    //  失败时 记录 error
    const message =
      error instanceof Error ? error.message : "Unknown tool error";

    await saveToolCallLog({
      requestId,
      provider,
      iteration,
      toolCallId,
      toolName,
      arguments: rawArguments,
      error: {
        message,
      },
      status: "error",
      latencyMs: Date.now() - startedAt,
    });

    throw error;
  }
}

async function fakeLLM({ messages }) {
  const hasToolResult = messages.some((message) => message.role === "tool");

  if (!hasToolResult) {
    return {
      type: "tool_call",
      toolCall: {
        id: "call_1",
        name: "calculator",
        args: {
          expression: "1 + 2 * 3",
        },
      },
    };
  }

  const lastToolMessage = [...messages]
    .reverse()
    .find((message) => message.role === "tool");

  return {
    type: "final",
    content: `Tool result received: ${lastToolMessage?.content ?? ""}`,
  };
}

// 这一步的作用是 LLM 不在直接返回 有了一个虚拟的调用tool过程
const fakeTools = [
  {
    name: "echo_user_message",
    description: "Echo the latest user message.",
    async run(args) {
      return {
        echoed: args.text,
      };
    },
  },
];

function getAgentContent(agentResult) {
  if (agentResult.status === "completed") {
    return agentResult.content;
  }
  return `Agent stopped:  ${agentResult.reason ?? agentResult.status}`;
}

function toOpenAiMessages(messages) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: message.content,
      };
    }

    const openAiMessage = {
      role: message.role,
    };

    if ("content" in message) {
      openAiMessage.content = message.content;
    }

    if (Array.isArray(message.tool_calls)) {
      openAiMessage.tool_calls = message.tool_calls;
    }

    return openAiMessage;
  });
}

function toOpenAITools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  }));
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === "object") {
    return rawArguments;
  }

  try {
    return JSON.parse(rawArguments);
  } catch {
    throw new Error("Tool arguments must be valid JSON");
  }
}

function normalizeContent(content) {
  console.log(
    "%c [ content ]-207",
    "font-size:13px; background:pink; color:#bf2c9f;",
    content,
  );
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        return item?.text ?? "";
      })
      .join("");
  }

  return "";
}

async function postOpenAiJson(path, payload) {
  const baseUrl = config.openaiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data?.error?.message ?? `OpenAI request failed with ${response.status}`;

    throw new Error(message);
  }

  return data;
}

function normalizeUsage(usage) {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}
