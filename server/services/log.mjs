import { existsSync } from 'node:fs'
import { mkdir, appendFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const logFilePath = resolve(process.cwd(), 'server/data/chat-logs.jsonl')
const toolCallLogFilePath = resolve(process.cwd(), 'server/data/tool-call-logs.jsonl')
const maxLoggedTextLength = 4000

// 聊天日志和工具调用日志服务
export async function saveChatLog({
  userInput,
  assistantOutput,
  usage,
  latencyMs,
  model,
}) {
  const log = {
    id: crypto.randomUUID(),
    user_input: userInput,
    assistant_output: assistantOutput,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    latency_ms: latencyMs,
    model,
    created_at: new Date().toISOString(),
  }

  await mkdir(dirname(logFilePath), { recursive: true })
  await appendFile(logFilePath, `${JSON.stringify(log)}\n`, 'utf8')

  return log
}

// 读取聊天日志，默认返回最近 20 条
export async function readChatLogs(limit = 20) {
  if (!existsSync(logFilePath)) {
    return []
  }

  const fileContent = await readFile(logFilePath, 'utf8')
  const lines = fileContent.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const logs = []

  for (const line of lines) {
    try {
      logs.push(JSON.parse(line))
    } catch {
      continue
    }
  }

  const safeLimit = clampLimit(limit)

  return logs.reverse().slice(0, safeLimit)
}

export async function saveToolCallLog({
  requestId,
  provider,
  iteration,
  toolCallId,
  toolName,
  arguments: toolArguments,
  result,
  error,
  status,
  latencyMs,
}) {
  const log = {
    id: crypto.randomUUID(),
    request_id: requestId,
    provider,
    iteration,
    tool_call_id: toolCallId,
    tool_name: toolName,
    arguments: sanitizeLogValue(toolArguments),
    result: status === 'success' ? sanitizeLogValue(result) : null,
    error: status === 'error' ? sanitizeLogValue(error) : null,
    status,
    latency_ms: latencyMs,
    created_at: new Date().toISOString(),
  }

  await mkdir(dirname(toolCallLogFilePath), { recursive: true })
  await appendFile(toolCallLogFilePath, `${JSON.stringify(log)}\n`, 'utf8')

  return log
}

export async function readToolCallLogs(limit = 20) {
  if (!existsSync(toolCallLogFilePath)) {
    return []
  }

  const fileContent = await readFile(toolCallLogFilePath, 'utf8')
  const lines = fileContent.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const logs = []

  for (const line of lines) {
    try {
      logs.push(JSON.parse(line))
    } catch {
      continue
    }
  }

  const safeLimit = clampLimit(limit)

  return logs.reverse().slice(0, safeLimit)
}

function clampLimit(limit) {
  if (!Number.isFinite(limit)) {
    return 20
  }

  return Math.max(1, Math.min(50, Math.trunc(limit)))
}

function sanitizeLogValue(value) {
  const redactedValue = redactSensitiveValue(value)
  const text = JSON.stringify(redactedValue)

  if (typeof text !== 'string') {
    return redactedValue
  }

  if (text.length <= maxLoggedTextLength) {
    return redactedValue
  }

  return {
    truncated: true,
    preview: text.slice(0, maxLoggedTextLength),
  }
}

function redactSensitiveValue(value) {
  if (typeof value === 'string') {
    return redactSensitiveText(value)
  }

  if (Array.isArray(value)) {
    return value.map(redactSensitiveValue)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (/api[_-]?key|token|secret|authorization|password/i.test(key)) {
        return [key, '[redacted]']
      }

      return [key, redactSensitiveValue(entryValue)]
    }),
  )
}

function redactSensitiveText(text) {
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted_api_key]')
    .replace(
      /(OPENAI_API_KEY\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,}]+)/gi,
      '$1[redacted]',
    )
    .replace(/(api[_-]?key\s*[:=]\s*)("[^"]+"|'[^']+'|[^\s,}]+)/gi, '$1[redacted]')
    .replace(/([A-Za-z0-9_-]{48,})/g, '[redacted_token]')
}
