import { PATHS, DEBUG } from './config'
import { initStorage, saveProgress, getLocalFiles, type DownloadTask } from './storage'
import { Downloader } from './downloader'

function debug(...args: any[]) {
  if (DEBUG) {
    console.log(...args)
  }
}

async function getRemoteFileList(): Promise<Set<string>> {
  const response = await fetch(PATHS.baseUrl)
  if (!response.ok) {
    throw new Error(`Failed to retrieve file list: ${response.statusText}`)
  }
  const text = await response.text()
  
  const xmlFiles = new Set<string>()
  const fileRegex = /href="(pubmed\d+n\d+\.xml\.gz)(?:\.md5)?"/g
  let match
  while ((match = fileRegex.exec(text)) !== null) {
    xmlFiles.add(match[1])
  }
  
  return xmlFiles
}

function createTask(filename: string, status: DownloadTask['status'] = 'pending'): DownloadTask {
  return {
    filename,
    url: `${PATHS.baseUrl}/${filename}`,
    status,
    attempts: 0
  }
}

async function main() {
  try {
    await initStorage()
    
    // Get remote file list and local files
    console.log('Getting file list...')
    const [remoteFiles, localFiles] = await Promise.all([
      getRemoteFileList(),
      getLocalFiles()
    ])

    // Create tasks for missing and existing files
    const tasks: DownloadTask[] = []
    
    const missingFiles = Array.from(remoteFiles).filter(f => !localFiles.has(f))
    if (missingFiles.length > 0) {
      console.log(`Found ${missingFiles.length} missing files`)
      tasks.push(...missingFiles.map(f => createTask(f)))
    }

    const existingFiles = Array.from(remoteFiles).filter(f => localFiles.has(f))
    if (existingFiles.length > 0) {
      console.log(`Found ${existingFiles.length} existing files to verify`)
      tasks.push(...existingFiles.map(f => createTask(f, 'downloaded')))
    }

    debug('Task statuses:', tasks.map(t => t.status))
    const downloader = new Downloader(tasks, saveProgress)
    await downloader.start()
    
    const failedTasks = downloader.getFailedTasks()
    if (failedTasks.length > 0) {
      console.error(`Failed to download ${failedTasks.length} files:`)
      failedTasks.forEach(t => console.error(`❌ ${t.filename}`))
      process.exit(1)
    }

    console.log('\n✨ All files downloaded and verified successfully!')
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  }
}

main() 