export function compactConsecutiveLogs(logs: string[]) {
  return logs.filter((line, index) => index === 0 || line !== logs[index - 1])
}

export function compactAdjacentLogBlocks(logs: string[]) {
  const compacted = compactConsecutiveLogs(logs)
  const result: string[] = []
  let index = 0

  while (index < compacted.length) {
    let skipped = false
    const maxBlockSize = Math.floor((compacted.length - index) / 2)

    for (let blockSize = maxBlockSize; blockSize >= 1; blockSize--) {
      const currentBlock = compacted.slice(index, index + blockSize)
      const nextBlock = compacted.slice(index + blockSize, index + blockSize * 2)
      if (currentBlock.length === nextBlock.length && currentBlock.every((line, offset) => line === nextBlock[offset])) {
        result.push(...currentBlock)
        index += blockSize * 2
        skipped = true
        break
      }
    }

    if (!skipped) {
      result.push(compacted[index])
      index++
    }
  }

  return result
}

export function getRecentCompactLogs(logs: string[], limit = 120) {
  const safeLimit = Math.max(1, limit)
  const scanWindowSize = Math.min(logs.length, safeLimit * 4)
  return compactAdjacentLogBlocks(logs.slice(-scanWindowSize)).slice(-safeLimit)
}
