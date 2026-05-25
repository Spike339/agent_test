import { createChatCompletion } from '../services/llm.mjs'
import { saveChatLog } from '../services/log.mjs'

export async function handleChatRoute(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  try {
    const body = await readJsonBody(request)
    const messages = normalizeMessages(body?.messages)
    const model = typeof body?.model === 'string' ? body.model : undefined
    const result = await createChatCompletion({ messages, model })
    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user')

    await saveChatLog({
      userInput: latestUserMessage?.content ?? '',
      assistantOutput: result.message.content,
      usage: result.usage,
      latencyMs: result.latency_ms,
      model: result.model,
    })

    sendJson(response, 200, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    sendJson(response, 500, { error: message })
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array')
  }

  return messages.map((message) => {
    if (
      !message ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.trim().length === 0
    ) {
      throw new Error('Each message must include role and content')
    }

    return {
      role: message.role,
      content: message.content,
    }
  })
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = ''

    request.on('data', (chunk) => {
      rawBody += chunk

      if (rawBody.length > 1024 * 1024) {
        request.destroy()
        reject(new Error('Request body is too large'))
      }
    })

    request.on('end', () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {})
      } catch {
        reject(new Error('Request body must be valid JSON'))
      }
    })

    request.on('error', reject)
  })
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(data))
}
