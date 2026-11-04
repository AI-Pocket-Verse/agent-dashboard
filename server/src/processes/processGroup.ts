import type { ChildProcess, SpawnOptions } from 'child_process'

// claude 会派生子进程（shell 工具、MCP server 等），它们继承输出管道。
// 只杀直接子进程时这些孙进程仍持有管道，close 事件不触发、节点卡在 running。
// 因此在类 Unix 系统上让子进程自成进程组，终止时整组发信号。
// Windows 上 detached 会弹出新控制台，且不支持负 pid，只能退回单进程 kill。
const USE_PROCESS_GROUP = process.platform !== 'win32'

export const processGroupSpawnOptions: Pick<SpawnOptions, 'detached'> = { detached: USE_PROCESS_GROUP }

export function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (USE_PROCESS_GROUP && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // 进程组已不存在，退回单进程 kill
    }
  }
  child.kill(signal)
}
