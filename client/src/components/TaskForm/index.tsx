import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type CompositionEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { AgentInfo, CodeContext, TaskAttachment, WorkflowTemplate } from '../../types/index'
import type { TaskMode } from './ModeSelector'
import type { FsItem } from '../../lib/api'
import { getAgentDisplayDescription } from '../../lib/agentDescriptions'
import FileBrowserDialog from '../FileBrowserDialog/index'
import { t } from '../../lib/i18n'

interface SubmitParams {
  mode: TaskMode
  prompt: string
  projectName: string
  codeContext: CodeContext[]
  attachments: TaskAttachment[]
  requireConfirm: boolean
  selectedAgents?: AgentInfo[]
  templateId?: string
}

interface Props {
  agents: AgentInfo[]
  templates: WorkflowTemplate[]
  onSubmit: (params: SubmitParams) => Promise<void> | void
  submitting?: boolean
  errorMessage?: string | null
}

interface PendingContext {
  path: string
  type: 'file' | 'directory'
}

interface AttachmentItem {
  id: string
  name: string
  type: 'file'
  size: number
  mime: string
  file: File
  previewUrl?: string
}

interface AttachmentMentionState {
  triggerIndex: number
  query: string
  activeIndex: number
}

interface PromptTextPart {
  id: string
  type: 'text'
  text: string
}

interface PromptAttachmentPart {
  id: string
  type: 'attachment'
  attachmentId: string
  name: string
  mime: string
}

type PromptPart = PromptTextPart | PromptAttachmentPart

type BrowserPurpose = 'context' | null

function ToolbarChip({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-all ${
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-transparent text-slate-300 shadow-none'
          : active
            ? 'border-slate-300 bg-transparent text-slate-900 shadow-none'
            : 'border-slate-200 bg-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
      }`}
    >
      <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
      {label}
    </button>
  )
}

function SelectionChip({
  label,
  icon,
  tone = 'slate',
  onRemove,
}: {
  label: string
  icon: string
  tone?: 'slate' | 'amber' | 'sky' | 'emerald'
  onRemove: () => void
}) {
  return (
    <div
      className={`group relative inline-flex max-w-full items-center rounded-full border px-3 py-1.5 pr-8 text-[12px] font-medium shadow-sm transition ${
        tone === 'amber'
          ? 'border-amber-200 bg-transparent text-amber-900'
          : tone === 'sky'
            ? 'border-sky-200 bg-transparent text-sky-900'
            : tone === 'emerald'
              ? 'border-emerald-200 bg-transparent text-emerald-900'
          : 'border-slate-200 bg-transparent text-slate-700'
      }`}
    >
      <span className="mr-1.5 shrink-0 text-[12px]">{icon}</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className={`absolute right-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] opacity-0 transition group-hover:opacity-100 ${
          tone === 'amber'
            ? 'text-amber-400 hover:bg-amber-100 hover:text-amber-700'
            : tone === 'sky'
              ? 'text-sky-400 hover:bg-sky-100 hover:text-sky-700'
              : tone === 'emerald'
                ? 'text-emerald-400 hover:bg-emerald-100 hover:text-emerald-700'
                : 'text-slate-400 hover:text-slate-700'
        }`}
        aria-label={`${t('移除')} ${label}`}
      >
        ×
      </button>
    </div>
  )
}

function SelectionRow({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="overflow-x-auto px-2 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-2">
        {children}
      </div>
    </div>
  )
}

function TemplateSelectionLabel({ name }: { name: string }) {
  return name.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

function AgentSelectionLabel({ name }: { name: string }) {
  return name
}

function ContextSelectionLabel({ path }: { path: string }) {
  return path
}

function SelectionMeta({
  selectedTemplate,
  selectedAgentNames,
  selectedCodeContext,
  onRemoveTemplate,
  onRemoveAgent,
  onRemoveContext,
}: {
  selectedTemplate: WorkflowTemplate | null
  selectedAgentNames: string[]
  selectedCodeContext: CodeContext[]
  onRemoveTemplate: () => void
  onRemoveAgent: (name: string) => void
  onRemoveContext: (path: string) => void
}) {
  const hasTemplateOrAgent = !!selectedTemplate || selectedAgentNames.length > 0
  const hasCode = selectedCodeContext.length > 0

  if (!hasTemplateOrAgent && !hasCode) return null

  return (
    <div className="mb-3 space-y-2">
      {hasTemplateOrAgent && (
        <SelectionRow>
          {selectedTemplate && (
            <SelectionChip
              label={TemplateSelectionLabel({ name: selectedTemplate.name })}
              icon="📦"
              tone="amber"
              onRemove={onRemoveTemplate}
            />
          )}

          {selectedAgentNames.map(name => (
            <SelectionChip
              key={name}
              label={AgentSelectionLabel({ name })}
              icon="🤖"
              tone="sky"
              onRemove={() => onRemoveAgent(name)}
            />
          ))}
        </SelectionRow>
      )}

      {hasCode && (
        <SelectionRow>
          {selectedCodeContext.map(ctx => (
            <SelectionChip
              key={ctx.path}
              label={ContextSelectionLabel({ path: ctx.path })}
              icon={ctx.type === 'directory' ? '📁' : '📄'}
              tone="emerald"
              onRemove={() => onRemoveContext(ctx.path)}
            />
          ))}
        </SelectionRow>
      )}
    </div>
  )
}

function getNextMode(templateId: string, selectedAgents: string[]): TaskMode {
  if (templateId) return 'template'
  if (selectedAgents.length > 0) return 'manual'
  return 'ai'
}

function TemplateIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <rect x="4" y="6" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6V4.5h6V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 9v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ManualIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
      <circle cx="14" cy="10" r="1.5" fill="currentColor" />
      <circle cx="7" cy="14" r="1.5" fill="currentColor" />
      <path d="m7.3 6.7 5.3 2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m7.7 13.2 5.1-2.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ContextIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M6 4.5h5l3 3V15a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 5 15V6A1.5 1.5 0 0 1 6.5 4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 4.5V8h3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.8 11h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.8 13.5h3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function getAttachmentBadgeLabel(name: string, mime: string) {
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'PDF'
  if (mime.includes('spreadsheet') || /\.(xlsx|xls|csv)$/i.test(name)) return 'XLS'
  if (mime.includes('word') || /\.(docx|doc)$/i.test(name)) return 'DOC'
  if (mime.includes('presentation') || /\.(pptx|ppt)$/i.test(name)) return 'PPT'
  if (mime.startsWith('text/') || /\.(md|txt)$/i.test(name)) return 'TXT'
  if (mime === 'application/json' || name.toLowerCase().endsWith('.json')) return 'JSON'
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'ZIP'

  const extension = name.split('.').pop()?.slice(0, 4).toUpperCase()
  return extension || 'FILE'
}

function formatAttachmentSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`
}

