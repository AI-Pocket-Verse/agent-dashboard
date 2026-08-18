interface InspectorField {
  label: string
  value: string
}

interface Props {
  title: string
  subtitle?: string
  description?: string
  statusLabel?: string
  statusTone?: 'neutral' | 'running' | 'completed' | 'waiting' | 'failed' | 'pending'
  fields?: InspectorField[]
  logs?: string[]
  emptyHint?: string
}

const STATUS_TONE: Record<NonNullable<Props['statusTone']>, string> = {
  neutral: 'border-slate-200 text-slate-600',
  running: 'border-blue-200 text-blue-600',
  completed: 'border-emerald-200 text-emerald-700',
  waiting: 'border-amber-200 text-amber-700',
  failed: 'border-rose-200 text-rose-600',
  pending: 'border-slate-200 text-slate-500',
}

export default function WorkflowInspector({
  title,
  subtitle,
  description,
  statusLabel,
  statusTone = 'neutral',
  fields = [],
  logs = [],
  emptyHint = '点击一个节点查看详情',
}: Props) {
  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-black/[0.06] bg-[rgb(247,248,253)]">
      <div className="border-b border-black/[0.06] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="whitespace-normal break-words text-[1rem] font-semibold tracking-[-0.03em] text-black">{title}</div>
            {subtitle && <div className="mt-1 whitespace-normal break-words text-[12px] text-slate-500">{subtitle}</div>}
          </div>
          {statusLabel && (
            <div className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[statusTone]}`}>
              {statusLabel}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pr-5">
        {!description && fields.length === 0 && logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
            {emptyHint}
          </div>
        ) : (
          <div className="space-y-5">
            {description && (
              <section>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">说明</div>
                <div className="whitespace-pre-wrap break-words rounded-[18px] border border-slate-200/80 px-4 py-3 text-sm leading-6 text-slate-600">
                  {description}
                </div>
              </section>
            )}

            {fields.length > 0 && (
              <section>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">详情</div>
                <div className="space-y-2">
                  {fields.map(field => (
                    <div key={field.label} className="rounded-[18px] border border-slate-200/80 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{field.value}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {logs.length > 0 && (
              <section>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">最近日志</div>
                <div className="max-h-[420px] overflow-y-auto rounded-[18px] border border-slate-200/80 px-4 py-3 font-mono text-[12px] leading-6 text-slate-600">
                  {logs.map((line, index) => (
                    <div key={`${index}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-words">
                      {line}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
