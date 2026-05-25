import type { ChatLog } from '../types/chat'

type LogsResponse = {
  logs: ChatLog[]
  error?: string
}

export async function fetchChatLogs(limit = 20): Promise<ChatLog[]> {
  const response = await fetch(`/api/logs?limit=${limit}`)
  const data = (await response.json().catch(() => null)) as LogsResponse | null

  if (!response.ok) {
    const message =
      typeof data?.error === 'string' ? data.error : 'Failed to load logs'

    throw new Error(message)
  }

  return Array.isArray(data?.logs) ? data.logs : []
}
