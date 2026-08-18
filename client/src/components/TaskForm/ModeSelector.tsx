import { t } from '../../lib/i18n'

export type TaskMode = 'ai' | 'template' | 'manual'

interface Props {
  mode: TaskMode
  onChange: (mode: TaskMode) => void
}

const MODES: { id: TaskMode; label: string; description: string }[] = [
  { id: 'ai', label: 'AI 自动选择', description: '系统先澄清需求，再生成执行方案' },
  { id: 'template', label: '模板执行', description: '直接使用现成工作流路径' },
  { id: 'manual', label: '手动编排', description: '自行选择参与的 Agent 阵列' },
]

export default function ModeSelector({ mode, onChange }: Props) {
  return (
    <div className="grid gap-2 rounded-[22px] border border-slate-200 p-1.5 md:grid-cols-3">
      {MODES.map(item => {
        const active = item.id === mode
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`rounded-[18px] px-4 py-3 text-left transition-all ${
              active
                ? 'border border-slate-300 bg-transparent text-slate-900 shadow-none'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <div className="text-sm font-semibold tracking-[-0.02em]">{t(item.label)}</div>
            <div className={`mt-1 text-xs leading-5 ${active ? 'text-slate-500' : 'text-slate-400'}`}>
              {t(item.description)}
            </div>
          </button>
        )
      })}
    </div>
  )
}