function getAttachmentMentionLabel(item: AttachmentItem) {
  return item.mime.startsWith('image/') ? t('图片') : getAttachmentBadgeLabel(item.name, item.mime)
}

function findAttachmentMention(value: string, cursor: number): Omit<AttachmentMentionState, 'activeIndex'> | null {
  const beforeCursor = value.slice(0, cursor)
  const triggerIndex = beforeCursor.lastIndexOf('@')
  if (triggerIndex < 0) return null

  const query = beforeCursor.slice(triggerIndex + 1)
  if (/[\s@]/.test(query)) return null
  if (query.length > 0) return null

  return {
    triggerIndex,
    query,
  }
}

function filterAttachmentMentionItems(items: AttachmentItem[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return items

  return items.filter(item => (
    item.name.toLowerCase().includes(normalizedQuery) ||
    getAttachmentBadgeLabel(item.name, item.mime).toLowerCase().includes(normalizedQuery)
  ))
}

function createTextPart(text = ''): PromptTextPart {
  return {
    id: `text-${crypto.randomUUID()}`,
    type: 'text',
    text,
  }
}

function createAttachmentPromptPart(item: AttachmentItem): PromptAttachmentPart {
  return {
    id: `attachment-${item.id}-${crypto.randomUUID()}`,
    type: 'attachment',
    attachmentId: item.id,
    name: item.name,
    mime: item.mime,
  }
}

function getPromptPartText(part: PromptPart) {
  return part.type === 'text' ? part.text : `@${part.name}`
}

function serializePromptParts(parts: PromptPart[]) {
  return parts.map(getPromptPartText).join('')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderPromptPartsHtml(parts: PromptPart[]) {
  return parts.map(part => {
    if (part.type === 'text') return escapeHtml(part.text)

    const serial = getPromptPartText(part)
    return [
      `<span data-prompt-mention="attachment"`,
      ` data-part-id="${escapeHtml(part.id)}"`,
      ` data-attachment-id="${escapeHtml(part.attachmentId)}"`,
      ` data-name="${escapeHtml(part.name)}"`,
      ` data-mime="${escapeHtml(part.mime)}"`,
      ` data-serial="${escapeHtml(serial)}"`,
      ` contenteditable="false"`,
      ` class="group relative ml-1.5 inline-flex min-h-7 max-w-[220px] -translate-y-[1px] items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-[0.82rem] font-medium leading-none text-slate-800 align-middle shadow-none transition hover:border-slate-400 hover:bg-slate-200">`,
      `<span class="truncate">${escapeHtml(part.name)}</span>`,
      `<button type="button" tabindex="-1" contenteditable="false" data-remove-prompt-attachment="${escapeHtml(part.id)}" aria-label="${t('删除引用')} ${escapeHtml(part.name)}" class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] leading-none text-slate-500 opacity-0 ring-1 ring-slate-300 transition hover:text-slate-900 group-hover:opacity-100">×</button>`,
      `</span>`,
      `<span data-prompt-mention-spacer="true" contenteditable="false" aria-hidden="true" class="inline-block w-2 align-middle">&nbsp;</span>`,
    ].join('')
  }).join('')
}

function normalizePromptParts(parts: PromptPart[]): PromptPart[] {
  const normalized: PromptPart[] = []

  parts.forEach(part => {
    if (part.type === 'text') {
      if (!part.text) return
      const previous = normalized[normalized.length - 1]
      if (previous?.type === 'text') {
        previous.text += part.text
        return
      }
    }

    normalized.push(part)
  })

  return normalized
}

function replacePromptRange(parts: PromptPart[], start: number, end: number, insertParts: PromptPart[]) {
  const nextParts: PromptPart[] = []
  let cursor = 0
  let inserted = false

  const insert = () => {
    if (inserted) return
    nextParts.push(...insertParts)
    inserted = true
  }

  parts.forEach(part => {
    const text = getPromptPartText(part)
    const partStart = cursor
    const partEnd = cursor + text.length
    cursor = partEnd

    if (partEnd <= start) {
      nextParts.push(part)
      return
    }

    if (partStart >= end) {
      insert()
      nextParts.push(part)
      return
    }

    if (part.type !== 'text') {
      if (partStart >= start && partEnd <= end) return
      insert()
      return
    }

    const leftLength = Math.max(0, start - partStart)
    const rightStart = Math.max(0, end - partStart)
    const leftText = part.text.slice(0, leftLength)
    const rightText = part.text.slice(rightStart)

    if (leftText) nextParts.push(createTextPart(leftText))
    insert()
    if (rightText) nextParts.push(createTextPart(rightText))
  })

  insert()
  return normalizePromptParts(nextParts)
}

function parsePromptEditorParts(editor: HTMLDivElement): PromptPart[] {
  const parts: PromptPart[] = []

  editor.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(createTextPart(node.textContent ?? ''))
      return
    }

    if (!(node instanceof HTMLElement)) return
    if (node.dataset.promptMentionSpacer === 'true') return

    if (node.dataset.promptMention === 'attachment') {
      parts.push({
        id: node.dataset.partId || `attachment-${crypto.randomUUID()}`,
        type: 'attachment',
        attachmentId: node.dataset.attachmentId || '',
        name: node.dataset.name || node.textContent?.replace(/^@/, '').trim() || 'attachment',
        mime: node.dataset.mime || '',
      })
      return
    }

    parts.push(createTextPart(node.textContent ?? ''))
  })

  return normalizePromptParts(parts)
}

