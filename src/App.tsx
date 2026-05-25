import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChatHeader } from './components/chat/ChatHeader'
import { ChatInput } from './components/chat/ChatInput'
import { MessageList } from './components/chat/MessageList'
import { StatsPanel } from './components/chat/StatsPanel'
import { sendChatMessage } from './services/chat'
import { fetchChatLogs } from './services/logs'
import type { ChatMessage, ChatStats, UiChatMessage } from './types/chat'

const modelName = '由后端 .env 配置'

const initialMessages: UiChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content:
      '你好，我是这个 MVP 的 Chat UI。现在可以先验证多轮消息展示、输入区和统计面板，下一步再接 /api/chat。',
    createdAt: '09:30',
    isLocalOnly: true,
  },
]

function App() {
  const queryClient = useQueryClient()
  // messages
  const [messages, setMessages] = useState<UiChatMessage[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<ChatStats>({
    requestCount: 0,
    lastLatency: null,
    lastTokens: 0,
    totalTokens: 0,
  })

  const apiMessages = useMemo(
    () =>
      messages
        .filter((message) => !message.isLocalOnly)
        .map(({ role, content }) => ({
          role,
          content,
        })),
    [messages],
  )

  const logsQuery = useQuery({
    queryKey: ['chat-logs', 10],
    queryFn: () => fetchChatLogs(10),
  })

  const handleSend = async () => {
    const content = draft.trim()

    if (!content || isLoading) {
      return
    }

    const timeLabel = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })

    const userMessage: UiChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: timeLabel,
    }
    const nextApiMessages: ChatMessage[] = [
      ...apiMessages,
      {
        role: userMessage.role,
        content: userMessage.content,
      },
    ]

    setMessages((currentMessages) => [...currentMessages, userMessage])
    setDraft('')
    setError(null)
    setIsLoading(true)

    try {
      const result = await sendChatMessage({
        messages: nextApiMessages,
      })

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.message.content,
          createdAt: new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
      ])
      setStats((currentStats) => ({
        requestCount: currentStats.requestCount + 1,
        lastLatency: result.latency_ms,
        lastTokens: result.usage.total_tokens,
        totalTokens: currentStats.totalTokens + result.usage.total_tokens,
      }))
      await queryClient.invalidateQueries({ queryKey: ['chat-logs', 10] })
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : '请求失败'

      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col bg-slate-50 text-slate-900">
      <ChatHeader modelName={modelName} />

      <section
        aria-label="Chat workspace"
        className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] max-xl:grid-cols-1"
      >
        <div className="flex min-h-0 min-w-0 flex-col">
          <MessageList messages={messages} />
          {error ? (
            <div className="border-t border-red-200 bg-red-50 px-8 py-3 text-sm text-red-700 max-md:px-5">
              {error}
            </div>
          ) : null}
          <ChatInput
            draft={draft}
            isLoading={isLoading}
            onDraftChange={setDraft}
            onSend={handleSend}
          />
        </div>

        <StatsPanel
          stats={stats}
          logs={logsQuery.data ?? []}
          isLogsLoading={logsQuery.isLoading}
          logsError={logsQuery.error instanceof Error ? logsQuery.error.message : null}
        />
      </section>
    </main>
  )
}

export default App
