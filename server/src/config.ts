import 'dotenv/config'
import { join } from 'path'

function required(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Missing required env var: ${name}`)
  return val
}

const projectRoot = required('PROJECT_ROOT')

export const config = {
  // Empty secret = open local mode: HTTP/WS auth disabled, no login gate.
  // Any non-localhost deployment must set DASHBOARD_SECRET.
  secret: process.env.DASHBOARD_SECRET ?? '',
  projectRoot,
  workspaceRoot: process.env.WORKSPACE_ROOT ?? join(projectRoot, 'workspace'),
  claudeBin: process.env.CLAUDE_BIN ?? 'claude',
  port: parseInt(process.env.PORT ?? '3001', 10),
}
