import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AgentCard from '../../src/components/AgentCard/index'

describe('AgentCard', () => {
  it('shows agent name and idle status', () => {
    render(<AgentCard agent={{ name: 'backend-dev', type: 'custom', description: 'Go', status: 'idle' }} />)
    expect(screen.getByText('backend-dev')).toBeInTheDocument()
    expect(screen.getByText('IDLE')).toBeInTheDocument()
  })

  it('shows running status with log snippet', () => {
    render(<AgentCard agent={{ name: 'frontend-dev', type: 'custom', description: 'React', status: 'running' }} lastLog="Writing ProfilePage..." />)
    expect(screen.getByText('RUNNING')).toBeInTheDocument()
    expect(screen.getByText('Writing ProfilePage...')).toBeInTheDocument()
  })

  it('distinguishes omc vs custom agents visually', () => {
    const { container } = render(<AgentCard agent={{ name: 'planner', type: 'omc', description: '需求规划', status: 'idle' }} />)
    expect(container.querySelector('[data-type="omc"]')).toBeInTheDocument()
  })
})
