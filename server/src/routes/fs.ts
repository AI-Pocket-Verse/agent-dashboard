import type { FastifyPluginAsync } from 'fastify'
import { readdirSync, statSync, existsSync, readFileSync } from 'fs'
import { join, dirname, resolve, relative, sep, isAbsolute } from 'path'
import { config } from '../config.js'
import type { PersistenceStore } from '../store/persistence.js'

interface FsItem {
  name: string
  type: 'file' | 'directory'
  path: string
}

interface RunWorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
}

interface FsRouteOptions {
  store?: PersistenceStore
}

const IGNORED_RUN_DIRS = new Set(['node_modules'])
const MAX_TEXT_FILE_BYTES = 1024 * 1024

function isPathInside(parent: string, child: string) {
  const rel = relative(parent, child)
  // 只有 rel 恰为 `..`、以 `..` + 分隔符开头或为绝对路径才算越界；`..foo` 之类的合法文件名不受影响
  const escapes = rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)
  return !escapes
}

function normalizeWorkspacePath(path: string) {
  return path.replace(/^\/+/, '').replace(/\\/g, '/')
}

async function resolveRunWorkspaceDir(runId: string, store?: PersistenceStore) {
  const run = await store?.loadRun(runId)
  const workspacePath = normalizeWorkspacePath(run?.workspacePath || `runs/${runId}/repo`)
  const root = resolve(config.workspaceRoot)
  const runDir = resolve(root, workspacePath)
  if (!isPathInside(root, runDir)) return null
  return runDir
}

function listRunDirEntries(rootDir: string, dirAbs: string): RunWorkspaceEntry[] {
  const entries = readdirSync(dirAbs, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .filter(entry => !(entry.isDirectory() && IGNORED_RUN_DIRS.has(entry.name)))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return entries
    .map(entry => {
      const absolutePath = join(dirAbs, entry.name)
      const relPath = relative(rootDir, absolutePath).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relPath,
          type: 'directory' as const,
          size: 0,
          modifiedAt: 0,
        }
      }
      if (!entry.isFile()) return null
      const stat = statSync(absolutePath)
      return {
        name: entry.name,
        path: relPath,
        type: 'file' as const,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      }
    })
    .filter((entry): entry is RunWorkspaceEntry => entry !== null)
}

function looksBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000))
  return sample.includes(0)
}

interface PreviewCandidate {
  absolutePath: string
  relPath: string
  depth: number
  isIndex: boolean
  isPrototype: boolean
  hasClientAncestor: boolean
}

const PREVIEW_HTML_MAX_DEPTH = 8
const PROTOTYPE_HINT_REGEX = /(prototype|mockup|preview|wireframe|原型|交付)/i

function findPreviewHtml(rootDir: string): PreviewCandidate | null {
  const candidates: PreviewCandidate[] = []

  function visit(dir: string, depth: number, hasClientAncestor: boolean) {
    if (depth > PREVIEW_HTML_MAX_DEPTH) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory() && IGNORED_RUN_DIRS.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        const nextHasClient = hasClientAncestor || /^(client|web|frontend)$/i.test(entry.name)
        visit(abs, depth + 1, nextHasClient)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.html')) continue
      const relPath = relative(rootDir, abs).replace(/\\/g, '/')
      candidates.push({
        absolutePath: abs,
        relPath,
        depth,
        isIndex: entry.name.toLowerCase() === 'index.html',
        isPrototype: PROTOTYPE_HINT_REGEX.test(relPath),
        hasClientAncestor,
      })
    }
  }

  visit(rootDir, 0, false)
  if (candidates.length === 0) return null

  // Priority: web `index.html` first, then prototype-named html, then any other html.
  // Within each group, prefer shallower paths.
  candidates.sort((a, b) => {
    const aWebIndex = a.isIndex && a.hasClientAncestor
    const bWebIndex = b.isIndex && b.hasClientAncestor
    if (aWebIndex !== bWebIndex) return aWebIndex ? -1 : 1
    if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1
    if (a.isPrototype !== b.isPrototype) return a.isPrototype ? -1 : 1
    if (a.depth !== b.depth) return a.depth - b.depth
    return a.relPath.localeCompare(b.relPath)
  })

  return candidates[0]
}

function getBrowseRoots(): string[] {
  const roots = [config.projectRoot, config.workspaceRoot]
  if (process.env.HOME) roots.push(process.env.HOME)
  return roots.map(root => resolve(root))
}

function isBrowsablePath(path: string): boolean {
  const resolved = resolve(path)
  if (!getBrowseRoots().some(root => isPathInside(root, resolved))) return false
  // Deny hidden segments (.ssh, .env, …) — the listing hides dotfiles, requests must too
  return !resolved.split(sep).some(segment => segment.startsWith('.'))
}

