import type { ReactNode } from 'react'
import { t } from '../../lib/i18n'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  maxWidthClassName?: string
  overlayClassName?: string
  panelClassName?: string
  contentClassName?: string
  headerActions?: ReactNode
  hideCloseButton?: boolean
}

export default function DialogShell({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidthClassName = 'max-w-[560px]',
  overlayClassName = 'bg-[rgba(245,245,247,0.76)] backdrop-blur-md',
  panelClassName = '',
  contentClassName = 'space-y-4',
  headerActions,
  hideCloseButton = false,
}: Props) {
  if (!open) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 py-8 ${overlayClassName}`}
      onClick={onClose}
      onContextMenu={event => event.preventDefault()}
    >
      <div
        className={`w-full rounded-[28px] border border-black/10 bg-[rgb(247,248,253)] shadow-[0_24px_48px_rgba(15,23,42,0.12)] ${maxWidthClassName} ${panelClassName}`.trim()}
        onClick={event => event.stopPropagation()}
      >
        {(title || description || headerActions || !hideCloseButton) && (
          <div className="flex items-start justify-between gap-4 px-5 pb-0 pt-5">
            <div className="min-w-0 flex-1">
              {title && <h3 className="text-[1.1rem] font-semibold tracking-[-0.04em] text-black">{title}</h3>}
              {description && <div className="mt-1 text-[13px] text-slate-500">{description}</div>}
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {headerActions}
              {!hideCloseButton && (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-slate-500 transition hover:border-black/20 hover:text-black"
                  aria-label={t('关闭')}
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        <div className={`px-5 pb-5 pt-5 ${contentClassName}`.trim()}>
          {children}
          {footer && <div className="flex items-center justify-end gap-2.5">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
