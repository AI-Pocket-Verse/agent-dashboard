import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

// 已打开的弹窗栈：Esc 只关闭最上层（最后挂载）的一个
const openDialogStack: Array<{ current: () => void }> = []

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
  // 记录 mousedown 是否落在遮罩本身：在输入框内拖选文字后松开在遮罩上，不应关闭
  const pressedOnOverlay = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const entry = { current: () => onCloseRef.current() }
    openDialogStack.push(entry)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      if (openDialogStack[openDialogStack.length - 1] !== entry) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const index = openDialogStack.indexOf(entry)
      if (index >= 0) openDialogStack.splice(index, 1)
    }
  }, [open])

  if (!open) return null

  // 挂到 body：宿主页面有 transform 祖先时，position:fixed 会相对该祖先定位，弹窗被裁出视口
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 py-8 ${overlayClassName}`}
      onMouseDown={event => { pressedOnOverlay.current = event.target === event.currentTarget }}
      onClick={event => {
        if (event.target === event.currentTarget && pressedOnOverlay.current) onClose()
        pressedOnOverlay.current = false
      }}
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
    </div>,
    document.body,
  )
}