const fsRoute: FastifyPluginAsync<FsRouteOptions> = async (fastify, opts) => {
  // Browse filesystem — returns items in a directory, restricted to known roots
  fastify.get<{ Querystring: { path?: string } }>('/api/fs/browse', async (req, reply) => {
    const reqPath = req.query.path ?? config.projectRoot
    if (!isBrowsablePath(reqPath)) {
      return reply.status(403).send({ error: 'Path outside allowed roots' })
    }
    if (!existsSync(reqPath)) {
      return reply.status(404).send({ error: 'Path not found' })
    }

    let stat
    try { stat = statSync(reqPath) } catch {
      return reply.status(400).send({ error: 'Cannot stat path' })
    }

    if (!stat.isDirectory()) {
      // Return the file itself as a single item
      return {
        path: reqPath,
        parent: dirname(reqPath),
        items: [],
        isFile: true,
      }
    }

    let names: string[]
    try { names = readdirSync(reqPath) } catch {
      return reply.status(403).send({ error: 'Cannot read directory' })
    }

    const items: FsItem[] = names
      .filter(n => !n.startsWith('.'))   // hide dotfiles
      .map(name => {
        const fullPath = join(reqPath, name)
        let type: 'file' | 'directory' = 'file'
        try { if (statSync(fullPath).isDirectory()) type = 'directory' } catch { /* skip */ }
        return { name, type, path: fullPath }
      })
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return { path: reqPath, parent: dirname(reqPath), items, isFile: false }
  })

  // Return default start paths for the file browser
  fastify.get('/api/fs/roots', async () => ({
    projectRoot: config.projectRoot,
    home: process.env.HOME ?? '/',
  }))

  fastify.get<{
    Params: { runId: string }
    Querystring: { path?: string }
  }>('/api/fs/runs/:runId/files', async (req, reply) => {
    const runDir = await resolveRunWorkspaceDir(req.params.runId, opts.store)
    if (!runDir || !existsSync(runDir)) {
      return reply.status(404).send({ error: 'Run workspace not found' })
    }

    const subPath = normalizeWorkspacePath(req.query.path ?? '')
    const targetDir = subPath ? resolve(runDir, subPath) : runDir
    if (!isPathInside(runDir, targetDir) || !existsSync(targetDir)) {
      return reply.status(404).send({ error: 'Directory not found' })
    }
    if (!statSync(targetDir).isDirectory()) {
      return reply.status(400).send({ error: 'Path is not a directory' })
    }

    const entries = listRunDirEntries(runDir, targetDir)
    return {
      root: runDir,
      path: subPath,
      entries,
    }
  })

  fastify.get<{
    Params: { runId: string }
    Querystring: { path?: string }
  }>('/api/fs/runs/:runId/files/content', async (req, reply) => {
    const runDir = await resolveRunWorkspaceDir(req.params.runId, opts.store)
    if (!runDir || !existsSync(runDir)) {
      return reply.status(404).send({ error: 'Run workspace not found' })
    }

    const relPath = normalizeWorkspacePath(req.query.path ?? '')
    if (!relPath) {
      return reply.status(400).send({ error: 'Path is required' })
    }

    const filePath = resolve(runDir, relPath)
    if (!isPathInside(runDir, filePath) || !existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' })
    }

    const stat = statSync(filePath)
    if (!stat.isFile()) {
      return reply.status(400).send({ error: 'Path is not a file' })
    }
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      return {
        path: relPath,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        content: '',
        isBinary: false,
        truncated: true,
      }
    }

    const buffer = readFileSync(filePath)
    const isBinary = looksBinary(buffer)
    return {
      path: relPath,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      content: isBinary ? '' : buffer.toString('utf-8'),
      isBinary,
      truncated: false,
    }
  })

  fastify.get<{
    Params: { runId: string }
    Querystring: { path?: string }
  }>('/api/fs/runs/:runId/raw', async (req, reply) => {
    const runDir = await resolveRunWorkspaceDir(req.params.runId, opts.store)
    if (!runDir || !existsSync(runDir)) {
      return reply.status(404).send({ error: 'Run workspace not found' })
    }

    const relPath = normalizeWorkspacePath(req.query.path ?? '')
    if (!relPath) return reply.status(400).send({ error: 'Path is required' })

    const filePath = resolve(runDir, relPath)
    if (!isPathInside(runDir, filePath) || !existsSync(filePath)) {
      return reply.status(404).send({ error: 'File not found' })
    }

    const stat = statSync(filePath)
    if (!stat.isFile()) return reply.status(400).send({ error: 'Not a file' })

    const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      ico: 'image/x-icon', bmp: 'image/bmp',
      pdf: 'application/pdf',
    }
    const contentType = mimeMap[ext] ?? 'application/octet-stream'
    reply.header('Content-Type', contentType)
    reply.header('Cache-Control', 'public, max-age=60')
    return reply.send(readFileSync(filePath))
  })

  fastify.get<{ Params: { runId: string } }>('/api/fs/runs/:runId/preview', async (req, reply) => {
    const runDir = await resolveRunWorkspaceDir(req.params.runId, opts.store)
    if (!runDir || !existsSync(runDir)) {
      return reply.status(404).send({ error: 'Run workspace not found' })
    }

    const candidate = findPreviewHtml(runDir)
    if (!candidate) {
      return reply.status(404).send({ error: 'No HTML preview file found' })
    }

    const stat = statSync(candidate.absolutePath)
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      return reply.status(413).send({ error: 'Preview file too large' })
    }

    const buffer = readFileSync(candidate.absolutePath)
    return {
      path: candidate.relPath,
      content: buffer.toString('utf-8'),
      modifiedAt: stat.mtimeMs,
    }
  })
}

export default fsRoute
