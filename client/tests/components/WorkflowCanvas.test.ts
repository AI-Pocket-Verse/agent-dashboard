import { describe, expect, it } from 'vitest'
import {
  createWorkflowCanvasEdge,
  workflowEdgeMarker,
  workflowNodeStyle,
} from '../../src/components/WorkflowCanvas/index'

describe('WorkflowCanvas shared helpers', () => {
  it('creates the same canvas edge shape used by template and runner flows', () => {
    const edge = createWorkflowCanvasEdge('planner', 'coder', 'edge-1')

    expect(edge).toMatchObject({
      id: 'edge-1',
      source: 'planner',
      target: 'coder',
      type: 'canvasbezier',
      reconnectable: true,
      interactionWidth: 44,
    })
  })

  it('uses selected node shadow consistently', () => {
    expect(workflowNodeStyle('custom', true).boxShadow).toContain('rgba(17,17,20,0.08)')
    expect(workflowEdgeMarker().type).toBe('arrowclosed')
  })
})
