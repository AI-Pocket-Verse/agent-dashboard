import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import { githubGist } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript'
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml'
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css'
import scss from 'react-syntax-highlighter/dist/esm/languages/hljs/scss'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go'
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust'
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java'
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml'
import MarkdownText from '../MarkdownText/index'

SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('xml', xml)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('scss', scss)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('yaml', yaml)

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml',
  css: 'css', scss: 'scss', less: 'scss',
  json: 'json', jsonc: 'json',
  py: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  go: 'go',
  rs: 'rust',
  java: 'java',
  sql: 'sql',
  yaml: 'yaml', yml: 'yaml',
  toml: 'yaml',
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'])
const MARKDOWN_EXTS = new Set(['md', 'mdx'])

function getExt(path: string) {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

interface Props {
  path: string
  content: string
  isBinary: boolean
  truncated: boolean
  rawUrl: string
}

export default function FileViewer({ path, content, isBinary, truncated, rawUrl }: Props) {
  const ext = getExt(path)

  if (truncated) {
    return (
      <div className="p-4 text-sm text-slate-500">
        文件超过 1 MB，暂不展示完整内容。
      </div>
    )
  }

  if (IMAGE_EXTS.has(ext)) {
    return (
      <div className="flex items-center justify-center p-4">
        <img
          src={rawUrl}
          alt={path}
          className="max-h-[70vh] max-w-full object-contain"
        />
      </div>
    )
  }

  if (isBinary) {
    return (
      <div className="p-4 text-sm text-slate-500">
        这是二进制文件，暂不展示内容。
      </div>
    )
  }

  if (MARKDOWN_EXTS.has(ext)) {
    return (
      <div className="min-h-full p-5 text-sm leading-7 text-slate-700">
        <MarkdownText text={content} />
      </div>
    )
  }

  const lang = EXT_TO_LANG[ext]
  if (lang) {
    return (
      <SyntaxHighlighter
        language={lang}
        style={githubGist}
        showLineNumbers
        lineNumberStyle={{ color: '#cbd5e1', fontSize: '11px', minWidth: '2.5em', userSelect: 'none' }}
        customStyle={{ background: 'transparent', margin: 0, padding: '1rem', fontSize: '12px', lineHeight: '1.6' }}
      >
        {content}
      </SyntaxHighlighter>
    )
  }

  return (
    <pre className="min-h-full overflow-x-auto whitespace-pre p-4 font-mono text-xs leading-6 text-slate-700">
      {content}
    </pre>
  )
}
