import type { ReactNode } from 'react'

export interface ContextMenuItem {
  key: string
  label: ReactNode
  onSelect?: () => void
  tone?: 'default' | 'danger' | 'muted'
  disabled?: boolean
}

interface Props {
  open: boolean
  left: number
  top: number
  items: ContextMenuItem[]
  onClose: () => void
  widthClassName?: string
}

export default function ContextMenu({
  open,
  left,
  top,
  items,
  onClose,
  widthClassName = 'w-[196px]',
}: Props) {
  if (!open) return null

  return (
    <div
      className={`fixed z-50 rounded-[18px] border border-slate-200 bg-[rgb(247,248,253)] p-1.5 shadow-[0_18px_36px_rgba(15,23,42,0.14)] ${widthClassName}`.trim()}
      style={{ left, top }}
      onClick={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      {items.map(item => {
        const className = item.disabled
          ? 'text-slate-400 cursor-not-allowed'
          : item.tone === 'danger'
            ? 'text-rose-600 hover:bg-rose-50'
            : item.tone === 'muted'
              ? 'text-slate-400'
              : 'text-slate-700 hover:bg-white'

        if (item.disabled || !item.onSelect) {
          return (
            <div
              key={item.key}
              className={`flex w-full items-center rounded-[14px] px-3 py-2 text-left text-[13px] transition ${className}`}
            >
              {item.label}
            </div>
          )
        }

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              item.onSelect?.()
              onClose()
            }}
            className={`flex w-full items-center rounded-[14px] px-3 py-2 text-left text-[13px] transition ${className}`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
