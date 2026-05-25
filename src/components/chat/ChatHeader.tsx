type ChatHeaderProps = {
  modelName: string
}

export function ChatHeader({ modelName }: ChatHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-6 border-b border-slate-200 bg-white px-8 py-6 text-left max-md:flex-col max-md:items-stretch max-md:px-5">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-normal text-slate-500">
          LLM Playground
        </p>
        <h1 className="m-0 text-[28px] font-bold leading-tight tracking-normal text-slate-950">
          Chat MVP
        </h1>
      </div>

      <div className="min-w-44 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 max-md:min-w-0">
        <span className="block text-xs leading-normal text-slate-500">
          Model
        </span>
        <strong className="mt-0.5 block text-sm font-bold leading-normal text-slate-950">
          {modelName}
        </strong>
      </div>
    </header>
  )
}
