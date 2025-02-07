import type { DownloadTask } from './storage'
import { DEBUG } from './config'

export class ProgressUI {
  private lastLines = 0
  private total: number
  private verified: number
  private downloaded: number
  private lastVerified: number
  private lastDownloaded: number

  constructor(total: number, verified: number, downloaded: number) {
    this.total = total
    this.verified = verified
    this.downloaded = downloaded
    this.lastVerified = verified
    this.lastDownloaded = downloaded
  }

  private createProgressBar(width: number, progress: number): string {
    const filled = Math.round(width * progress)
    const empty = width - filled
    return `[${'='.repeat(filled)}${filled > 0 ? '>' : ''}${' '.repeat(Math.max(0, empty - (filled > 0 ? 1 : 0)))}]`
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unit = 0
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024
      unit++
    }
    return `${size.toFixed(1)}${units[unit]}`
  }

  private clearLines() {
    if (this.lastLines > 0) {
      process.stdout.write('\x1b[K\x1b[1A'.repeat(this.lastLines))
      process.stdout.write('\x1b[K')
    }
  }

  public setProgress(tasks: DownloadTask[]) {
    const oldVerified = this.verified
    const oldDownloaded = this.downloaded
    
    this.verified = tasks.filter(t => t.status === 'verified').length
    this.downloaded = tasks.filter(t => ['downloaded', 'verified'].includes(t.status)).length
    
    if (DEBUG) {
      console.log('Progress update:', {
        oldVerified,
        newVerified: this.verified,
        oldDownloaded,
        newDownloaded: this.downloaded,
        statusCounts: tasks.reduce((acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1
          return acc
        }, {} as Record<string, number>)
      })
    }
  }

  public render(activeTasks: DownloadTask[]) {
    // Only redraw if there are active tasks or progress has changed
    if (activeTasks.length === 0 && 
        this.verified === this.lastVerified && 
        this.downloaded === this.lastDownloaded) {
      return
    }

    this.clearLines()

    // Overall progress
    const verifiedPercent = ((this.verified / this.total) * 100).toFixed(1)
    const downloadedPercent = ((this.downloaded / this.total) * 100).toFixed(1)
    process.stdout.write(`Overall: ${this.downloaded}/${this.total} downloaded (${downloadedPercent}%), ${this.verified} verified (${verifiedPercent}%)\n`)

    // Active downloads with progress bars
    const activeFiles = activeTasks.filter(t => t.status === 'downloading' && t.progress)
    for (const task of activeFiles) {
      const progress = task.progress!
      const percent = progress.total ? progress.bytes / progress.total : 0
      const bar = this.createProgressBar(30, percent)
      const size = `${this.formatBytes(progress.bytes)}/${this.formatBytes(progress.total)}`
      const name = task.filename.replace(/pubmed\d+n(\d+)\.xml\.gz/, 'file $1')
      const type = progress.total === 100 ? 'CHECK' : 'PULL '
      process.stdout.write(`${bar} ${type} ${name} ${size}\n`)
    }

    // Update line count for next clear
    this.lastLines = activeFiles.length + 1
    this.lastVerified = this.verified
    this.lastDownloaded = this.downloaded
  }

  public log(message: string) {
    // Need to move above overall progress line too, so add 1 to activeLines
    const activeLines = this.lastLines + 1
    
    // Move cursor up by the number of active lines
    if (activeLines > 0) {
      process.stdout.write('\x1b[' + activeLines + 'A')
    }
    
    // Print the message
    process.stdout.write(`${message}\n`)
    
    // Move cursor back down
    if (activeLines > 0) {
      process.stdout.write('\x1b[' + activeLines + 'B')
    }
  }

  public error(message: string) {
    // Need to move above overall progress line too, so add 1 to activeLines
    const activeLines = this.lastLines + 1
    
    // Move cursor up by the number of active lines
    if (activeLines > 0) {
      process.stdout.write('\x1b[' + activeLines + 'A')
    }
    
    // Print the error in red
    process.stdout.write(`\x1b[31m${message}\x1b[0m\n`)
    
    // Move cursor back down
    if (activeLines > 0) {
      process.stdout.write('\x1b[' + activeLines + 'B')
    }
  }
} 