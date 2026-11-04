import { describe, expect, it } from 'vitest'
import { BUILTIN_TEMPLATES as SHARED_TEMPLATES } from '@agent-dashboard/shared'
import { BUILTIN_TEMPLATES as CLIENT_TEMPLATES } from '../../src/lib/builtinTemplates'
import { BUILTIN_TEMPLATES as SERVER_TEMPLATES } from '../../../server/src/workflows/templates'

// 内置模板只允许有一份定义（shared/templates.ts），前后端各自导出的只是同一份数据的再导出
describe('builtin templates single source of truth', () => {
  it('client and server expose the same templates as shared', () => {
    expect(CLIENT_TEMPLATES).toBe(SHARED_TEMPLATES)
    expect(SERVER_TEMPLATES).toBe(SHARED_TEMPLATES)
  })

  it('client and server agree on ids, nodes and edges', () => {
    const pick = (list: typeof CLIENT_TEMPLATES) => list.map(({ id, nodes, edges }) => ({ id, nodes, edges }))
    expect(pick(CLIENT_TEMPLATES)).toEqual(pick(SERVER_TEMPLATES))
    expect(CLIENT_TEMPLATES.map(tpl => tpl.id)).toEqual([
      'builtin-fullstack',
      'builtin-bugfix',
      'builtin-mobile',
      'builtin-fullflow',
    ])
  })
})
