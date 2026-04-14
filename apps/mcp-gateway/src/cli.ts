/**
 * PackForge CLI — starts the MCP Gateway server over stdio.
 *
 * Usage:
 *   npx packforge                     # default packs from ./packs
 *   npx packforge --packs ./my-packs  # custom packs directory
 *
 * Environment variables:
 *   PACKFORGE_PACKS_DIR     — path to instruction packs directory
 *   PACKFORGE_MEMORY_FILE   — path to memory JSON file
 */

import { resolve } from 'node:path'
import { startMcpGatewayServer } from './index.js'

function parseArgs(argv: string[]): { packsDir?: string; memoryFilePath?: string } {
  const args: { packsDir?: string; memoryFilePath?: string } = {}

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--packs' || arg === '--packs-dir') && argv[i + 1]) {
      args.packsDir = resolve(argv[++i]!)
    } else if ((arg === '--memory' || arg === '--memory-file') && argv[i + 1]) {
      args.memoryFilePath = resolve(argv[++i]!)
    } else if (arg === '--help' || arg === '-h') {
      console.log(`packforge — AI Agent Instruction Hub (MCP Server)

Usage:
  packforge [options]

Options:
  --packs, --packs-dir <path>    Path to instruction packs directory
  --memory, --memory-file <path> Path to memory JSON file
  -h, --help                     Show this help message
  -v, --version                  Show version

Environment variables:
  PACKFORGE_PACKS_DIR            Path to instruction packs directory
  PACKFORGE_MEMORY_FILE          Path to memory JSON file`)
      process.exit(0)
    } else if (arg === '--version' || arg === '-v') {
      console.log('packforge 0.1.0')
      process.exit(0)
    }
  }

  // Environment variable fallbacks
  if (!args.packsDir && process.env['PACKFORGE_PACKS_DIR']) {
    args.packsDir = resolve(process.env['PACKFORGE_PACKS_DIR'])
  }
  if (!args.memoryFilePath && process.env['PACKFORGE_MEMORY_FILE']) {
    args.memoryFilePath = resolve(process.env['PACKFORGE_MEMORY_FILE'])
  }

  return args
}

const opts = parseArgs(process.argv)

startMcpGatewayServer(opts).catch((error) => {
  console.error('packforge: failed to start MCP server', error)
  process.exitCode = 1
})
