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
  WAITING_FOR_APPROVAL: "waiting_for_approval",
});

// 把“错误后怎么恢复”从隐式逻辑变成明确策略。
export const RecoveryStrategy = Object.freeze({
  RETURN_ERROR_TO_MODEL: "return_error_to_model",
  FAIL_FAST: "fail_fast",
});

export const defaultAgentOptions = {
  maxSteps: 6,
  maxToolRetries: 1,
  toolTimeoutMs: 8000,
  toolErrorStrategy: RecoveryStrategy.RETURN_ERROR_TO_MODEL,
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

  // 已批准
  const approvedToolCallIds = new Set(
    resolvedOptions.approvedToolCallIds ?? [],
  );
  // 被拒绝的ToolCallId
  const rejectedToolCallIds = new Set(
    resolvedOptions.rejectedToolCallIds ?? [],
  );
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  let step = 0;

  let state = AgentState.IDLE;

  const traceEvents = [];

  function emitTrace(event) {
    traceEvents.push(event);
    onTrace?.(event);
  }

  function transition(nextState, data = {}) {
    const previousState = state;
    state = nextState;

    emitTrace?.({
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
    // 在 Agent 里，planning 不一定是“生成一个完整任务清单”。
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

    emitTrace?.({
      step,
      type: "llm_decision",
      data: decision,
    });

    //  根据决策制定计划
    const plan = buildPlanFromDecision(decision);

    emitTrace?.({
      step,
      type: "plan_created",
      data: plan,
    });

    if (decision.type === "final") {
      messages.push({
        role: "assistant",
        content: decision.content,
      });

      emitTrace?.({
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
        report: buildExecutionReport({
          status: "completed",
          finalState: AgentState.DONE,
          step,
          traceEvents,
        }),
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

    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const tool = toolMap.get(toolCall.name);

        if (!tool) {
          const errorMessage = `Tool not found: ${toolCall.name}`;

          emitTrace?.({
            step,
            type: "tool_error",
            data: {
              tool: toolCall.name,
              error: errorMessage,
            },
          });

          const recovery = buildToolErrorRecovery({
            toolCall,
            errorMessage,
            reason: "tool_not_found",
            strategy: resolvedOptions.toolErrorStrategy,
          });

          emitTrace?.({
            step,
            type: "recovery_decision",
            data: recovery,
          });

          if (recovery.action === "fail_agent") {
            return {
              failed: true,
              reason: `${recovery.reason}: ${recovery.tool}`,
              recovery,
            };
          }

          return {
            message: buildToolMessage(toolCall, recovery.observation),
          };
        }

        // 已批准
        const isApproved = approvedToolCallIds.has(toolCall.id);
        //
        const isRejected = rejectedToolCallIds.has(toolCall.id);

        // 审批被拒绝
        if (tool.requiresApproval && isRejected) {
          const observation = {
            error: true,
            approval_rejected: true,
            message: "Tool execution was rejected by human.",
            tool: toolCall.name,
          };

          emitTrace?.({
            step,
            type: "approval_rejected",
            data: {
              tool: toolCall.name,
              toolCall,
              observation,
            },
          });

          return {
            message: buildToolMessage(toolCall, observation),
          };
        }

        if (tool.requiresApproval && !isApproved) {
          const approvalRequest = {
            id: crypto.randomUUID(),
            step,
            toolCall,
            tool: {
              name: tool.name,
              description: tool.description ?? "",
            },
            reason: "tool requires approval",
          };

          emitTrace?.({
            step,
            type: "approval_required",
            data: {
              tool: toolCall.name,
              toolCall,
              approvalRequest,
            },
          });

          transition(AgentState.WAITING_FOR_APPROVAL, {
            reason: "tool requires approval",
            tool: toolCall.name,
            toolCall,
          });

          return {
            requiresApproval: true,
            approvalRequest,
          };
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

          emitTrace?.({
            step,
            type: "tool_result",
            data: {
              tool: toolCall.name,
              result: toolResult,
            },
          });

          return {
            message: buildToolMessage(toolCall, toolResult),
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          emitTrace?.({
            step,
            type: "tool_error",
            data: {
              tool: toolCall.name,
              error: message,
            },
          });

          const recovery = buildToolErrorRecovery({
            toolCall,
            errorMessage: message,
            reason: "tool_execution_failed",
            strategy: resolvedOptions.toolErrorStrategy,
          });

          emitTrace?.({
            step,
            type: "recovery_decision",
            data: recovery,
          });

          if (recovery.action === "fail_agent") {
            return {
              failed: true,
              reason: `${recovery.reason}: ${recovery.tool}`,
              recovery,
            };
          }

          return {
            message: buildToolMessage(toolCall, recovery.observation),
          };
        }
      }),
    );

    const approvalResult = toolResults.find(
      (result) => result.requiresApproval,
    );

    if (approvalResult) {
      return {
        status: "waiting_for_approval",
        approvalRequest: approvalResult.approvalRequest,
        messages,
        usage,
      };
    }

    const failedToolResult = toolResults.find((result) => result.failed);

    if (failedToolResult) {
      transition(AgentState.ERROR, {
        reason: failedToolResult.reason,
        recovery: failedToolResult.recovery,
      });

      return {
        status: "failed",
        reason: failedToolResult.reason,
        messages,
        usage,
      };
    }

    const toolMessages = toolResults.map((result) => result.message);

    messages.push(...toolMessages);
    transition(AgentState.OBSERVING, {
      toolMessages,
    });
  }

  emitTrace?.({
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

// Error Recovery 是 Runtime 的能力，不是模型的能力。模型可以看到错误，但“错误后允许继续、重试、还是终止”，应该由 Runtime 控制。
function buildToolErrorRecovery({
  toolCall,
  errorMessage,
  reason,
  strategy = RecoveryStrategy.RETURN_ERROR_TO_MODEL,
}) {
  const action =
    strategy === RecoveryStrategy.FAIL_FAST
      ? "fail_agent"
      : "return_error_to_model";

  return {
    strategy,
    action,
    reason,
    tool: toolCall.name,
    recoverable: action !== "fail_agent",
    observation: {
      error: true,
      message: errorMessage,
      recovery_strategy: strategy,
    },
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

function buildExecutionReport({ status, finalState, step, traceEvents }) {
  const statePath = traceEvents
    .filter((event) => event.type === "state_transition")
    .map((event) => event.data.to);

  const successfulToolCalls = traceEvents
    .filter((event) => event.type === "tool_result")
    .map((event) => ({
      name: event.data.tool,
      status: "success",
    }));

  const failedToolCalls = traceEvents
    .filter((event) => event.type === "tool_error")
    .map((event) => ({
      name: event.data.tool,
      status: "error",
    }));

  return {
    status,
    finalState,
    totalSteps: step,
    statePath,
    toolCalls: [...successfulToolCalls, ...failedToolCalls],
    retryCount: traceEvents.filter(
      (event) =>
        event.type === "state_transition" &&
        event.data.to === AgentState.RETRYING,
    ).length,
    errorCount: traceEvents.filter((event) => event.type === "tool_error")
      .length,
    approvalRequiredCount: traceEvents.filter(
      (event) => event.type === "approval_required",
    ).length,
  };
}
