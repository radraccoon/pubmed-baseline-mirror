import { mkdir, writeFile, readFile } from 'fs/promises'
import { createWriteStream, existsSync, createReadStream } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { readdir } from 'fs/promises'
import { PATHS } from './config'

export type DownloadTask = {
  filename: string
  url: string
  md5?: string
  status: 'pending' | 'downloading' | 'downloaded' | 'failed' | 'verified'
  attempts: number
  progress?: {
    bytes: number
    total: number
  }
}

export type ProgressCallback = (task: DownloadTask) => void

const PROGRESS_FILE = join(PATHS.downloadDir, '.progress.json')

export async function initStorage() {
  await mkdir(PATHS.downloadDir, { recursive: true })
}

export async function getLocalFiles(): Promise<Set<string>> {
  try {
    const files = await readdir(PATHS.downloadDir)
    return new Set(files.filter(f => f.endsWith('.xml.gz')))
  } catch {
    return new Set()
  }
}

export async function computeFileHash(filename: string): Promise<string> {
  const filePath = join(PATHS.downloadDir, filename)
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filename}`)
  }

  const hash = createHash('md5')
  const stream = createReadStream(filePath)
  stream.pipe(hash)
  
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function computeLocalHashes(files: Set<string>, onProgress?: (current: number, total: number) => void): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  let processed = 0
  
  for (const file of files) {
    try {
      const hash = await computeFileHash(file)
      hashes.set(file, hash)
      processed++
      onProgress?.(processed, files.size)
    } catch (error) {
      console.warn(`Failed to compute hash for ${file}:`, error)
    }
  }
  
  return hashes
}

export async function saveProgress(tasks: DownloadTask[]) {
  await writeFile(PROGRESS_FILE, JSON.stringify(tasks, null, 2))
}

export async function loadProgress(): Promise<DownloadTask[]> {
  try {
    if (existsSync(PROGRESS_FILE)) {
      const data = await readFile(PROGRESS_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.warn('Failed to load progress file, starting fresh')
  }
  return []
}

export async function downloadFile(task: DownloadTask, onProgress?: ProgressCallback): Promise<void> {
  const destPath = join(PATHS.downloadDir, task.filename)
  
  const response = await fetch(task.url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${task.filename}: ${response.statusText}`)
  }

  const total = Number(response.headers.get('content-length')) || 0
  task.progress = { bytes: 0, total }

  const fileStream = createWriteStream(destPath)
  const reader = response.body.getReader()

  let lastUpdate = Date.now()
  const UPDATE_INTERVAL = 100 // Update every 100ms

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      task.progress.bytes += value.length
      fileStream.write(value)

      const now = Date.now()
      if (now - lastUpdate >= UPDATE_INTERVAL) {
        onProgress?.(task)
        lastUpdate = now
      }
    }
  } finally {
    fileStream.end()
    await new Promise(resolve => fileStream.on('finish', resolve))
    onProgress?.(task) // Final update
  }
}

export async function verifyChecksum(filename: string, expectedMd5: string): Promise<boolean> {
  try {
    const computedHash = await computeFileHash(filename)
    return computedHash === expectedMd5
  } catch (error) {
    console.error(`Failed to verify ${filename}:`, error)
    return false
  }
} 