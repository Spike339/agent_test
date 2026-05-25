type ChatInputProps = {
  draft: string
  isLoading: boolean
  onDraftChange: (draft: string) => void
  onSend: () => void
}

export function ChatInput({
  draft,
  isLoading,
  onDraftChange,
  onSend,
}: ChatInputProps) {
  const canSend = draft.trim().length > 0 && !isLoading

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-slate-200 bg-white px-8 pb-6 pt-4 max-md:grid-cols-1 max-md:px-5 max-md:pb-5"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      <textarea
        aria-label="输入消息"
        className="min-h-20 w-full resize-y rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-[15px] leading-relaxed tracking-normal text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15"
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (canSend) {
              onSend()
            }
          }
        }}
        placeholder="输入你的问题，按 Enter 发送，Shift + Enter 换行"
        rows={3}
        value={draft}
      />
      <button
        className="h-11 min-w-22 self-end rounded-lg border border-blue-700 bg-blue-600 px-5 text-[15px] font-bold leading-none text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 disabled:text-slate-500 max-md:w-full"
        disabled={!canSend}
        type="submit"
      >
        {isLoading ? '发送中' : '发送'}
      </button>
    </form>
  )
}
