export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type UiChatMessage = ChatMessage & {
  id: string
  createdAt: string
  isLocalOnly?: boolean
}

export type ChatUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type ChatLog = {
  id: string
  user_input: string
  assistant_output: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  latency_ms: number
  model: string
  created_at: string
}

export type ChatRequest = {
  messages: ChatMessage[]
  model?: string
}

export type ChatResponse = {
  message: ChatMessage
  usage: ChatUsage
  latency_ms: number
  model: string
}

export type ChatStats = {
  requestCount: number
  lastLatency: number | null
  lastTokens: number
  totalTokens: number
}
