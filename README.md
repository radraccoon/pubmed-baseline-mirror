# PubMed Mirror

A tool to create and maintain a local mirror of PubMed baseline data by downloading from the official NCBI FTP server.

## Features

- Concurrent downloads from ftp.ncbi.nlm.nih.gov
  - 10 parallel downloads
  - 5 parallel verifications
  - Retries on failure
- Progress tracking
  - Overall status
  - Per-file progress
  - Download speed
- File integrity
  - MD5 verification
  - Re-downloads corrupted files
- Resumable operation
  - Saves progress
  - Continues from last state

## Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/pubmed-mirror.git
cd pubmed-mirror

# Install dependencies
npm install
```

## Usage

```bash
# Start downloading baseline files
npm start

# Development mode
npm run dev
```

The tool will:
1. Create a `data/downloads` directory
2. Download missing files
3. Verify checksums
4. Show progress:
   - Overall status
   - Active downloads (PULL)
   - Active verifications (CHECK)
5. Retry failed operations
6. Save state for resume

## Development

```bash
# Run tests
npm test

# Build
npm run build
```

## Data Source

This tool downloads from [PubMed's baseline FTP](https://ftp.ncbi.nlm.nih.gov/pubmed/baseline/)

## Contributing

Contributions welcome! Please submit a Pull Request.

## License

MIT
