import { runtimeConfig } from '../config.mjs'
import { saveToolCallLog } from './log.mjs'
import {
  getChatCompletionToolDefinitions,
  getResponseToolDefinitions,
  runToolCall,
} from './tools.mjs'

const maxToolIterations = 6

export async function createChatCompletion({ messages, model }) {
  if (!runtimeConfig.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured')
  }

  const selectedModel = model ?? runtimeConfig.openaiModel
  const startedAt = Date.now()
  const requestId = crypto.randomUUID()

  if (runtimeConfig.openaiWireApi === 'chat_completions') {
    const result = await createChatCompletionsResponse({
      messages,
      model: selectedModel,
      requestId,
    })

    return {
      ...result,
      latency_ms: Date.now() - startedAt,
      request_id: requestId,
    }
  }

  const result = await createResponsesApiResponse({
    messages,
    model: selectedModel,
    requestId,
  })

  return {
    ...result,
    latency_ms: Date.now() - startedAt,
    request_id: requestId,
  }
}

async function createChatCompletionsResponse({ messages, model, requestId }) {
  const conversation = [...messages]
  let totalUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }

  for (let iteration = 0; iteration < maxToolIterations; iteration += 1) {
    const data = await postOpenAiJson('chat/completions', {
      model,
      messages: conversation,
      ...getChatCompletionToolOptions(),
    })
    const choice = data.choices?.[0]
    const message = choice?.message

    totalUsage = mergeUsage(totalUsage, normalizeUsage(data.usage))

    if (!message) {
      throw new Error('Chat Completions API returned no message')
    }

    conversation.push(normalizeAssistantMessage(message))

    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      const assistantContent = normalizeTextContent(message.content)

      if (!assistantContent.trim()) {
        throw new Error('Chat Completions API did not include assistant content')
      }

      return {
        message: {
          role: 'assistant',
          content: assistantContent,
        },
        usage: totalUsage,
        model: data.model ?? model,
      }
    }

    const toolMessages = await Promise.all(
      message.tool_calls.map(async (toolCall) => {
        const toolName = toolCall.function?.name
        const toolResult = await runToolCallWithLog({
          requestId,
          provider: 'chat_completions',
          iteration,
          toolCallId: toolCall.id,
          toolName,
          rawArguments: toolCall.function?.arguments,
        })

        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        }
      }),
    )

    conversation.push(...toolMessages)
  }

  throw new Error('Tool calling exceeded the maximum number of iterations')
}

async function createResponsesApiResponse({ messages, model, requestId }) {
  let input = toResponsesInput(messages)
  let response = await postOpenAiJson('responses', {
    model,
    input,
    ...getResponseToolOptions(),
    ...getReasoningOptions(),
  })
  let totalUsage = normalizeUsage(response.usage)

  for (let iteration = 0; iteration < maxToolIterations; iteration += 1) {
    const functionCalls = extractResponseFunctionCalls(response)

    if (functionCalls.length === 0) {
      const assistantContent = extractResponseOutputText(response)

      if (!assistantContent.trim()) {
        throw new Error('Responses API did not include assistant content')
      }

      return {
        message: {
          role: 'assistant',
          content: assistantContent,
        },
        usage: totalUsage,
        model: response.model ?? model,
      }
    }

    const functionOutputs = await Promise.all(
      functionCalls.map(async (call) => {
        const toolResult = await runToolCallWithLog({
          requestId,
          provider: 'responses',
          iteration,
          toolCallId: call.call_id,
          toolName: call.name,
          rawArguments: call.arguments,
        })

        return {
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(toolResult),
        }
      }),
    )

    input = [
      ...input,
      ...normalizeResponseOutputForNextInput(response.output),
      ...functionOutputs,
    ]
    response = await postOpenAiJson('responses', {
      model,
      input,
      ...getResponseToolOptions(),
      ...getReasoningOptions(),
    })
    totalUsage = mergeUsage(totalUsage, normalizeUsage(response.usage))
  }

  throw new Error('Tool calling exceeded the maximum number of iterations')
}

