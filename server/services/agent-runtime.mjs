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

  while (step < resolvedOptions.maxSteps) {
    step += 1

    const decision = await llm({
      messages,
      tools,
    })

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
      }
    }

    if (decision.type !== 'tool_call') {
      return {
        status: 'failed',
        reason: `Unknown agent decision type: ${decision.type}`,
        messages,
      }
    }

    const toolCall = decision.toolCall
    const tool = toolMap.get(toolCall.name)

    if (!tool) {
      const errorMessage = `Tool not found: ${toolCall.name}`

      messages.push({
        role: 'tool',
        content: JSON.stringify({
          error: true,
          message: errorMessage,
        }),
      })

      onTrace?.({
        step,
        type: 'tool_error',
        data: {
          tool: toolCall.name,
          error: errorMessage,
        },
      })

      continue
    }

    messages.push({
      role: 'assistant',
      content: JSON.stringify({
        type: 'tool_call',
        toolCall,
      }),
    })

    try {
      const toolResult = await runToolWithRetry({
        tool,
        args: toolCall.args,
        maxRetries: resolvedOptions.maxToolRetries,
        timeoutMs: resolvedOptions.toolTimeoutMs,
      })

      messages.push({
        role: 'tool',
        content: JSON.stringify(toolResult),
      })

      onTrace?.({
        step,
        type: 'tool_result',
        data: {
          tool: toolCall.name,
          result: toolResult,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      messages.push({
        role: 'tool',
        content: JSON.stringify({
          error: true,
          message,
        }),
      })

      onTrace?.({
        step,
        type: 'tool_error',
        data: {
          tool: toolCall.name,
          error: message,
        },
      })
    }
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
  }
}

export async function runToolWithRetry(input) {
  const { tool, args, maxRetries, timeoutMs } = input
  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTimeout(() => tool.run(args), timeoutMs)
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
