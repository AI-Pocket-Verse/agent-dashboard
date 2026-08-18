import { useEffect } from 'react'
import MarkdownText from '../MarkdownText/index'

interface Props {
  text: string
  className?: string
  speedMs?: number
  chunkSize?: number
  showCursor?: boolean
  renderMarkdown?: boolean
  onProgress?: () => void
}

export default function StreamingText({
  text,
  className,
  speedMs: _speedMs = 12,
  chunkSize: _chunkSize = 3,
  showCursor: _showCursor = false,
  renderMarkdown = false,
  onProgress,
}: Props) {
  useEffect(() => {
    onProgress?.()
  }, [onProgress, text])

  if (renderMarkdown) {
    return (
      <div className={className}>
        <MarkdownText text={text} />
      </div>
    )
  }

  return (
    <span className={className}>
      {text}
    </span>
  )
}
