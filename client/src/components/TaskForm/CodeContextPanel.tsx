import { useState } from 'react'
import type { CodeContext } from '../../types/index'
import type { FsItem } from '../../lib/api'
import FileBrowserDialog from '../FileBrowserDialog/index'
import { t } from '../../lib/i18n'

interface Props {
  value: CodeContext[]
  onChange: (ctx: CodeContext[]) => void
}

interface Pending {
  path: string
  type: 'file' | 'directory'
}

export default function CodeContextPanel({ value, onChange }: Props) {
  const [showBrowser, setShowBrowser] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [desc, setDesc] = useState('')

  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  const handleSelect = (item: FsItem) => {
    setShowBrowser(false)
    setPending({ path: item.path, type: item.type })
    setDesc('')
  }

  const handleAdd = () => {
    if (!pending) return
    onChange([...value, { path: pending.path, description: desc.trim(), type: pending.type }])
    setPending(null)
    setDesc('')
  }

  const handleCancelPending = () => {
    setPending(null)
    setDesc('')
  }

  return (
    <>
      <section className="surface-panel-soft rounded-[28px] p-5">
        <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">{t('代码上下文')}</div>
            <div className="mt-1 text-sm text-slate-500">{t('为任务补充文件或目录，让 Agent 在更清晰的上下文里工作。')}</div>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Optional
          </span>
        </div>

        {value.length > 0 && (
          <div className="mb-3 space-y-2">
            {value.map((ctx, i) => (
              <div key={i} className="flex items-start gap-3 rounded-[22px] border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
                <span className="mt-0.5 shrink-0 text-base">{ctx.type === 'directory' ? '📁' : '📄'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-slate-700">{ctx.path}</div>
                  {ctx.description && <div className="mt-1 text-xs leading-5 text-slate-500">{ctx.description}</div>}
                </div>
                <button onClick={() => remove(i)} className="text-xs font-medium text-slate-400 transition hover:text-rose-500">
                  {t('移除')}
                </button>
              </div>
            ))}
          </div>
        )}

        {pending && (
          <div className="mb-3 rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-base">{pending.type === 'directory' ? '📁' : '📄'}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{pending.path}</span>
            </div>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder={t('为这个上下文补充一句说明（可选）...')}
              autoFocus
              className="field-input mt-3 text-sm"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={handleAdd} className="btn-primary flex-1 min-w-[150px]">
                {t('添加到上下文')}
              </button>
              <button onClick={handleCancelPending} className="btn-secondary">
                {t('取消')}
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => setShowBrowser(true)}
          className="w-full rounded-[22px] border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        >
          {t('+ 选择文件或目录')}
        </button>
      </section>

      {showBrowser && (
        <FileBrowserDialog
          onSelect={handleSelect}
          onCancel={() => setShowBrowser(false)}
        />
      )}
    </>
  )
}
