 import type { UiChatMessage } from '../../types/chat'

type MessageListProps = {
  messages: UiChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-8 py-7 max-md:px-5 max-md:py-5"
    >
      {messages.map((message) => {
        const isUser = message.role === 'user'

        return (
          <article
            className={`flex max-w-[min(72%,720px)] flex-col gap-1.5 text-left max-md:max-w-[90%] ${
              isUser ? 'self-end items-end' : 'self-start items-start'
            }`}
            key={message.id}
          >
            <div className="flex items-center gap-2 text-xs leading-normal text-slate-500">
              <span className="font-bold text-slate-700">
                {isUser ? 'You' : 'Assistant'}
              </span>
              <time>{message.createdAt}</time>
            </div>
            <div
              className={`whitespace-pre-wrap rounded-lg border px-3.5 py-3 text-[15px] leading-relaxed ${
                isUser
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-800'
              }`}
            >
              {message.content}
            </div>
          </article>
        )
      })}
    </div>
  )
}
