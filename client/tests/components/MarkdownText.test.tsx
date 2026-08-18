import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MarkdownText from '../../src/components/MarkdownText/index'

describe('MarkdownText', () => {
  it('renders GFM tables and line breaks', () => {
    render(<MarkdownText text={'| 文件 | 状态 |\n| --- | --- |\n| app.ts | 完成 |\n\n第一行\n第二行'} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(screen.getByText(/第一行/).innerHTML).toContain('<br')
  })
})
