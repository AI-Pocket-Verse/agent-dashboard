import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FileViewer from '../../src/components/FileViewer/index'

const apiMocks = vi.hoisted(() => ({ getRunFileBlob: vi.fn() }))

vi.mock('../../src/lib/api', () => ({
  api: { getRunFileBlob: (...args: unknown[]) => apiMocks.getRunFileBlob(...args) },
}))

let urlCounter = 0
const createObjectURL = vi.fn()
const revokeObjectURL = vi.fn()

beforeEach(() => {
  urlCounter = 0
  createObjectURL.mockReset()
  createObjectURL.mockImplementation(() => `blob:mock-${++urlCounter}`)
  revokeObjectURL.mockReset()
  apiMocks.getRunFileBlob.mockReset()
  // jsdom 没有这两个静态方法
  Object.assign(URL, { createObjectURL, revokeObjectURL })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const imageProps = { content: '', isBinary: true, truncated: false }

describe('FileViewer image preview', () => {
  it('fetches the image through the authenticated api and shows it from a blob: URL', async () => {
    apiMocks.getRunFileBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))

    render(<FileViewer runId="run-1" path="assets/pic.png" {...imageProps} />)
    expect(screen.getByText('图片加载中...')).toBeInTheDocument()

    const img = await screen.findByRole('img')
    expect(apiMocks.getRunFileBlob).toHaveBeenCalledWith('run-1', 'assets/pic.png')
    expect(img).toHaveAttribute('src', 'blob:mock-1')
    expect(img.getAttribute('src')).not.toContain('/api/')
    expect(screen.queryByText('图片加载中...')).not.toBeInTheDocument()
  })

  it('revokes the blob URL on unmount', async () => {
    apiMocks.getRunFileBlob.mockResolvedValue(new Blob(['x']))
    const { unmount } = render(<FileViewer runId="run-1" path="pic.png" {...imageProps} />)
    await screen.findByRole('img')

    unmount()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })

  it('revokes the previous blob URL when switching to another file', async () => {
    apiMocks.getRunFileBlob.mockResolvedValue(new Blob(['x']))
    const { rerender } = render(<FileViewer runId="run-1" path="a.png" {...imageProps} />)
    await screen.findByRole('img')

    rerender(<FileViewer runId="run-1" path="b.png" {...imageProps} />)

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:mock-2')
  })

  it('shows the failure with the HTTP status code instead of a broken image', async () => {
    apiMocks.getRunFileBlob.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 401 } }))

    render(<FileViewer runId="run-1" path="pic.png" {...imageProps} />)

    expect(await screen.findByText('图片加载失败')).toBeInTheDocument()
    expect(screen.getByText(/401/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('only accepts the latest request when two images resolve out of order', async () => {
    const first = deferred<Blob>()
    const second = deferred<Blob>()
    apiMocks.getRunFileBlob.mockImplementation((_runId: string, path: string) => (path === 'a.png' ? first.promise : second.promise))

    const { rerender } = render(<FileViewer runId="run-1" path="a.png" {...imageProps} />)
    rerender(<FileViewer runId="run-1" path="b.png" {...imageProps} />)

    await act(async () => { second.resolve(new Blob(['b'])) })
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:mock-1')

    // 先发出的请求最后才返回：不得覆盖，也不得创建新的 blob URL
    await act(async () => { first.resolve(new Blob(['a'])) })
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:mock-1')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('does not request anything for non-image files', () => {
    render(<FileViewer runId="run-1" path="note.txt" content="hello" isBinary={false} truncated={false} />)

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(apiMocks.getRunFileBlob).not.toHaveBeenCalled()
  })
})
