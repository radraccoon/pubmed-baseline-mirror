export const PATHS = {
  baseUrl: 'https://ftp.ncbi.nlm.nih.gov/pubmed/baseline',
  downloadDir: 'data/downloads'
}

export const CONCURRENT_DOWNLOADS = 10
export const CONCURRENT_VERIFICATIONS = 5
export const MAX_RETRIES = 3

export const DEBUG = process.env.DEBUG === 'true' 