function getEditorCursorOffset(editor: HTMLDivElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return serializePromptParts(parsePromptEditorParts(editor)).length

  const anchorNode = selection.anchorNode
  if (!anchorNode || !editor.contains(anchorNode)) return serializePromptParts(parsePromptEditorParts(editor)).length

  let offset = 0
  const childNodes = Array.from(editor.childNodes)

  for (let index = 0; index < childNodes.length; index += 1) {
    const child = childNodes[index]

    if (anchorNode === editor) {
      if (index >= selection.anchorOffset) return offset
      if (child instanceof HTMLElement && child.dataset.promptMentionSpacer === 'true') continue
      if (child instanceof HTMLElement && child.dataset.promptMention === 'attachment') {
        offset += child.dataset.serial?.length ?? child.textContent?.length ?? 0
      } else {
        offset += child.textContent?.length ?? 0
      }
      continue
    }

    if (child.contains(anchorNode)) {
      if (child instanceof HTMLElement && child.dataset.promptMention === 'attachment') {
        return offset + (child.dataset.serial?.length ?? child.textContent?.length ?? 0)
      }

      if (anchorNode.nodeType === Node.TEXT_NODE) {
        return offset + selection.anchorOffset
      }

      return offset + (child.textContent ?? '').slice(0, selection.anchorOffset).length
    }

    if (child instanceof HTMLElement && child.dataset.promptMentionSpacer === 'true') {
      continue
    }

    if (child instanceof HTMLElement && child.dataset.promptMention === 'attachment') {
      offset += child.dataset.serial?.length ?? child.textContent?.length ?? 0
    } else {
      offset += child.textContent?.length ?? 0
    }
  }

  return offset
}

function placeEditorCursorAtOffset(editor: HTMLDivElement, targetOffset: number) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  let offset = 0
  const childNodes = Array.from(editor.childNodes)

  for (let index = 0; index < childNodes.length; index += 1) {
    const child = childNodes[index]
    if (child instanceof HTMLElement && child.dataset.promptMentionSpacer === 'true') continue

    const length = child instanceof HTMLElement && child.dataset.promptMention === 'attachment'
      ? child.dataset.serial?.length ?? child.textContent?.length ?? 0
      : child.textContent?.length ?? 0

    if (targetOffset <= offset + length) {
      if (child instanceof HTMLElement && child.dataset.promptMention === 'attachment') {
        let nextIndex = index + 1
        if (targetOffset > offset && childNodes[nextIndex] instanceof HTMLElement && (childNodes[nextIndex] as HTMLElement).dataset.promptMentionSpacer === 'true') {
          nextIndex += 1
        }
        range.setStart(editor, targetOffset <= offset ? index : nextIndex)
      } else {
        const textNode = child.nodeType === Node.TEXT_NODE ? child : child.firstChild
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          range.setStart(textNode, Math.max(0, Math.min(targetOffset - offset, textNode.textContent?.length ?? 0)))
        } else {
          range.setStart(editor, index)
        }
      }

      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }

    offset += length
  }

  range.setStart(editor, editor.childNodes.length)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function revokeAttachmentPreviews(items: AttachmentItem[]) {
  items.forEach(item => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  })
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error(t('无法读取附件 {name}', { name: file.name })))
        return
      }

      const [, base64 = ''] = result.split(',', 2)
      resolve(base64)
    }
    reader.onerror = () => reject(new Error(t('无法读取附件 {name}', { name: file.name })))
    reader.readAsDataURL(file)
  })
}

