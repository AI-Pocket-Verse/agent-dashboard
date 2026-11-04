import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { NodeRun, WorkflowRound, WorkflowRun, WorkflowTemplate, RunNodeLogsPage } from '@agent-dashboard/shared'

const INTERRUPTED_LOG_LINE = '[系统] 服务重启，执行已中断'

type TemplateRow = {
  id: string
  name: string
  description: string | null
  nodes_json: string
  edges_json: string
  created_at: number
  updated_at: number
}

type RunRow = {
  id: string
  name: string
  prompt: string | null
  project_name: string | null
  workspace_path: string | null
  execution_mode: WorkflowRun['executionMode'] | null
  status: WorkflowRun['status']
  nodes_json: string
  edges_json: string
  rounds_json: string | null
  active_round_id: string | null
  attachments_json: string | null
  require_confirm: number
  auto_fix_round: number | null
  created_at: number
  completed_at: number | null
}

export class PersistenceStore {
  private db: Database.Database
  private runsPath: string
  private templatesPath: string

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })

    this.runsPath = join(dataDir, 'runs.json')
    this.templatesPath = join(dataDir, 'templates.json')

    this.db = new Database(join(dataDir, 'app.db'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    this.initializeSchema()
    this.migrateLegacyJsonIfNeeded()
  }

  async loadRuns(): Promise<WorkflowRun[]> {
    const rows = this.db
      .prepare(`
        SELECT
          id,
          name,
          prompt,
          project_name,
          workspace_path,
          execution_mode,
          status,
          nodes_json,
          edges_json,
          rounds_json,
          active_round_id,
          attachments_json,
          require_confirm,
          auto_fix_round,
          created_at,
          completed_at
        FROM runs
        ORDER BY created_at ASC
      `)
      .all() as RunRow[]

    return rows.map(row => this.rowToRun(row))
  }

  async loadRun(id: string): Promise<WorkflowRun | null> {
    const row = this.db
      .prepare(`
        SELECT
          id,
          name,
          prompt,
          project_name,
          workspace_path,
          execution_mode,
          status,
          nodes_json,
          edges_json,
          rounds_json,
          active_round_id,
          attachments_json,
          require_confirm,
          auto_fix_round,
          created_at,
          completed_at
        FROM runs
        WHERE id = ?
      `)
      .get(id) as RunRow | undefined

    if (!row) return null

    return this.rowToRun(row)
  }

  async saveRun(run: WorkflowRun): Promise<void> {
    this.db.prepare(`
      INSERT INTO runs (
        id,
        name,
        prompt,
        project_name,
        workspace_path,
        execution_mode,
        status,
        nodes_json,
        edges_json,
        rounds_json,
        active_round_id,
        attachments_json,
        require_confirm,
        auto_fix_round,
        created_at,
        completed_at
      ) VALUES (
        @id,
        @name,
        @prompt,
        @project_name,
        @workspace_path,
        @execution_mode,
        @status,
        @nodes_json,
        @edges_json,
        @rounds_json,
        @active_round_id,
        @attachments_json,
        @require_confirm,
        @auto_fix_round,
        @created_at,
        @completed_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        prompt = excluded.prompt,
        project_name = excluded.project_name,
        workspace_path = excluded.workspace_path,
        execution_mode = excluded.execution_mode,
        status = excluded.status,
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        rounds_json = excluded.rounds_json,
        active_round_id = excluded.active_round_id,
        attachments_json = excluded.attachments_json,
        require_confirm = excluded.require_confirm,
        auto_fix_round = excluded.auto_fix_round,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at
    `).run({
      id: run.id,
      name: run.name,
      prompt: run.prompt ?? null,
      project_name: run.projectName ?? null,
      workspace_path: run.workspacePath ?? null,
      execution_mode: run.executionMode ?? null,
      status: run.status,
      nodes_json: JSON.stringify(run.nodes),
      edges_json: JSON.stringify(run.edges),
      rounds_json: JSON.stringify(this.getRunRounds(run)),
      active_round_id: this.getActiveRoundId(run),
      attachments_json: run.attachments ? JSON.stringify(run.attachments) : null,
      require_confirm: run.requireConfirm ? 1 : 0,
      auto_fix_round: run.autoFixRound ?? null,
      created_at: run.createdAt,
      completed_at: run.completedAt ?? null,
    })
  }

  async loadRunNodeLogs(
    runId: string,
    nodeId: string,
    options: { before?: number; limit?: number; roundId?: string } = {}
  ): Promise<RunNodeLogsPage | null> {
    const row = this.db
      .prepare('SELECT nodes_json, edges_json, rounds_json, active_round_id, prompt, status, created_at, completed_at FROM runs WHERE id = ?')
      .get(runId) as Pick<RunRow, 'nodes_json' | 'edges_json' | 'rounds_json' | 'active_round_id' | 'prompt' | 'status' | 'created_at' | 'completed_at'> | undefined
    if (!row) return null

    const rounds = this.getRunRounds({
      id: runId,
      name: '',
      prompt: row.prompt ?? undefined,
      status: row.status,
      nodes: JSON.parse(row.nodes_json),
      edges: JSON.parse(row.edges_json),
      rounds: row.rounds_json ? JSON.parse(row.rounds_json) : undefined,
      activeRoundId: row.active_round_id ?? undefined,
      requireConfirm: false,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    })
    const round = options.roundId
      ? rounds.find(item => item.id === options.roundId)
      : rounds.find(item => item.id === row.active_round_id) ?? rounds.at(-1)
    const nodes = round?.nodes ?? []
    const node = nodes.find(item => item.id === nodeId)
    if (!node) return null

    const logs = Array.isArray(node.logs) ? node.logs : []
    return getLogPage(logs, options)
  }

  async loadTemplates(): Promise<WorkflowTemplate[]> {
    const rows = this.db
      .prepare(`
        SELECT
          id,
          name,
          description,
          nodes_json,
          edges_json,
          created_at,
          updated_at
        FROM templates
        ORDER BY created_at ASC
      `)
      .all() as TemplateRow[]

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      nodes: JSON.parse(row.nodes_json),
      edges: JSON.parse(row.edges_json),
      createdAt: row.created_at,
    }))
  }

  async saveTemplate(template: WorkflowTemplate): Promise<void> {
    const now = Date.now()

    this.db.prepare(`
      INSERT INTO templates (
        id,
        name,
        description,
        nodes_json,
        edges_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @name,
        @description,
        @nodes_json,
        @edges_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run({
      id: template.id,
      name: template.name,
      description: template.description ?? null,
      nodes_json: JSON.stringify(template.nodes),
      edges_json: JSON.stringify(template.edges),
      created_at: template.createdAt,
      updated_at: now,
    })
  }

  async deleteTemplate(id: string): Promise<void> {
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  }

  // On startup the process has no live children, so anything still marked
  // running/paused/waiting — the run, its rounds or its nodes — is an orphan
  // from a previous process. Fail all of it so the UI never shows a run that
  // can no longer resolve. Also repairs rows where an older version only
  // updated the status column and left the rounds/nodes JSON running.
  failInterruptedRuns(now = Date.now()): number {
    const rows = this.db.prepare(`
      SELECT id, status, nodes_json, rounds_json, completed_at FROM runs
      WHERE status IN ('running', 'paused')
         OR nodes_json LIKE '%"status":"running"%' OR nodes_json LIKE '%"status":"waiting"%'
         OR rounds_json LIKE '%"status":"running"%' OR rounds_json LIKE '%"status":"paused"%'
         OR rounds_json LIKE '%"status":"waiting"%'
    `).all() as Array<Pick<RunRow, 'id' | 'status' | 'nodes_json' | 'rounds_json' | 'completed_at'>>

    // 返回是否真的改动了节点，用于统计；LIKE 预筛可能命中嵌套字段，不能按行数计
    const failNode = (node: NodeRun): boolean => {
      if (node.status !== 'running' && node.status !== 'waiting') return false
      node.status = 'failed'
      node.finishedAt ??= now
      node.logs = [...(Array.isArray(node.logs) ? node.logs : []), INTERRUPTED_LOG_LINE]
      return true
    }
    const isActive = (status: string) => status === 'running' || status === 'paused'

    const update = this.db.prepare(
      'UPDATE runs SET status = @status, nodes_json = @nodes_json, rounds_json = @rounds_json, completed_at = @completed_at WHERE id = @id',
    )
    const failCorrupt = this.db.prepare("UPDATE runs SET status = 'failed', completed_at = @completed_at WHERE id = @id")
    let changedRuns = 0
    this.db.transaction(() => {
      for (const row of rows) {
        // 单行损坏只跳过该行，不能让服务启动失败
        try {
          const nodes = JSON.parse(row.nodes_json) as NodeRun[]
          let changed = isActive(row.status)
          nodes.forEach(node => { changed = failNode(node) || changed })
          const rounds = row.rounds_json ? JSON.parse(row.rounds_json) as WorkflowRound[] : null
          rounds?.forEach(round => {
            round.nodes.forEach(node => { changed = failNode(node) || changed })
            if (isActive(round.status)) {
              round.status = 'failed'
              round.completedAt ??= now
              changed = true
            }
          })
          if (!changed) continue
          update.run({
            id: row.id,
            status: isActive(row.status) ? 'failed' : row.status,
            nodes_json: JSON.stringify(nodes),
            rounds_json: rounds ? JSON.stringify(rounds) : null,
            completed_at: row.completed_at ?? now,
          })
          changedRuns++
        } catch (err) {
          // 损坏行无法逐节点收尾，至少把运行状态置为失败，避免界面永远停在运行中
          console.warn(`[persistence] corrupt run ${row.id}, marking failed without node cleanup: ${(err as Error).message}`)
          if (isActive(row.status)) {
            failCorrupt.run({ id: row.id, completed_at: row.completed_at ?? now })
            changedRuns++
          }
        }
      }
    })()
    return changedRuns
  }

  close(): void {
    this.db.close()
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT,
        project_name TEXT,
        workspace_path TEXT,
        execution_mode TEXT,
        status TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        rounds_json TEXT,
        active_round_id TEXT,
        attachments_json TEXT,
        require_confirm INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `)
    this.ensureColumn('runs', 'workspace_path', 'TEXT')
    this.ensureColumn('runs', 'execution_mode', 'TEXT')
    this.ensureColumn('runs', 'prompt', 'TEXT')
    this.ensureColumn('runs', 'rounds_json', 'TEXT')
    this.ensureColumn('runs', 'active_round_id', 'TEXT')
    this.ensureColumn('runs', 'auto_fix_round', 'INTEGER')
  }

  private migrateLegacyJsonIfNeeded(): void {
    const templateCount = this.countRows('templates')
    const runCount = this.countRows('runs')

    if (templateCount === 0 && existsSync(this.templatesPath)) {
      const templates = this.readLegacyJson<WorkflowTemplate>(this.templatesPath)
      const insertTemplate = this.db.prepare(`
        INSERT OR REPLACE INTO templates (
          id,
          name,
          description,
          nodes_json,
          edges_json,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @name,
          @description,
          @nodes_json,
          @edges_json,
          @created_at,
          @updated_at
        )
      `)

      const importTemplates = this.db.transaction((items: WorkflowTemplate[]) => {
        for (const template of items) {
          insertTemplate.run({
            id: template.id,
            name: template.name,
            description: template.description ?? null,
            nodes_json: JSON.stringify(template.nodes),
            edges_json: JSON.stringify(template.edges),
            created_at: template.createdAt,
            updated_at: template.createdAt,
          })
        }
      })

      importTemplates(templates)
    }

    if (runCount === 0 && existsSync(this.runsPath)) {
      const runs = this.readLegacyJson<WorkflowRun>(this.runsPath)
      const insertRun = this.db.prepare(`
        INSERT OR REPLACE INTO runs (
          id,
          name,
          prompt,
          project_name,
          workspace_path,
          execution_mode,
          status,
          nodes_json,
          edges_json,
          rounds_json,
          active_round_id,
          attachments_json,
          require_confirm,
          created_at,
          completed_at
        ) VALUES (
          @id,
          @name,
          @prompt,
          @project_name,
          @workspace_path,
          @execution_mode,
          @status,
          @nodes_json,
          @edges_json,
          @rounds_json,
          @active_round_id,
          @attachments_json,
          @require_confirm,
          @created_at,
          @completed_at
        )
      `)

      const importRuns = this.db.transaction((items: WorkflowRun[]) => {
        for (const run of items) {
          insertRun.run({
            id: run.id,
            name: run.name,
            prompt: run.prompt ?? null,
            project_name: run.projectName ?? null,
            workspace_path: run.workspacePath ?? null,
            execution_mode: run.executionMode ?? null,
            status: run.status,
            nodes_json: JSON.stringify(run.nodes),
            edges_json: JSON.stringify(run.edges),
            rounds_json: JSON.stringify(this.getRunRounds(run)),
            active_round_id: this.getActiveRoundId(run),
            attachments_json: run.attachments ? JSON.stringify(run.attachments) : null,
            require_confirm: run.requireConfirm ? 1 : 0,
            auto_fix_round: run.autoFixRound ?? null,
            created_at: run.createdAt,
            completed_at: run.completedAt ?? null,
          })
        }
      })

      importRuns(runs)
    }
  }

  private countRows(tableName: 'templates' | 'runs'): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }
    return row.count
  }

  private ensureColumn(tableName: 'runs', columnName: string, columnType: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    if (!rows.some(row => row.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`)
    }
  }

  private readLegacyJson<T>(path: string): T[] {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'))
      return Array.isArray(raw) ? raw as T[] : []
    } catch {
      return []
    }
  }

  private rowToRun(row: RunRow): WorkflowRun {
    const run: WorkflowRun = {
      id: row.id,
      name: row.name,
      prompt: row.prompt ?? undefined,
      projectName: row.project_name ?? undefined,
      workspacePath: row.workspace_path ?? undefined,
      executionMode: row.execution_mode ?? undefined,
      status: row.status,
      nodes: JSON.parse(row.nodes_json),
      edges: JSON.parse(row.edges_json),
      rounds: row.rounds_json ? JSON.parse(row.rounds_json) : undefined,
      activeRoundId: row.active_round_id ?? undefined,
      attachments: row.attachments_json ? JSON.parse(row.attachments_json) : undefined,
      requireConfirm: Boolean(row.require_confirm),
      autoFixRound: row.auto_fix_round ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    }
    const rounds = this.getRunRounds(run)
    const activeRoundId = this.getActiveRoundId({ ...run, rounds })
    const activeRound = rounds.find(round => round.id === activeRoundId) ?? rounds.at(-1)
    return {
      ...run,
      rounds,
      activeRoundId,
      nodes: activeRound?.nodes ?? run.nodes,
      edges: activeRound?.edges ?? run.edges,
    }
  }

  private getRunRounds(run: WorkflowRun): NonNullable<WorkflowRun['rounds']> {
    if (Array.isArray(run.rounds) && run.rounds.length > 0) return run.rounds
    return [{
      id: run.activeRoundId ?? 'round-1',
      prompt: run.prompt ?? run.nodes[0]?.prompt ?? '',
      status: run.status,
      nodes: run.nodes,
      edges: run.edges,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    }]
  }

  private getActiveRoundId(run: WorkflowRun): string {
    const rounds = this.getRunRounds(run)
    return run.activeRoundId ?? rounds.at(-1)?.id ?? 'round-1'
  }
}

export function getLogPage(logs: string[], options: { before?: number; limit?: number } = {}): RunNodeLogsPage {
  const total = logs.length
  const requestedLimit = Number.isFinite(options.limit) ? Math.floor(options.limit as number) : 200
  const limit = Math.min(Math.max(requestedLimit, 1), 500)
  const requestedBefore = Number.isFinite(options.before) ? Math.floor(options.before as number) : total
  const before = Math.min(Math.max(requestedBefore, 0), total)
  const start = Math.max(0, before - limit)
  const items = logs.slice(start, before)

  return {
    items,
    start,
    total,
    nextBefore: start > 0 ? start : null,
  }
}
