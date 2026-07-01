/**
 * Minimal Agent Runtime.
 *
 * The model decides the next step, but the runtime owns the loop:
 * decide -> run tool -> append observation -> decide again.
 */

export const defaultAgentOptions = {
  maxSteps: 6,
  maxToolRetries: 1,
  toolTimeoutMs: 8000,
}

export async function runAgent(input) {
  const {
    llm,
    tools,
    messages,
    options = defaultAgentOptions,
    onTrace,
  } = input

  const resolvedOptions = {
    ...defaultAgentOptions,
    ...options,
  }
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]))

  let step = 0

  let usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }

  while (step < resolvedOptions.maxSteps) {
    step += 1

    const decision = await llm({
      messages,
      tools,
    })

    if (decision.usage) {
      usage = mergeUsage(usage, decision.usage)
    }

    onTrace?.({
      step,
      type: 'llm_decision',
      data: decision,
    })

    if (decision.type === 'final') {
      messages.push({
        role: 'assistant',
        content: decision.content,
      })

      onTrace?.({
        step,
        type: 'final',
        data: decision.content,
      })

      return {
        status: 'completed',
        content: decision.content,
        messages,
        usage,
      }
    }

    if (decision.type !== 'tool_call') {
      return {
        status: 'failed',
        reason: `Unknown agent decision type: ${decision.type}`,
        messages,
        usage,
      }
    }

    const toolCalls = normalizeToolCalls(decision)

    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map(toChatCompletionToolCall),
    })

    const toolMessages = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const tool = toolMap.get(toolCall.name)

        if (!tool) {
          const errorMessage = `Tool not found: ${toolCall.name}`

          onTrace?.({
            step,
            type: 'tool_error',
            data: {
              tool: toolCall.name,
              error: errorMessage,
            },
          })

          return buildToolMessage(toolCall, {
            error: true,
            message: errorMessage,
          })
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
          })

          onTrace?.({
            step,
            type: 'tool_result',
            data: {
              tool: toolCall.name,
              result: toolResult,
            },
          })

          return buildToolMessage(toolCall, toolResult)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          onTrace?.({
            step,
            type: 'tool_error',
            data: {
              tool: toolCall.name,
              error: message,
            },
          })

          return buildToolMessage(toolCall, {
            error: true,
            message,
          })
        }
      }),
    )

    messages.push(...toolMessages)
  }

  onTrace?.({
    step,
    type: 'stopped',
    data: 'Max steps reached',
  })

  return {
    status: 'stopped',
    reason: 'Max steps reached',
    messages,
    usage,
  }
}

export async function runToolWithRetry(input) {
  const { tool, args, maxRetries, timeoutMs, context } = input
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTimeout(() => tool.run(args, context), timeoutMs)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

function withTimeout(task, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    task()
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function mergeUsage(current, next) {
  return {
    prompt_tokens: current.prompt_tokens + Number(next.prompt_tokens ?? 0),
    completion_tokens:
      current.completion_tokens + Number(next.completion_tokens ?? 0),
    total_tokens: current.total_tokens + Number(next.total_tokens ?? 0),
  }
}

function normalizeToolCalls(decision) {
  const rawToolCalls = Array.isArray(decision.toolCalls)
    ? decision.toolCalls
    : decision.toolCall
      ? [decision.toolCall]
      : []

  return rawToolCalls.map((toolCall) => ({
    id: toolCall.id ?? crypto.randomUUID(),
    name: toolCall.name ?? '',
    args: toolCall.args ?? {},
  }))
}

function toChatCompletionToolCall(toolCall) {
  return {
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args ?? {}),
    },
  }
}

function buildToolMessage(toolCall, result) {
  return {
    role: 'tool',
    tool_call_id: toolCall.id,
    content: JSON.stringify(result),
  }
}
