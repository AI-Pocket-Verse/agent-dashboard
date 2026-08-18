import { useEffect } from 'react'
import MarkdownText from '../MarkdownText/index'

interface Props {
  text: string
  className?: string
  renderMarkdown?: boolean
  onProgress?: () => void
}

export default function StreamingText({ text, className, renderMarkdown = false, onProgress }: Props) {
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
