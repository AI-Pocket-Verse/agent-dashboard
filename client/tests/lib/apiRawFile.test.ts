import axios, { type InternalAxiosRequestConfig } from 'axios'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

// 在 api 模块创建 axios 实例之前换掉默认 adapter，捕获真实发出的请求配置
const captured: InternalAxiosRequestConfig[] = []
const originalAdapter = axios.defaults.adapter

let api: typeof import('../../src/lib/api').api

beforeAll(async () => {
  axios.defaults.adapter = async config => {
    captured.push(config)
    return { data: new Blob(['png-bytes']), status: 200, statusText: 'OK', headers: {}, config }
  }
  ;({ api } = await import('../../src/lib/api'))
})

afterEach(() => {
  captured.length = 0
  localStorage.clear()
})

describe('api.getRunFileBlob', () => {
  it('requests the raw file as a blob with the Authorization header and no secret in the URL', async () => {
    localStorage.setItem('dashboard_token', 'secret-token')

    const blob = await api.getRunFileBlob('run-1', 'assets/my pic.png')

    expect(blob).toBeInstanceOf(Blob)
    expect(captured).toHaveLength(1)
    const config = captured[0]
    expect(config.responseType).toBe('blob')
    expect(config.headers.Authorization).toBe('Bearer secret-token')
    expect(config.url).toBe('/fs/runs/run-1/raw')
    expect(config.params).toEqual({ path: 'assets/my pic.png' })
    expect(`${config.baseURL}${config.url}`).not.toContain('secret-token')
  })
})

// 恢复 axios 默认值，避免影响同进程内的其他测试文件
afterAll(() => {
  axios.defaults.adapter = originalAdapter
})
