import { existsSync } from 'node:fs'
import { mkdir, appendFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const logFilePath = resolve(process.cwd(), 'server/data/chat-logs.jsonl')

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

function clampLimit(limit) {
  if (!Number.isFinite(limit)) {
    return 20
  }

  return Math.max(1, Math.min(50, Math.trunc(limit)))
}
