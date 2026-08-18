import { watch, FSWatcher, mkdirSync } from 'fs'

type ActivityCallback = (path: string, active: boolean) => void

const IGNORED_PARTS = new Set(['node_modules', '.git'])
const DEBOUNCE_MS = 1500

export class FileWatcher {
  private watchers = new Map<string, { watcher: FSWatcher; timers: Map<string, NodeJS.Timeout> }>()

  start(runId: string, runDir: string, onActivity: ActivityCallback): void {
    if (this.watchers.has(runId)) return
    try {
      mkdirSync(runDir, { recursive: true })
      const timers = new Map<string, NodeJS.Timeout>()
      const watcher = watch(runDir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const relPath = filename.replace(/\\/g, '/')
        const parts = relPath.split('/')
        if (parts.some(p => p.startsWith('.') || IGNORED_PARTS.has(p))) return

        onActivity(relPath, true)

        const prev = timers.get(relPath)
        if (prev) clearTimeout(prev)
        timers.set(relPath, setTimeout(() => {
          timers.delete(relPath)
          onActivity(relPath, false)
        }, DEBOUNCE_MS))
      })
      this.watchers.set(runId, { watcher, timers })
    } catch {
      // directory not accessible; skip silently
    }
  }

  stop(runId: string): void {
    const entry = this.watchers.get(runId)
    if (!entry) return
    try { entry.watcher.close() } catch { /* ignore */ }
    entry.timers.forEach(t => clearTimeout(t))
    this.watchers.delete(runId)
  }
}
