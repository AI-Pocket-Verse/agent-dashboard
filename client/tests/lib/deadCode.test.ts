import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (p: string) => resolve(__dirname, '../../src', p)

// 防回退：旧版 Runner 页与 WorkflowDAG 组件已无任何引用，被删除后不应再回来
describe('removed dead code stays removed', () => {
  it('does not bring back the unused Runner page and WorkflowDAG component', () => {
    expect(existsSync(src('pages/Runner.tsx'))).toBe(false)
    expect(existsSync(src('components/WorkflowDAG'))).toBe(false)
  })

  it('does not keep i18n entries and styles that only the removed files used', () => {
    const i18n = readFileSync(src('lib/i18n.ts'), 'utf8')
    expect(i18n).not.toContain("'条日志'")
    expect(i18n).not.toContain('去 Dashboard 发起一个新的协作流程')
    expect(readFileSync(src('index.css'), 'utf8')).not.toContain('.section-kicker')
  })
})
