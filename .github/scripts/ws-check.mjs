// WebSocket auth checks for the Docker smoke test (Node 22 global WebSocket).
// usage: node ws-check.mjs <ws-url> <secret>
const [url, secret] = process.argv.slice(2)
const PROTOCOL = 'agent-dashboard'
const authProtocol = value => `auth.${Buffer.from(value).toString('base64url')}`

// 握手成功不代表通过鉴权：服务端在握手后才以 4401 关闭，所以 open 后再等一段时间，仍然连着才算通过
function attempt(target, protocols) {
  return new Promise(resolve => {
    const ws = new WebSocket(target, protocols)
    const timer = setTimeout(() => { ws.close(); resolve({ result: 'timeout' }) }, 5000)
    ws.onopen = () => {
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        clearTimeout(timer)
        const protocol = ws.protocol
        ws.onclose = null
        ws.close()
        resolve({ result: 'open', protocol })
      }, 500)
    }
    ws.onclose = event => { clearTimeout(timer); resolve({ result: 'closed', code: event.code }) }
    ws.onerror = () => {}
  })
}

function expect(name, actual, expected) {
  const ok = Object.entries(expected).every(([key, value]) => actual[key] === value)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`)
  if (!ok) process.exitCode = 1
}

expect('ws with the secret in the subprotocol', await attempt(url, [PROTOCOL, authProtocol(secret)]), { result: 'open', protocol: PROTOCOL })
expect('ws with a wrong secret', await attempt(url, [PROTOCOL, authProtocol('wrong')]), { result: 'closed', code: 4401 })
expect('ws with the secret only in the query string', await attempt(`${url}?secret=${encodeURIComponent(secret)}`, [PROTOCOL]), { result: 'closed', code: 4401 })
