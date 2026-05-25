import { config } from '../config.mjs'

const wireApiHandlers = {
  responses: {
    request: requestResponse,
    normalize: normalizeResponsesApiResult,
  },
  chat_completions: {
    request: requestChatCompletion,
    normalize: normalizeChatCompletionsResult,
  },
}

export async function createChatCompletion({ messages, model }) {
  if (!config.openaiApiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env')
  }

  const handler = wireApiHandlers[config.openaiWireApi]

  if (!handler) {
    throw new Error(
      `Unsupported OPENAI_WIRE_API "${config.openaiWireApi}". Use "responses" or "chat_completions".`,
    )
  }

  const selectedModel = model || config.openaiModel
  const startedAt = performance.now()
  const response = await handler.request(selectedModel, messages)
  const latencyMs = Math.round(performance.now() - startedAt)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      data?.error?.message ?? `LLM request failed with status ${response.status}`

    throw new Error(message)
  }

  return {
    ...handler.normalize(data, selectedModel),
    latency_ms: latencyMs,
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

async function requestResponse(model, messages) {
  return requestLlm('/responses', {
    model,
    input: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...buildResponsesOptions(),
  })
}

async function requestChatCompletion(model, messages) {
  return requestLlm('/chat/completions', {
    model,
    messages,
  })
}

async function requestLlm(path, body) {
  try {
    return await fetch(`${trimTrailingSlash(config.openaiBaseUrl)}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    const reason = getFetchFailureReason(error)

    throw new Error(
      `Cannot reach OPENAI_BASE_URL (${config.openaiBaseUrl}): ${reason}`,
    )
  }
}

function buildResponsesOptions() {
  return {
    ...(config.openaiReasoningEffort
      ? {
          reasoning: {
            effort: config.openaiReasoningEffort,
          },
        }
      : {}),
    store: false,
  }
}

function normalizeResponsesApiResult(data, fallbackModel) {
  const assistantContent = extractResponsesOutputText(data)

  if (assistantContent.length === 0) {
    throw new Error('Responses API did not include assistant content')
  }

  return {
    message: {
      role: 'assistant',
      content: assistantContent,
    },
    usage: {
      prompt_tokens: Number(data?.usage?.input_tokens ?? 0),
      completion_tokens: Number(data?.usage?.output_tokens ?? 0),
      total_tokens: Number(data?.usage?.total_tokens ?? 0),
    },
    model: data?.model ?? fallbackModel,
  }
}

function normalizeChatCompletionsResult(data, fallbackModel) {
  const assistantContent = data?.choices?.[0]?.message?.content

  if (typeof assistantContent !== 'string' || assistantContent.length === 0) {
    throw new Error('Chat Completions API did not include assistant content')
  }

  return {
    message: {
      role: 'assistant',
      content: assistantContent,
    },
    usage: {
      prompt_tokens: Number(data?.usage?.prompt_tokens ?? 0),
      completion_tokens: Number(data?.usage?.completion_tokens ?? 0),
      total_tokens: Number(data?.usage?.total_tokens ?? 0),
    },
    model: data?.model ?? fallbackModel,
  }
}

function extractResponsesOutputText(responseBody) {
  if (typeof responseBody?.output_text === 'string') {
    return responseBody.output_text
  }

  const output = responseBody?.output

  if (!Array.isArray(output)) {
    return ''
  }

  return output
    .flatMap((item) => {
      if (!item || item.type !== 'message' || !Array.isArray(item.content)) {
        return []
      }

      return item.content
        .filter((contentItem) => contentItem && contentItem.type === 'output_text')
        .map((contentItem) => contentItem.text)
    })
    .filter((text) => typeof text === 'string')
    .join('')
}

function getFetchFailureReason(error) {
  if (!(error instanceof Error)) {
    return 'unknown network error'
  }

  const cause = error.cause

  if (cause && typeof cause === 'object' && 'code' in cause) {
    return `${error.message} (${cause.code})`
  }

  return error.message
}
