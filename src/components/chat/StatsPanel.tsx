import type { ChatLog, ChatStats } from '../../types/chat'

type StatsPanelProps = {
  stats: ChatStats
  logs: ChatLog[]
  isLogsLoading: boolean
  logsError: string | null
}

export function StatsPanel({
  stats,
  logs,
  isLogsLoading,
  logsError,
}: StatsPanelProps) {
  const lastLatency =
    stats.lastLatency === null ? '-' : `${stats.lastLatency}ms`

  return (
    <aside className="border-l border-slate-200 bg-white p-6 text-left max-lg:border-l-0 max-lg:border-t max-md:p-5">
      <section>
        <h2 className="m-0 mb-4 text-lg font-bold leading-snug tracking-normal text-slate-950">
          请求统计
        </h2>
        <dl className="grid gap-3 max-md:grid-cols-2">
          <StatItem label="本次耗时" value={lastLatency} />
          <StatItem label="本次 token" value={stats.lastTokens} />
          <StatItem label="总 token" value={stats.totalTokens} />
          <StatItem label="请求次数" value={stats.requestCount} />
        </dl>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="m-0 text-lg font-bold leading-snug tracking-normal text-slate-950">
            最近日志
          </h2>
          <span className="text-xs text-slate-500">{logs.length} 条</span>
        </div>

        {logsError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {logsError}
          </div>
        ) : isLogsLoading ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            加载中...
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            暂无日志
          </div>
        ) : (
          <div className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto pr-1">
            {logs.map((log) => (
              <article
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                key={log.id}
              >
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{new Date(log.created_at).toLocaleString('zh-CN')}</span>
                  <span>{log.model}</span>
                  <span>{log.latency_ms}ms</span>
                </div>
                <p className="mb-2 line-clamp-2 text-slate-700">
                  {log.user_input}
                </p>
                <p className="line-clamp-3 text-slate-500">
                  {log.assistant_output}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}

type StatItemProps = {
  label: string
  value: number | string
}

function StatItem({ label, value }: StatItemProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <dt className="text-xs leading-normal text-slate-500">{label}</dt>
      <dd className="mt-1 text-[22px] font-bold leading-tight text-slate-950">
        {value}
      </dd>
    </div>
  )
}
