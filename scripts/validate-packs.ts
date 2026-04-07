import path from 'node:path'
import { validatePackDirectory } from '../packages/pack-validator/src/index.js'

async function main() {
  const packsDir = path.resolve(process.cwd(), 'packs')
  const packs = await validatePackDirectory(packsDir)
  console.log(`Validated ${packs.length} instruction packs from ${packsDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
