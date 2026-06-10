type Rule = "system" | "user" | "assistant" | "tool";

// Agent Loop 每一轮都需要上下文，而上下文就是 message
export type Message = {
  role: Rule;
  content: string;
};

// 模型想调用哪个工具，以及传什么参数
export type Tool = {
  name: string; // 决定调用什么工具
  description: string;
  // 决定这个工具应该怎么调用
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

// runtime 里真正可以被执行的工具
export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

//  Agent Loop 每一轮不是直接生成最终答案，而是先产生一个 decision
// Runtime 根据 decision 判断结束还是继续调用工具。
export type AgentDecision =
  | {
      type: "final";
      content: string;
    }
  | {
      type: "tool_call";
      toolCall: ToolCall;
    };

// Agent Loop 中，llm 不是直接等于大模型，他是一个函数，读取当前状态，返回下一步决策
export type LLM = (input: {
  // 输入上下文信息和执行工具
  message: Message[];
  tools: Tool[];
}) => Promise<AgentDecision>;

// 模型执行的限制
export type AgentOptions = {
  maxSteps: number;
  maxToolRetries: number;
  toolTimeoutMs: number;
};

export type TraceEvent = {
  step: number;
  type: "llm_decision" | "tool_result" | "tool_error" | "final" | "stopped";
  data: unknown;
};

// runAgent 是 Runtime 的入口
// 他负责调用模型，让模型基于当前 meaasges + tools 做 decision
// 模型不执行工具，只会生成 toolCall，Runtime 才真生执行 tool.run(args)
export async function runAgent(input: {
  llm: LLM;
  tools: Tool[];
  messages: Message[];
  options: AgentOptions;
  // Trace 不影响 Agent 使用逻辑，只是把每一步的信息打印出来
  onTrace?: (event: TraceEvent) => void;
}) {
  const { llm, tools, messages, options, onTrace } = input;

  let step = 0;

  // 只要没有达到最大步数，就继续让模型决策。
  while (step < options.maxSteps) {
    step++;

    const decision = await llm({
      messages,
      tools,
    });

    onTrace?.({
      step,
      type: "llm_decision",
      data: decision,
    });

    if (decision.type === "final") {
      messages.push({
        role: "assistant",
        content: decision.content,
      })

      onTrace?.({
        step,
        type: "final",
        data: decision,
      });
      
      return {
        status: "completed" as const,
        content: decision.content,
        messages,
      };
    }

    // 让模型决定调用什么工具
    const toolCall = decision.toolCall;

    // runtime 从已有工具列表中找到对应工具
    const tool = tools.find((item) => item.name === toolCall.name);

    if (!tool) {
      return {
        status: "failed" as const,
        reason: `Tool not found: ${toolCall.name}`,
        messages,
      };
    }

    //  记录模型做了什么动作
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        type: "tool_call",
        toolCall,
      }),
    });

    try {
      const toolResult = await runToolWithRetry({
        tool,
        args: toolCall.args,
        maxRetries: options.maxToolRetries,
        timeoutMs: options.toolTimeoutMs,
      });

      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult),
      });

      onTrace?.({
        step,
        type: "tool_result",
        data: {
          tool: toolCall.name,
          result: toolResult,
        },
      });
    } catch (error) {
      messages.push({
        role: "tool",
        content: JSON.stringify({
          error: true,
          message: String(error),
        }),
      });

      onTrace?.({
        step,
        type: "tool_error",
        data: {
          tool: toolCall.name,
          error: String(error),
        },
      });
    }
  }

  onTrace?.({
    step,
    type: "stopped",
    data: "Max steps reached",
  });

  // 如果decison.type = "final"说明任务结束，返回最终答案
  return {
    status: "tool_executed" as const,
    reason: "Max steps reached",
    messages,
  };
}

// 添加重试机制，maxToolRetries 代表执行失败后最多重试几次，不会一直卡循环
// retry 是 Runtime 的能力，不是模型的能力。
// 模型只提出 toolCall，Runtime 负责让工具执行的更稳定
export async function runToolWithRetry(input: {
  tool: Tool;
  args: Record<string, unknown>;
  maxRetries: number;
  timeoutMs: number;
}) {
  const { tool, args, maxRetries, timeoutMs } = input;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(() => tool.run(args), timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

// 处理工作超时
function withTimeout<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tppl timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    task()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
