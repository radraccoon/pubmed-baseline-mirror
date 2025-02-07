import { PATHS, CONCURRENT_DOWNLOADS, CONCURRENT_VERIFICATIONS, MAX_RETRIES, DEBUG } from './config'
import { downloadFile, computeFileHash, type DownloadTask } from './storage'
import { ProgressUI } from './progress'

async function getMd5(filename: string): Promise<string> {
  const md5File = `${filename}.md5`
  const response = await fetch(`${PATHS.baseUrl}/${md5File}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch MD5 for ${filename}`)
  }
  const text = await response.text()
  // Format is: MD5(filename)= hash
  const match = text.match(/MD5\([^)]+\)= ([a-f0-9]{32})/)
  if (!match) {
    throw new Error(`Invalid MD5 format for ${filename}: ${text}`)
  }
  return match[1]
}

function debug(...args: any[]) {
  if (DEBUG) {
    console.log(...args)
  }
}

export class Downloader {
  private tasks: DownloadTask[]
  private downloadQueue: DownloadTask[]
  private verifyQueue: DownloadTask[]
  private activeDownloads = new Map<string, Promise<void>>()
  private activeVerifications = new Map<string, Promise<void>>()
  private activeTasks = new Set<DownloadTask>()
  private ui: ProgressUI
  private onProgress: (tasks: DownloadTask[]) => Promise<void>
  private lastUIUpdate = 0
  private readonly UI_UPDATE_INTERVAL = 50 // ms

  constructor(tasks: DownloadTask[], onProgress: (tasks: DownloadTask[]) => Promise<void>) {
    this.tasks = tasks
    this.downloadQueue = tasks.filter(t => t.status === 'pending')
    this.verifyQueue = tasks.filter(t => t.status === 'downloaded')
    const verified = tasks.filter(t => t.status === 'verified').length
    const downloaded = tasks.filter(t => ['downloaded', 'verified'].includes(t.status)).length
    
    debug('Initial state:', {
      total: tasks.length,
      pending: this.downloadQueue.length,
      toVerify: this.verifyQueue.length,
      verified,
      downloaded
    })
    
    this.ui = new ProgressUI(tasks.length, verified, downloaded)
    this.onProgress = onProgress
  }

  private updateUI() {
    const now = Date.now()
    if (now - this.lastUIUpdate >= this.UI_UPDATE_INTERVAL) {
      this.ui.render(Array.from(this.activeTasks))
      this.lastUIUpdate = now
    }
  }

  private async processDownloads(): Promise<void> {
    while (this.downloadQueue.length > 0 || this.activeDownloads.size > 0) {
      while (this.downloadQueue.length > 0 && this.activeDownloads.size < CONCURRENT_DOWNLOADS) {
        const task = this.downloadQueue.shift()
        if (!task) continue

        const promise = (async () => {
          try {
            task.status = 'downloading'
            this.activeTasks.add(task)
            this.updateUI()
            
            await downloadFile(task, () => {
              this.updateUI()
            })
            
            task.status = 'downloaded'
            this.verifyQueue.push(task)
            this.ui.setProgress(this.tasks)
            this.updateUI()
          } catch (error) {
            task.attempts++
            if (task.attempts < MAX_RETRIES) {
              this.downloadQueue.push(task)
              this.ui.error(`⚠️  Retrying ${task.filename} (attempt ${task.attempts})`)
            } else {
              task.status = 'failed'
              this.ui.error(`❌ Failed to download ${task.filename} after ${MAX_RETRIES} attempts`)
            }
            this.activeTasks.delete(task)
          }
          await this.onProgress(this.tasks)
        })()

        this.activeDownloads.set(task.filename, promise)
        promise.finally(() => {
          this.activeDownloads.delete(task.filename)
          this.updateUI()
        })
      }

      if (this.activeDownloads.size > 0) {
        await Promise.race(this.activeDownloads.values())
      }
    }
  }

  private async processVerifications(): Promise<void> {
    let verified = 0
    const totalToVerify = this.tasks.length

    while (
      this.verifyQueue.length > 0 || 
      this.activeVerifications.size > 0 ||
      this.downloadQueue.length > 0 ||
      this.activeDownloads.size > 0
    ) {
      // If we have no tasks to verify and downloads are still running, wait a bit
      if (this.verifyQueue.length === 0 && 
          this.activeVerifications.size < CONCURRENT_VERIFICATIONS &&
          (this.downloadQueue.length > 0 || this.activeDownloads.size > 0)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        continue
      }

      while (this.verifyQueue.length > 0 && this.activeVerifications.size < CONCURRENT_VERIFICATIONS) {
        const task = this.verifyQueue.shift()!
        
        const promise = (async () => {
          try {
            task.status = 'downloading'
            task.progress = { bytes: 0, total: 100 }
            this.activeTasks.add(task)
            this.updateUI()

            // Computing local hash (50%)
            const localHash = await computeFileHash(task.filename).catch((error: Error) => {
              debug(`Failed to compute hash for ${task.filename}:`, error)
              return null
            })
            task.progress.bytes = 50
            this.updateUI()

            // Fetching remote MD5 (75%)
            const remoteMd5 = await getMd5(task.filename).catch((error: Error) => {
              debug(`Failed to fetch MD5 for ${task.filename}:`, error)
              return null
            })
            task.progress.bytes = 75
            this.updateUI()

            if (!localHash || !remoteMd5) {
              throw new Error('Failed to compute hash or fetch MD5')
            }

            // Final verification (100%)
            task.progress.bytes = 100
            this.updateUI()

            if (localHash === remoteMd5) {
              task.status = 'verified'
              verified++
              this.ui.setProgress(this.tasks)
            } else {
              debug(`Hash mismatch for ${task.filename}:`, { localHash, remoteMd5 })
              task.status = 'pending'
              this.downloadQueue.unshift(task)
              this.ui.error(`⚠️  ${task.filename} failed verification, will re-download`)
            }
          } catch (error) {
            debug(`Error verifying ${task.filename}:`, error)
            task.status = 'pending'
            this.downloadQueue.unshift(task)
            this.ui.error(`❌ Failed to verify ${task.filename}: ${error}`)
          } finally {
            delete task.progress
            this.activeTasks.delete(task)
            this.updateUI()
          }
          await this.onProgress(this.tasks)
        })()

        this.activeVerifications.set(task.filename, promise)
        promise.finally(() => {
          this.activeVerifications.delete(task.filename)
          this.updateUI()
        })
      }

      if (this.activeVerifications.size > 0) {
        await Promise.race(this.activeVerifications.values())
      }
    }
  }

  public async start(): Promise<void> {
    debug('Starting with:', {
      downloadQueue: this.downloadQueue.length,
      verifyQueue: this.verifyQueue.length,
      tasks: this.tasks.length
    })

    // Run downloads and verifications in parallel
    await Promise.all([
      this.processDownloads(),
      this.processVerifications()
    ])

    // Handle any failed verifications that need re-download
    if (this.downloadQueue.length > 0) {
      this.ui.log(`Re-downloading ${this.downloadQueue.length} files that failed verification...`)
      await Promise.all([
        this.processDownloads(),
        this.processVerifications()
      ])
    }
  }

  public getFailedTasks(): DownloadTask[] {
    return this.tasks.filter(t => t.status === 'failed')
  }
} 