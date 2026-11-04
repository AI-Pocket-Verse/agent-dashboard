import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DialogShell from '../../src/components/DialogShell/index'

const overlayOf = (el: HTMLElement) => el.closest('.fixed') as HTMLElement

describe('DialogShell backdrop', () => {
  it('renders into document.body so transformed ancestors cannot clip it', () => {
    render(
      <div style={{ transform: 'translateY(-100px)' }} data-testid="host">
        <DialogShell open onClose={vi.fn()} title="T"><input aria-label="field" /></DialogShell>
      </div>
    )
    const overlay = overlayOf(screen.getByLabelText('field'))

    expect(overlay.parentElement).toBe(document.body)
    expect(screen.getByTestId('host').contains(overlay)).toBe(false)
  })

  it('does not close when a drag that started in an input ends on the backdrop', () => {
    const onClose = vi.fn()
    render(<DialogShell open onClose={onClose} title="T"><input aria-label="field" /></DialogShell>)
    const input = screen.getByLabelText('field')
    const overlay = overlayOf(input)

    fireEvent.mouseDown(input)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when mousedown and click both land on the backdrop', () => {
    const onClose = vi.fn()
    render(<DialogShell open onClose={onClose} title="T"><input aria-label="field" /></DialogShell>)
    const overlay = overlayOf(screen.getByLabelText('field'))

    fireEvent.mouseDown(overlay)
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close on a click inside the panel', () => {
    const onClose = vi.fn()
    render(<DialogShell open onClose={onClose} title="T"><input aria-label="field" /></DialogShell>)
    const input = screen.getByLabelText('field')

    fireEvent.mouseDown(input)
    fireEvent.click(input)

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('DialogShell Escape', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<DialogShell open onClose={onClose} title="T"><div>body</div></DialogShell>)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('only closes the topmost dialog', () => {
    const lower = vi.fn()
    const upper = vi.fn()
    render(
      <>
        <DialogShell open onClose={lower} title="lower"><div>a</div></DialogShell>
        <DialogShell open onClose={upper} title="upper"><div>b</div></DialogShell>
      </>
    )

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(upper).toHaveBeenCalledTimes(1)
    expect(lower).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted or closed', () => {
    const onClose = vi.fn()
    const { rerender, unmount } = render(<DialogShell open onClose={onClose} title="T"><div>a</div></DialogShell>)

    rerender(<DialogShell open={false} onClose={onClose} title="T"><div>a</div></DialogShell>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    rerender(<DialogShell open onClose={onClose} title="T"><div>a</div></DialogShell>)
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores Escape during IME composition', () => {
    const onClose = vi.fn()
    render(<DialogShell open onClose={onClose} title="T"><div>a</div></DialogShell>)

    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })

    expect(onClose).not.toHaveBeenCalled()
  })
})