export default function TaskForm({
  agents,
  templates,
  onSubmit,
  submitting = false,
  errorMessage,
}: Props) {
  const [promptParts, setPromptParts] = useState<PromptPart[]>([])
  const [promptHasContent, setPromptHasContent] = useState(false)
  const [mode, setMode] = useState<TaskMode>('ai')
  const [codeContext, setCodeContext] = useState<CodeContext[]>([])
  const [attachments, setAttachments] = useState<AttachmentItem[]>([])
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [pendingSelectedAgents, setPendingSelectedAgents] = useState<string[]>([])
  const [templateId, setTemplateId] = useState<string>('')
  const [pendingTemplateId, setPendingTemplateId] = useState<string>('')
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false)
  const [isContextModalOpen, setIsContextModalOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [browserPurpose, setBrowserPurpose] = useState<BrowserPurpose>(null)
  const [pendingContext, setPendingContext] = useState<PendingContext | null>(null)
  const [contextDesc, setContextDesc] = useState('')
  const [attachmentMention, setAttachmentMention] = useState<AttachmentMentionState | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentItemsRef = useRef<AttachmentItem[]>([])
  const promptEditorRef = useRef<HTMLDivElement | null>(null)
  const promptValueRef = useRef('')
  const isPromptComposingRef = useRef(false)

  const canSubmit = promptHasContent && !submitting
  const selectedTemplate = templates.find(template => template.id === templateId) ?? null
  const pendingTemplate = templates.find(template => template.id === pendingTemplateId) ?? null
  const hasTemplateSelection = !!selectedTemplate
  const hasAgentSelection = selectedAgents.length > 0
  const attachmentMentionItems = attachmentMention
    ? filterAttachmentMentionItems(attachments, attachmentMention.query).slice(0, 8)
    : []
  const isAttachmentMentionOpen = !!attachmentMention
  const attachmentMentionActiveIndex = attachmentMention?.activeIndex ?? 0

  const pendingCustomCount = pendingSelectedAgents.filter(name => agents.find(a => a.name === name)?.type === 'custom').length
  const pendingOmcCount = pendingSelectedAgents.filter(name => agents.find(a => a.name === name)?.type === 'omc').length

  useEffect(() => {
    if (!isAttachmentMentionOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (promptEditorRef.current?.contains(target)) return
      if (target instanceof HTMLElement && target.closest('[data-attachment-mention-popover="true"]')) return
      setAttachmentMention(null)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [isAttachmentMentionOpen])

  useEffect(() => {
    attachmentItemsRef.current = attachments
  }, [attachments])

  useEffect(() => () => {
    revokeAttachmentPreviews(attachmentItemsRef.current)
  }, [])

  const toggleAgent = (name: string) => {
    if (hasTemplateSelection) return

    setPendingSelectedAgents(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    )
  }

  const toggleContextModal = () => {
    setLocalError(null)
    setAttachmentMention(null)
    setIsContextModalOpen(current => !current)
  }

  const toggleModePanel = (nextMode: TaskMode, nextDrawer: 'template' | 'manual') => {
    if (nextMode === 'template') {
      if (hasAgentSelection) return
      setLocalError(null)
      setAttachmentMention(null)
      setPendingTemplateId(templateId)
      setIsTemplateModalOpen(true)
      return
    }

    if (nextMode === 'manual' && hasTemplateSelection) {
      return
    }
    if (nextDrawer === 'manual') {
      setLocalError(null)
      setAttachmentMention(null)
      setPendingSelectedAgents(selectedAgents)
      setIsAgentModalOpen(true)
    }
  }

  const handleSelectTemplate = (nextTemplateId: string) => {
    setPendingTemplateId(current => current === nextTemplateId ? '' : nextTemplateId)
  }

  const handleConfirmTemplate = () => {
    setTemplateId(pendingTemplateId)
    setSelectedAgents([])
    setMode(getNextMode(pendingTemplateId, []))
    setIsTemplateModalOpen(false)
  }

  const handleCloseTemplateModal = () => {
    setPendingTemplateId(templateId)
    setIsTemplateModalOpen(false)
  }

  const handleConfirmAgentSelection = () => {
    setSelectedAgents(pendingSelectedAgents)
    setMode(getNextMode(templateId, pendingSelectedAgents))
    setIsAgentModalOpen(false)
  }

  const handleCloseAgentModal = () => {
    setPendingSelectedAgents(selectedAgents)
    setIsAgentModalOpen(false)
  }

  const handleCloseContextModal = () => {
    setPendingContext(null)
    setContextDesc('')
    setIsContextModalOpen(false)
  }

  const handleRemoveTemplate = () => {
    setTemplateId('')
    setPendingTemplateId('')
    setMode(getNextMode('', selectedAgents))
  }

  const handleRemoveAgentSelection = (name: string) => {
    setSelectedAgents(prev => {
      const next = prev.filter(agentName => agentName !== name)
      setMode(getNextMode(templateId, next))
      return next
    })
    setPendingSelectedAgents(prev => prev.filter(agentName => agentName !== name))
  }

  const handleOpenAttachmentBrowser = () => {
    setLocalError(null)
    setAttachmentMention(null)
    attachmentInputRef.current?.click()
  }

  const handleSelectContext = (item: FsItem) => {
    setLocalError(null)
    setAttachmentMention(null)
    setBrowserPurpose(null)
    setPendingContext({ path: item.path, type: item.type })
    setContextDesc('')
    setIsContextModalOpen(true)
  }

  const handleSelectAttachment = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    setLocalError(null)
    setAttachments(prev => {
      const existingIds = new Set(prev.map(item => item.id))
      const nextItems = files
        .map(file => ({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          type: 'file' as const,
          size: file.size,
          mime: file.type,
          file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        }))
        .filter(item => {
          const isDuplicate = existingIds.has(item.id)
          if (isDuplicate && item.previewUrl) URL.revokeObjectURL(item.previewUrl)
          return !isDuplicate
        })

      return nextItems.length > 0 ? [...prev, ...nextItems] : prev
    })

    event.target.value = ''
  }

  const handleCloseBrowser = () => {
    setBrowserPurpose(null)
  }

  const handleAddContext = () => {
    if (!pendingContext) return
    setLocalError(null)
    const nextDescription = contextDesc.trim()
    setCodeContext(prev => {
      const existingIndex = prev.findIndex(ctx => ctx.path === pendingContext.path)
      if (existingIndex >= 0) {
        return prev.map((ctx, index) => (
          index !== existingIndex
            ? ctx
            : {
                ...ctx,
                type: pendingContext.type,
                description: nextDescription || ctx.description,
              }
        ))
      }

      return [...prev, {
        path: pendingContext.path,
        description: nextDescription,
        type: pendingContext.type,
      }]
    })
    setPendingContext(null)
    setContextDesc('')
  }

  const handleRemoveContext = (index: number) => {
    setCodeContext(prev => prev.filter((_, idx) => idx !== index))
  }

  const handleRemoveContextSelection = (path: string) => {
    setCodeContext(prev => prev.filter(ctx => ctx.path !== path))
  }

  const handleRemoveAttachment = (path: string) => {
    setAttachments(prev => {
      const next = prev.filter(item => item.id !== path)
      const removed = prev.find(item => item.id === path)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return next
    })

    const currentParts = promptEditorRef.current ? parsePromptEditorParts(promptEditorRef.current) : promptParts
    applyPromptParts(currentParts.filter(part => part.type !== 'attachment' || part.attachmentId !== path))
  }

  const syncAttachmentMention = (value: string, cursor: number) => {
    const nextMention = findAttachmentMention(value, cursor)
    if (!nextMention) {
      setAttachmentMention(null)
      return
    }

    setAttachmentMention(prev => {
      const nextItems = filterAttachmentMentionItems(attachments, nextMention.query)
      const shouldKeepActive = prev?.triggerIndex === nextMention.triggerIndex && prev.query === nextMention.query
      const activeIndex = shouldKeepActive
        ? Math.min(prev.activeIndex, Math.max(nextItems.length - 1, 0))
        : 0

      return {
        ...nextMention,
        activeIndex,
      }
    })
  }

  const focusPromptEditorAtOffset = (offset: number) => {
    requestAnimationFrame(() => {
      const editor = promptEditorRef.current
      if (!editor) return
      editor.focus()
      placeEditorCursorAtOffset(editor, offset)
    })
  }

  const updatePromptSnapshot = (nextPrompt: string) => {
    promptValueRef.current = nextPrompt
    setPromptHasContent(nextPrompt.trim().length > 0)
  }

  const applyPromptParts = (nextParts: PromptPart[], cursor?: number) => {
    const normalizedParts = normalizePromptParts(nextParts)
    const nextPrompt = serializePromptParts(normalizedParts)
    const editor = promptEditorRef.current

    setPromptParts(normalizedParts)
    if (editor) editor.innerHTML = renderPromptPartsHtml(normalizedParts)
    updatePromptSnapshot(nextPrompt)
    if (typeof cursor === 'number') focusPromptEditorAtOffset(cursor)
  }

  const commitPromptEditor = (editor: HTMLDivElement, restoreCursor = true) => {
    const cursor = getEditorCursorOffset(editor)
    const nextParts = parsePromptEditorParts(editor)
    const nextPrompt = serializePromptParts(nextParts)

    updatePromptSnapshot(nextPrompt)
    syncAttachmentMention(nextPrompt, Math.min(cursor, nextPrompt.length))
    if (restoreCursor) focusPromptEditorAtOffset(Math.min(cursor, nextPrompt.length))
  }

  const handlePromptInput = (event: FormEvent<HTMLDivElement>) => {
    if (isPromptComposingRef.current) return
    commitPromptEditor(event.currentTarget, false)
  }

  const handlePromptCompositionStart = () => {
    isPromptComposingRef.current = true
  }

  const handlePromptCompositionEnd = (event: CompositionEvent<HTMLDivElement>) => {
    isPromptComposingRef.current = false
    commitPromptEditor(event.currentTarget, false)
  }

  const handlePromptCursorChange = () => {
    const editor = promptEditorRef.current
    if (!editor) return

    syncAttachmentMention(serializePromptParts(parsePromptEditorParts(editor)), getEditorCursorOffset(editor))
  }

  const handlePromptMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>('[data-remove-prompt-attachment]')
      : null

    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    handleRemovePromptAttachment(target.dataset.removePromptAttachment || '')
  }

  const handlePromptPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!text) return

    event.preventDefault()
    insertPromptTextAtCursor(text)
  }

  const handleSelectAttachmentMention = (item: AttachmentItem) => {
    if (!attachmentMention) return

    const editor = promptEditorRef.current
    const currentParts = editor ? parsePromptEditorParts(editor) : promptParts
    const cursor = editor ? getEditorCursorOffset(editor) : serializePromptParts(currentParts).length
    const mentionPart = createAttachmentPromptPart(item)
    const nextParts = replacePromptRange(currentParts, attachmentMention.triggerIndex, cursor, [mentionPart])
    const nextCursor = attachmentMention.triggerIndex + getPromptPartText(mentionPart).length

    applyPromptParts(nextParts, nextCursor)
    setAttachmentMention(null)
  }

  const handleRemovePromptAttachment = (partId: string) => {
    const currentParts = promptEditorRef.current ? parsePromptEditorParts(promptEditorRef.current) : promptParts
    let nextCursor = 0
    const target = currentParts.find(part => {
      const isTarget = part.id === partId
      if (!isTarget) nextCursor += getPromptPartText(part).length
      return isTarget
    })

    if (target) applyPromptParts(currentParts.filter(part => part.id !== partId), nextCursor)

    setAttachmentMention(null)
  }

  const removeAttachmentPartBeforeCursor = (cursor: number) => {
    const currentParts = promptEditorRef.current ? parsePromptEditorParts(promptEditorRef.current) : promptParts
    let offset = 0

    for (const part of currentParts) {
      const partLength = getPromptPartText(part).length
      const partEnd = offset + partLength

      if (part.type === 'attachment' && partEnd === cursor) {
        applyPromptParts(replacePromptRange(currentParts, offset, partEnd, []), offset)
        setAttachmentMention(null)
        return true
      }

      offset = partEnd
    }

    return false
  }

  const insertPromptTextAtCursor = (text: string) => {
    const editor = promptEditorRef.current
    const currentParts = editor ? parsePromptEditorParts(editor) : promptParts
    const cursor = editor ? getEditorCursorOffset(editor) : serializePromptParts(currentParts).length
    const nextParts = replacePromptRange(currentParts, cursor, cursor, [createTextPart(text)])
    const nextCursor = cursor + text.length

    applyPromptParts(nextParts, nextCursor)
    syncAttachmentMention(serializePromptParts(nextParts), nextCursor)
  }

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const editor = promptEditorRef.current

    if (event.key === 'Backspace' && editor && window.getSelection()?.isCollapsed !== false) {
      const cursor = getEditorCursorOffset(editor)
      if (removeAttachmentPartBeforeCursor(cursor)) {
        event.preventDefault()
        return
      }
    }

    if (isAttachmentMentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setAttachmentMention(prev => prev
          ? { ...prev, activeIndex: attachmentMentionItems.length === 0 ? 0 : (prev.activeIndex + 1) % attachmentMentionItems.length }
          : prev
        )
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setAttachmentMention(prev => prev
          ? { ...prev, activeIndex: attachmentMentionItems.length === 0 ? 0 : (prev.activeIndex - 1 + attachmentMentionItems.length) % attachmentMentionItems.length }
          : prev
        )
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing) {
        const activeItem = attachmentMentionItems[attachmentMention?.activeIndex ?? 0]
        if (activeItem) {
          event.preventDefault()
          handleSelectAttachmentMention(activeItem)
          return
        }
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setAttachmentMention(null)
        return
      }
    }

    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return

    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      insertPromptTextAtCursor('\n')
      return
    }

    event.preventDefault()
    void handleSubmit()
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLocalError(null)
    const currentPrompt = promptEditorRef.current
      ? serializePromptParts(parsePromptEditorParts(promptEditorRef.current))
      : promptValueRef.current

    if (mode === 'template' && !templateId) {
      setLocalError(t('请选择一个模板'))
      setPendingTemplateId(templateId)
      setIsTemplateModalOpen(true)
      return
    }

    if (mode === 'manual' && selectedAgents.length === 0) {
      setLocalError(t('请至少选择一个 Agent'))
      setPendingSelectedAgents(selectedAgents)
      setIsAgentModalOpen(true)
      return
    }

    try {
      const attachmentPayload = await Promise.all(attachments.map(async item => ({
        name: item.name,
        mime: item.mime || 'application/octet-stream',
        contentBase64: await readFileAsBase64(item.file),
      })))

      await onSubmit({
        mode,
        prompt: currentPrompt,
        projectName: '',
        codeContext,
        attachments: attachmentPayload,
        requireConfirm: true,
        selectedAgents: mode === 'manual' ? agents.filter(a => selectedAgents.includes(a.name)) : undefined,
        templateId: mode === 'template' ? templateId : undefined,
      })
      revokeAttachmentPreviews(attachments)
      setPromptParts([])
      if (promptEditorRef.current) promptEditorRef.current.innerHTML = ''
      updatePromptSnapshot('')
      setCodeContext([])
      setAttachments([])
      setSelectedAgents([])
      setPendingSelectedAgents([])
      setTemplateId('')
      setPendingTemplateId('')
      setMode('ai')
      setPendingContext(null)
      setContextDesc('')
      setIsContextModalOpen(false)
      setAttachmentMention(null)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t('提交失败，请重试'))
    }
  }

  const activeError = localError ?? errorMessage

  return (
    <section className="relative w-full max-w-[calc(860px-10ch)]">
      <div className="rounded-[40px] border-[1.5px] border-black/[0.18] bg-transparent px-4 pb-4 pt-4 shadow-none md:rounded-[44px] md:px-5 md:pb-5 md:pt-5">
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleSelectAttachment}
        />

        <div className="px-1 py-0.5">
          {attachments.length > 0 && (
            <div className="mb-3">
              <SelectionRow>
                {attachments.map(item => (
                  <div
                    key={item.id}
                    className="group relative flex shrink-0 items-start gap-2 rounded-[18px] border border-slate-200 bg-transparent px-3 py-2.5 shadow-none"
                  >
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.name}
                        className="mt-0.5 h-10 w-10 rounded-[10px] border border-slate-200 object-cover"
                      />
                    ) : (
                      <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-slate-200 bg-transparent text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-600">
                        {getAttachmentBadgeLabel(item.name, item.mime)}
                      </span>
                    )}
                    <div className="min-w-0 max-w-[180px] pr-4">
                      <div className="truncate text-sm font-medium text-slate-800">{item.name}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {formatAttachmentSize(item.size)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(item.id)}
                      className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-transparent text-[11px] text-slate-400 opacity-0 transition hover:text-slate-700 group-hover:opacity-100"
                      aria-label={`${t('删除')} ${item.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </SelectionRow>
            </div>
          )}

          <SelectionMeta
            selectedTemplate={selectedTemplate}
            selectedAgentNames={selectedAgents}
            selectedCodeContext={codeContext}
            onRemoveTemplate={handleRemoveTemplate}
            onRemoveAgent={handleRemoveAgentSelection}
            onRemoveContext={handleRemoveContextSelection}
          />

          <div className="relative">
            {isAttachmentMentionOpen && (
              <div data-attachment-mention-popover="true" className="absolute bottom-full left-2 right-2 z-30 mb-2 overflow-hidden rounded-[22px] border border-black/[0.10] bg-white/95 p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur">
                <div className="px-3 pb-1.5 pt-1 text-[11px] font-medium tracking-[0.02em] text-slate-500">
                  {t('引用已上传对象')}
                </div>
                {attachmentMentionItems.length > 0 ? (
                  <div className="max-h-[236px] overflow-y-auto">
                    {attachmentMentionItems.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => {
                          setAttachmentMention(prev => prev ? { ...prev, activeIndex: index } : prev)
                        }}
                        onMouseDown={event => {
                          event.preventDefault()
                          handleSelectAttachmentMention(item)
                        }}
                        className={`flex w-full items-center gap-3 rounded-[16px] px-2.5 py-2.5 text-left transition ${
                          index === attachmentMentionActiveIndex
                            ? 'bg-slate-100 text-slate-950 ring-1 ring-slate-200'
                            : 'bg-transparent text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        {item.previewUrl ? (
                          <img
                            src={item.previewUrl}
                            alt={item.name}
                            className="h-10 w-10 shrink-0 rounded-[12px] border border-black/[0.08] object-cover"
                          />
                        ) : (
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border text-[10px] font-semibold uppercase tracking-[0.05em] ${
                            index === attachmentMentionActiveIndex
                              ? 'border-slate-300 text-slate-700'
                              : 'border-slate-200 text-slate-600'
                          }`}>
                            {getAttachmentBadgeLabel(item.name, item.mime)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{item.name}</span>
                          <span className={`mt-0.5 block text-[11px] ${
                            index === attachmentMentionActiveIndex ? 'text-slate-500' : 'text-slate-500'
                          }`}>
                            {getAttachmentMentionLabel(item)} · {formatAttachmentSize(item.size)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[16px] px-3 py-3 text-sm text-slate-500">
                    {t('暂无可引用的图片或文件')}
                  </div>
                )}
              </div>
            )}

            <div className="relative">
              {!promptHasContent && (
                <div className="pointer-events-none absolute inset-x-0 top-0 px-2 text-[0.95rem] leading-7 tracking-[-0.025em] text-slate-400 md:text-[1.04rem] md:leading-8">
                  {t('说说你的想法...')}
                </div>
              )}
              <div
                ref={promptEditorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                spellCheck={false}
                onInput={handlePromptInput}
                onKeyDown={handlePromptKeyDown}
                onCompositionStart={handlePromptCompositionStart}
                onCompositionEnd={handlePromptCompositionEnd}
                onKeyUp={handlePromptCursorChange}
                onMouseDown={handlePromptMouseDown}
                onMouseUp={handlePromptCursorChange}
                onPaste={handlePromptPaste}
                className="block min-h-[84px] w-full whitespace-pre-wrap break-words border-0 bg-transparent px-2 text-[0.95rem] leading-7 tracking-[-0.025em] text-slate-900 outline-none md:min-h-[96px] md:text-[1.04rem] md:leading-8"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleOpenAttachmentBrowser}
              className={`flex h-10 w-10 items-center justify-center rounded-full border text-[1.2rem] leading-none transition ${
                codeContext.length > 0
                  ? 'border-slate-300 bg-transparent text-slate-900 shadow-none'
                  : 'border-slate-200 bg-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900'
              }`}
              aria-label={t('添加代码路径')}
            >
              +
            </button>
            <ToolbarChip
              label={t('模板')}
              icon={<TemplateIcon />}
              active={isTemplateModalOpen || (mode === 'template' && !!templateId)}
              disabled={hasAgentSelection}
              onClick={() => toggleModePanel('template', 'template')}
            />
            <ToolbarChip
              label="Agent"
              icon={<ManualIcon />}
              active={isAgentModalOpen || (mode === 'manual' && selectedAgents.length > 0)}
              disabled={hasTemplateSelection}
              onClick={() => toggleModePanel('manual', 'manual')}
            />
            <ToolbarChip
              label={`${t('代码')}${codeContext.length > 0 ? ` ${codeContext.length}` : ''}`}
              icon={<ContextIcon />}
              active={isContextModalOpen || !!pendingContext || codeContext.length > 0}
              onClick={toggleContextModal}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-black bg-black text-[1.05rem] text-white shadow-none transition hover:scale-[1.02] hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
              ) : (
                '↑'
              )}
            </button>
          </div>
        </div>
      </div>

      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <div className="w-full max-w-[760px] rounded-[34px] border border-black/[0.08] bg-[rgb(247,248,253)] p-5 shadow-none md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[1.25rem] font-semibold tracking-[-0.03em] text-slate-950">{t('模板选择')}</h3>
              </div>
              <button
                type="button"
                onClick={handleCloseTemplateModal}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-transparent text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
                aria-label={t('关闭模板弹窗')}
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-2.5">
              {templates.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleSelectTemplate(template.id)}
                  className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                    pendingTemplateId === template.id
                      ? 'border-slate-900 bg-transparent text-slate-950 shadow-none'
                      : 'border-slate-200 bg-transparent text-slate-700 hover:border-slate-300 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className={`text-sm ${pendingTemplateId === template.id ? 'font-semibold' : 'font-medium'}`}>{t(template.name)}</div>
                      <div className={`mt-1 text-xs leading-5 ${
                        pendingTemplateId === template.id ? 'text-slate-600' : 'text-slate-500'
                      }`}>
                        {template.description?.trim() ? t(template.description.trim()) : t('未填写模板描述')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        pendingTemplateId === template.id ? 'bg-transparent text-slate-700' : 'bg-transparent text-slate-500'
                      }`}>
                        {template.nodes.length} {t('节点')}
                      </div>
                      <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                        pendingTemplateId === template.id
                          ? 'border-slate-900 bg-transparent text-slate-900'
                          : 'border-slate-300 bg-transparent text-transparent'
                      }`}>
                        ✓
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="min-h-[20px] text-sm text-slate-500">
                {pendingTemplate ? `${t('已选中：')}${t(pendingTemplate.name)}` : t('暂未选择模板')}
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleCloseTemplateModal}
                  className="rounded-full border border-slate-200 bg-transparent px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  {t('取消')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTemplate}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  {t('确认')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAgentModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <div className="w-full max-w-[760px] rounded-[34px] border border-black/[0.08] bg-[rgb(247,248,253)] p-5 shadow-none md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[1.25rem] font-semibold tracking-[-0.03em] text-slate-950">{t('Agent 选择')}</h3>
              </div>
              <button
                type="button"
                onClick={handleCloseAgentModal}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-transparent text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
                aria-label={t('关闭 Agent 弹窗')}
              >
                ×
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
              <span className="rounded-full border border-slate-200 bg-transparent px-3 py-1">{t('自定义')} {pendingCustomCount}</span>
              <span className="rounded-full border border-slate-200 bg-transparent px-3 py-1">OMC {pendingOmcCount}</span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {(['custom', 'omc'] as const).map(type => {
                const pool = agents.filter(agent => agent.type === type)
                return (
                  <div key={type} className="rounded-[24px] border border-slate-200 bg-transparent p-4 shadow-none">
                    <div className="mb-3 text-sm font-semibold text-slate-900">
                      {type === 'custom' ? t('自定义 Agent') : t('OMC 内置 Agent')}
                    </div>
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-3">
                      {pool.map(agent => {
                        const checked = pendingSelectedAgents.includes(agent.name)
                        return (
                          <button
                            key={agent.name}
                            type="button"
                            onClick={() => toggleAgent(agent.name)}
                            className={`flex w-full items-start gap-3 rounded-[18px] border px-3 py-3 text-left transition ${
                              checked
                                ? 'border-slate-900 bg-transparent text-slate-950 shadow-none'
                                : 'border-slate-200 bg-transparent text-slate-700 hover:border-slate-300'
                            }`}
                          >
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                              checked
                                ? 'border-slate-900 bg-transparent text-slate-900'
                                : 'border-slate-300 bg-transparent text-transparent'
                            }`}>
                              ✓
                            </span>
                            <div className="min-w-0">
                              <div className={`text-sm ${checked ? 'font-semibold' : 'font-medium'}`}>{agent.name}</div>
                              <div className={`mt-1 truncate text-xs leading-5 ${
                                checked ? 'text-slate-600' : 'text-slate-500'
                              }`}>
                                {getAgentDisplayDescription(agent)}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="min-h-[20px] text-sm text-slate-500">
                {pendingSelectedAgents.length > 0 ? t('已选中 {n} 个 Agent', { n: pendingSelectedAgents.length }) : t('暂未选择 Agent')}
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleCloseAgentModal}
                  className="rounded-full border border-slate-200 bg-transparent px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  {t('取消')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAgentSelection}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  {t('确认')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isContextModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <div className="w-full max-w-[760px] rounded-[34px] border border-black/[0.08] bg-[rgb(247,248,253)] p-5 shadow-none md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[1.25rem] font-semibold tracking-[-0.03em] text-slate-950">{t('代码选择')}</h3>
              </div>
              <button
                type="button"
                onClick={handleCloseContextModal}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-transparent text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
                aria-label={t('关闭代码弹窗')}
              >
                ×
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-500">
                {codeContext.length > 0 ? t('已添加 {n} 项代码路径', { n: codeContext.length }) : t('还没有添加代码路径')}
              </div>
              <button
                onClick={() => setBrowserPurpose('context')}
                className="rounded-full border border-slate-200 bg-transparent px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                {t('+ 添加路径')}
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {pendingContext && (
                <div className="rounded-[22px] border border-slate-200 bg-transparent px-4 py-4 shadow-none">
                  <div className="truncate font-mono text-xs text-slate-700">{pendingContext.path}</div>
                  <input
                    value={contextDesc}
                    onChange={e => setContextDesc(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddContext()}
                    placeholder={t('补充说明（可选）...')}
                    className="field-input mt-3 text-sm"
                  />
                  <div className="mt-3 flex gap-2">
                    <button onClick={handleAddContext} className="btn-primary flex-1">{t('添加')}</button>
                    <button onClick={() => { setPendingContext(null); setContextDesc('') }} className="btn-secondary">{t('取消')}</button>
                  </div>
                </div>
              )}

              {codeContext.length > 0 ? (
                <div className="space-y-2">
                  {codeContext.map((ctx, index) => (
                    <div key={`${ctx.path}-${index}`} className="flex items-start gap-3 rounded-[20px] border border-slate-200 bg-transparent px-4 py-3 shadow-none">
                      <span className="mt-0.5 text-base">{ctx.type === 'directory' ? '📁' : '📄'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs text-slate-700">{ctx.path}</div>
                        {ctx.description && <div className="mt-1 text-xs text-slate-500">{ctx.description}</div>}
                      </div>
                      <button onClick={() => handleRemoveContext(index)} className="text-xs font-medium text-slate-400 transition hover:text-rose-500">
                        {t('移除')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : !pendingContext ? (
                <div className="rounded-[22px] border border-dashed border-slate-300 bg-transparent px-4 py-10 text-center text-sm text-slate-400">
                  {t('还没有添加代码路径')}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-end">
              <button
                type="button"
                onClick={handleCloseContextModal}
                className="rounded-full border border-slate-200 bg-transparent px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                {t('完成')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeError && (
        <div className="absolute left-0 right-0 top-full z-10 mt-3 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 shadow-sm">
          {activeError}
        </div>
      )}

      {browserPurpose && (
        <FileBrowserDialog
          onSelect={handleSelectContext}
          onCancel={handleCloseBrowser}
          selectionMode="any"
          title={t('选择代码路径')}
          subtitle={t('支持单选文件或目录。')}
        />
      )}
    </section>
  )
}
