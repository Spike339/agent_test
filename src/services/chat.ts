import type { ChatRequest, ChatResponse } from '../types/chat'

export async function sendChatMessage(
  payload: ChatRequest,
): Promise<ChatResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      typeof data?.error === 'string' ? data.error : 'Chat request failed'

    throw new Error(message)
  }

  return data as ChatResponse
}
