import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

loadDotEnv()

export const config = {
  port: Number(process.env.PORT ?? 3001),
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  openaiWireApi: process.env.OPENAI_WIRE_API ?? 'responses',
  openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? '',
}

function loadDotEnv() {
  const envPath = resolve(process.cwd(), '.env')

  if (!existsSync(envPath)) {
    return
  }

  const envFile = readFileSync(envPath, 'utf8')

  for (const line of envFile.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmedLine.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = trimmedLine.slice(0, separatorIndex).trim()
    const value = trimmedLine.slice(separatorIndex + 1).trim()

    if (!key || process.env[key] !== undefined) {
      continue
    }

    process.env[key] = stripWrappingQuotes(value)
  }
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}
