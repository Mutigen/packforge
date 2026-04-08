import path from 'node:path'
import { validatePackDirectory } from '../packages/pack-validator/src/index.js'

async function main() {
  const packsDir = path.resolve(process.cwd(), 'packs')
  const { packs, warnings } = await validatePackDirectory(packsDir)
  console.log(`Validated ${packs.length} instruction packs from ${packsDir}`)
  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`)
    for (const warning of warnings) {
      console.warn(`  [${warning.code}] ${warning.message}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
