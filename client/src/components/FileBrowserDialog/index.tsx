import { useState, useEffect, useCallback } from 'react'
import { api, type FsItem } from '../../lib/api'
import DialogShell from '../DialogShell/index'
import { t } from '../../lib/i18n'

interface Props {
  onSelect: (item: FsItem) => void
  onSelectMany?: (items: FsItem[]) => void
  onCancel: () => void
  selectionMode?: 'any' | 'file'
  multiSelect?: boolean
  title?: string
  subtitle?: string
}

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const parts = path.split('/').filter(Boolean)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-500">
      <button onClick={() => onNavigate('/')} className="shrink-0 transition hover:text-slate-900">/</button>
      {parts.map((part, i) => {
        const p = '/' + parts.slice(0, i + 1).join('/')
        return (
          <span key={p} className="flex min-w-0 items-center gap-1">
            <span className="text-slate-300">/</span>
            <button
              onClick={() => onNavigate(p)}
              className={`max-w-[120px] truncate transition hover:text-slate-900 ${i === parts.length - 1 ? 'text-slate-900' : ''}`}
            >
              {part}
            </button>
          </span>
        )
      })}
    </div>
  )
}

export default function FileBrowserDialog({
  onSelect,
  onSelectMany,
  onCancel,
  selectionMode = 'any',
  multiSelect = false,
  title,
  subtitle,
}: Props) {
  const [path, setPath] = useState('')
  const [parent, setParent] = useState('')
  const [items, setItems] = useState<FsItem[]>([])
  const [selected, setSelected] = useState<FsItem | null>(null)
  const [selectedItems, setSelectedItems] = useState<FsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const navigate = useCallback(async (target: string) => {
    setLoading(true)
    setError(null)
    setSelected(null)
    setSelectedItems([])
    try {
      const res = await api.fsBrowse(target)
      setPath(res.path)
      setParent(res.parent)
      setItems(res.items)
    } catch {
      setError(t('无法读取该目录'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    api.fsRoots().then(r => navigate(r.projectRoot)).catch(() => navigate('/'))
  }, [navigate])

  const handleClick = (item: FsItem) => {
    if (multiSelect) {
      if (selectionMode === 'file' && item.type !== 'file') {
        setSelected(item)
        return
      }

      setSelectedItems(prev =>
        prev.some(entry => entry.path === item.path)
          ? prev.filter(entry => entry.path !== item.path)
          : [...prev, item]
      )
      setSelected(item)
      return
    }
    setSelected(item)
  }

  const handleDoubleClick = (item: FsItem) => {
    if (item.type === 'directory') {
      navigate(item.path)
    } else if (!multiSelect) {
      onSelect(item)
    }
  }

  const handleConfirm = () => {
    if (multiSelect) {
      if (selectedItems.length > 0) {
        onSelectMany?.(selectedItems)
      }
      return
    }

    if (selected && (selectionMode === 'any' || selected.type === 'file')) {
      onSelect(selected)
      return
    }
    if (selectionMode === 'any' && path) {
      onSelect({ name: path.split('/').pop() ?? path, type: 'directory', path })
    }
  }

  const confirmDisabled = multiSelect
    ? selectedItems.length === 0
    : selectionMode === 'file'
    ? selected?.type !== 'file'
    : false

  const confirmLabel = multiSelect
    ? t('添加 {n} 个文件', { n: selectedItems.length })
    : selectionMode === 'file'
    ? t('选择文件')
    : selected
      ? (selected.type === 'directory' ? t('选择目录') : t('选择文件'))
      : t('选择当前目录')

  return (
    <DialogShell
      open
      onClose={onCancel}
      maxWidthClassName="max-w-3xl"
      panelClassName="surface-panel flex max-h-[74vh] flex-col rounded-[30px]"
      contentClassName="flex min-h-0 flex-1 flex-col p-0"
      hideCloseButton
      overlayClassName="bg-[rgba(245,245,247,0.78)] backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            onClick={() => parent && navigate(parent)}
            disabled={!parent || parent === path}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-transparent text-sm text-slate-500 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-30"
            title={t('上级目录')}
          >
            ↑
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900">{title ?? t('选择本地文件')}</div>
            {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
            <div className="mt-1">
              <Breadcrumb path={path} onNavigate={navigate} />
            </div>
          </div>
        </div>
        <button onClick={onCancel} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-transparent text-slate-400 transition hover:border-slate-300 hover:text-slate-700">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 pr-3">
        {loading && <div className="py-10 text-center text-sm text-slate-500">{t('加载中...')}</div>}
        {error && <div className="py-10 text-center text-sm text-rose-500">{error}</div>}
        {!loading && !error && items.length === 0 && <div className="py-10 text-center text-sm text-slate-400">{t('空目录')}</div>}

        {!loading && items.map(item => (
          <button
            key={item.path}
            onClick={() => handleClick(item)}
            onDoubleClick={() => handleDoubleClick(item)}
            className={`flex w-full items-center gap-3 rounded-[18px] border px-4 py-3 text-left text-sm transition ${
              (multiSelect
                ? selectedItems.some(entry => entry.path === item.path)
                : selected?.path === item.path)
                ? 'border-slate-900 bg-transparent font-semibold text-slate-900'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:text-slate-900'
            }`}
          >
            <span className="w-5 shrink-0 text-center text-base">{item.type === 'directory' ? '📁' : '📄'}</span>
            <span className="truncate">{item.name}</span>
            {item.type === 'directory' && <span className="ml-auto shrink-0 text-xs opacity-60">{t('双击进入')}</span>}
          </button>
        ))}
      </div>

      <div className="border-t border-slate-200/80 px-5 py-4">
        <div className="mb-3 truncate text-sm text-slate-500">
          {multiSelect
            ? (
              selectedItems.length > 0
                ? <><span className="font-medium text-slate-800">{t('已选 {n} 项：', { n: selectedItems.length })}</span>{selectedItems.map(item => item.path).join('，')}</>
                : <span>{t('未选择 - 点击文件选择，双击目录进入')}</span>
            )
            : selected
            ? <><span className="font-medium text-slate-800">{t('已选：')}</span>{selected.path}</>
            : <span>{selectionMode === 'file' ? t('未选择 - 点击文件选择，双击目录进入') : t('未选择 - 点击选择文件或目录，双击进入目录')}</span>
          }
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleConfirm} disabled={confirmDisabled} className="btn-primary flex-1 min-w-[150px] disabled:cursor-not-allowed disabled:opacity-45">
            {confirmLabel}
          </button>
          <button
            onClick={() => selected?.type === 'directory' && navigate(selected.path)}
            disabled={selected?.type !== 'directory'}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t('进入')}
          </button>
          <button onClick={onCancel} className="btn-ghost">
            {t('取消')}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
