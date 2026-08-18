import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

interface Props {
  text: string
}

export default function MarkdownText({ text }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        h1: ({ children }) => <h1 className="mb-2 mt-1 text-[1.15em] font-semibold leading-7 text-slate-900">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-1 text-[1.08em] font-semibold leading-7 text-slate-900">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1.5 mt-1 font-semibold leading-6 text-slate-800">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-1.5 mt-1 font-semibold leading-6 text-slate-800">{children}</h4>,
        p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-blue-600 underline decoration-blue-300 underline-offset-2"
          >
            {children}
          </a>
        ),
        code: ({ children, className }) => {
          const isBlock = Boolean(className)
          if (isBlock) {
            return <code className={className}>{children}</code>
          }
          return (
            <code className="rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800">
              {children}
            </code>
          )
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[0.88em] leading-5 text-slate-700">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full border-collapse text-left text-[0.92em]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-slate-50 text-slate-700">{children}</thead>,
        th: ({ children }) => <th className="border-b border-slate-200 px-3 py-2 font-semibold">{children}</th>,
        td: ({ children }) => <td className="border-t border-slate-100 px-3 py-2 align-top">{children}</td>,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-4 border-slate-200 pl-3 text-slate-600">{children}</blockquote>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