async function runToolCallWithLog({
  requestId,
  provider,
  iteration,
  toolCallId,
  toolName,
  rawArguments,
}) {
  const startedAt = Date.now()

  try {
    const result = await runToolCall(toolName, rawArguments)
    const latencyMs = Date.now() - startedAt

    await saveToolCallLog({
      requestId,
      provider,
      iteration,
      toolCallId,
      toolName,
      arguments: normalizeToolArgumentsForLog(rawArguments),
      result,
      status: 'success',
      latencyMs,
    })

    return result
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : 'Unknown tool error'
    const errorResult = {
      ok: false,
      tool_name: toolName,
      error: {
        message,
      },
      note: 'The tool call failed. Explain the failure to the user and suggest trying again later or using another source if needed.',
    }

    await saveToolCallLog({
      requestId,
      provider,
      iteration,
      toolCallId,
      toolName,
      arguments: normalizeToolArgumentsForLog(rawArguments),
      error: {
        message,
      },
      result: errorResult,
      status: 'error',
      latencyMs,
    })

    return errorResult
  }
}

function normalizeToolArgumentsForLog(rawArguments) {
  if (typeof rawArguments !== 'string') {
    return rawArguments ?? {}
  }

  try {
    return JSON.parse(rawArguments)
  } catch {
    return rawArguments
  }
}

function toResponsesInput(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

function normalizeResponseOutputForNextInput(output) {
  if (!Array.isArray(output)) {
    return []
  }

  return output
    .map((item) => {
      if (item?.type === 'function_call') {
        return {
          type: 'function_call',
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        }
      }

      if (item?.type === 'message' && item.role) {
        return item
      }

      return null
    })
    .filter(Boolean)
}

function getReasoningOptions() {
  if (!runtimeConfig.openaiReasoningEffort) {
    return {}
  }

  return {
    reasoning: {
      effort: runtimeConfig.openaiReasoningEffort,
    },
  }
}

function getChatCompletionToolOptions() {
  if (!runtimeConfig.toolsEnabled) {
    return {}
  }

  return {
    tools: getChatCompletionToolDefinitions(),
    tool_choice: 'auto',
  }
}

function getResponseToolOptions() {
  if (!runtimeConfig.toolsEnabled) {
    return {}
  }

  return {
    tools: getResponseToolDefinitions(),
  }
}

async function postOpenAiJson(path, payload) {
  const url = new URL(path.replace(/^\/+/, ''), normalizeBaseUrl(runtimeConfig.openaiBaseUrl))

  let response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeConfig.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fetch failed'

    throw new Error(`Cannot reach OPENAI_BASE_URL (${runtimeConfig.openaiBaseUrl}): ${message}`)
  }

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const detail =
      typeof data?.error?.message === 'string'
        ? data.error.message
        : typeof data?.error === 'string'
          ? data.error
          : response.statusText

    throw new Error(`OpenAI API error ${response.status}: ${detail}`)
  }

  return data
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function normalizeAssistantMessage(message) {
  const assistantMessage = {
    role: 'assistant',
    content: normalizeAssistantContent(message.content),
  }

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    assistantMessage.tool_calls = message.tool_calls
  }

  return assistantMessage
}

function normalizeAssistantContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return normalizeTextContent(content)
  }

  return null
}

function normalizeTextContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (typeof item?.text === 'string') {
          return item.text
        }

        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

function extractResponseFunctionCalls(response) {
  if (!Array.isArray(response.output)) {
    return []
  }

  return response.output
    .filter((item) => item?.type === 'function_call')
    .map((item) => ({
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
    }))
    .filter((call) => call.call_id && call.name)
}

function extractResponseOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text
  }

  if (!Array.isArray(response.output)) {
    return ''
  }

  return response.output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((contentItem) => {
      if (typeof contentItem?.text === 'string') {
        return contentItem.text
      }

      if (typeof contentItem?.content === 'string') {
        return contentItem.content
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function normalizeUsage(usage) {
  const promptTokens =
    usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.input_token_count ?? 0
  const completionTokens =
    usage?.completion_tokens ??
    usage?.output_tokens ??
    usage?.output_token_count ??
    0
  const totalTokens = usage?.total_tokens ?? promptTokens + completionTokens

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  }
}

function mergeUsage(currentUsage, nextUsage) {
  return {
    prompt_tokens: currentUsage.prompt_tokens + nextUsage.prompt_tokens,
    completion_tokens:
      currentUsage.completion_tokens + nextUsage.completion_tokens,
    total_tokens: currentUsage.total_tokens + nextUsage.total_tokens,
  }
}
