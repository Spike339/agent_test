/**
 * Minimal Agent Runtime.
 *
 * The model decides the next step, but the runtime owns the loop:
 * decide -> run tool -> append observation -> decide again.
 */

export const AgentState = Object.freeze({
  IDLE: "idle",
  PLANNING: "planning",
  ACTING: "acting",
  OBSERVING: "observing",
  RETRYING: "retrying",
  DONE: "done",
  ERROR: "error",
});

export const defaultAgentOptions = {
  maxSteps: 6,
  maxToolRetries: 1,
  toolTimeoutMs: 8000,
};

export async function runAgent(input) {
  const {
    llm,
    tools,
    messages,
    options = defaultAgentOptions,
    onTrace,
  } = input;

  const resolvedOptions = {
    ...defaultAgentOptions,
    ...options,
  };
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  let step = 0;

  let state = AgentState.IDLE;

  function transition(nextState, data = {}) {
    const previousState = state;
    state = nextState;

    onTrace?.({
      step,
      type: "state_transition",
      data: {
        from: previousState,
        to: nextState,
        ...data,
      },
    });
  }

  let usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  while (step < resolvedOptions.maxSteps) {
    step += 1;

    transition(AgentState.PLANNING, {
      reason: "asking model for next decision",
    });

    const decision = await llm({
      messages,
      tools,
    });

    if (decision.usage) {
      usage = mergeUsage(usage, decision.usage);
    }

    onTrace?.({
      step,
      type: "llm_decision",
      data: decision,
    });

    //  根据决策制定计划
    const plan = buildPlanFromDecision(decision);

    onTrace?.({
      step,
      type: "plan_created",
      data: plan,
    });

    if (decision.type === "final") {
      messages.push({
        role: "assistant",
        content: decision.content,
      });

      onTrace?.({
        step,
        type: "final",
        data: decision.content,
      });

      transition(AgentState.DONE, {
        reason: "model returned final answer",
      });
      return {
        status: "completed",
        content: decision.content,
        messages,
        usage,
      };
    }

    if (decision.type !== "tool_call") {
      transition(AgentState.ERROR, {
        reason: `Unknown agent decision type: ${decision.type}`,
      });

      return {
        status: "failed",
        reason: `Unknown agent decision type: ${decision.type}`,
        messages,
        usage,
      };
    }

    const toolCalls = normalizeToolCalls(decision);

    transition(AgentState.ACTING, {
      toolCalls,
    });

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: toolCalls.map(toChatCompletionToolCall),
    });

    const toolMessages = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const tool = toolMap.get(toolCall.name);

        if (!tool) {
          const errorMessage = `Tool not found: ${toolCall.name}`;

          onTrace?.({
            step,
            type: "tool_error",
            data: {
              tool: toolCall.name,
              error: errorMessage,
            },
          });

          return buildToolMessage(toolCall, {
            error: true,
            message: errorMessage,
          });
        }

        try {
          const toolResult = await runToolWithRetry({
            tool,
            args: toolCall.args,
            maxRetries: resolvedOptions.maxToolRetries,
            timeoutMs: resolvedOptions.toolTimeoutMs,
            context: {
              step,
              toolCall,
            },
            onRetry({ attempt, nextAttempt, maxRetries, error }) {
              transition(AgentState.RETRYING, {
                tool: toolCall.name,
                attempt,
                nextAttempt,
                maxRetries,
                error,
                reason: "tool failed, retrying",
              });
            },
          });

          onTrace?.({
            step,
            type: "tool_result",
            data: {
              tool: toolCall.name,
              result: toolResult,
            },
          });

          return buildToolMessage(toolCall, toolResult);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          onTrace?.({
            step,
            type: "tool_error",
            data: {
              tool: toolCall.name,
              error: message,
            },
          });

          return buildToolMessage(toolCall, {
            error: true,
            message,
          });
        }
      }),
    );

    messages.push(...toolMessages);
    transition(AgentState.OBSERVING, {
      toolMessages,
    });
  }

  onTrace?.({
    step,
    type: "stopped",
    data: "Max steps reached",
  });

  transition(AgentState.ERROR, {
    reason: "Max steps reached",
  });

  return {
    status: "stopped",
    reason: "Max steps reached",
    messages,
    usage,
  };
}

export async function runToolWithRetry(input) {
  const { tool, args, maxRetries, timeoutMs, context, onRetry } = input;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTimeout(() => tool.run(args, context), timeoutMs);
    } catch (error) {
      lastError = error;
      const hasRetryLeft = attempt < maxRetries;

      if (hasRetryLeft) {
        onRetry?.({
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          maxRetries,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  throw lastError;
}

function withTimeout(task, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool timed out after ${timeoutMs}ms`));
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

function mergeUsage(current, next) {
  return {
    prompt_tokens: current.prompt_tokens + Number(next.prompt_tokens ?? 0),
    completion_tokens:
      current.completion_tokens + Number(next.completion_tokens ?? 0),
    total_tokens: current.total_tokens + Number(next.total_tokens ?? 0),
  };
}

function normalizeToolCalls(decision) {
  const rawToolCalls = Array.isArray(decision.toolCalls)
    ? decision.toolCalls
    : decision.toolCall
      ? [decision.toolCall]
      : [];

  return rawToolCalls.map((toolCall) => ({
    id: toolCall.id ?? crypto.randomUUID(),
    name: toolCall.name ?? "",
    args: toolCall.args ?? {},
  }));
}

function buildPlanFromDecision(decision) {
  // 完成
  if (decision.type === "final") {
    return {
      kind: "finish",
      reason: "model decided to return final answer",
      contentPreview: String(decision.content ?? "").slice(0, 120),
    };
  }

  // 工具调用
  if (decision.type === "tool_call") {
    const toolCalls = normalizeToolCalls(decision);

    return {
      kind: "use_tools",
      reason: "model decided to call tools",
      toolCount: toolCalls.length,
      tools: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      })),
    };
  }

  return {
    kind: "unknown",
    reason: `unknown decision type: ${decision.type}`,
    rawDecision: decision,
  };
}

function toChatCompletionToolCall(toolCall) {
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args ?? {}),
    },
  };
}

function buildToolMessage(toolCall, result) {
  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  };
}
