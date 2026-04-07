import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listPackFiles, getPackRegistryEntry, validatePackFile } from '../packages/pack-validator/src/index.js'

async function main() {
  const packsDir = path.resolve(process.cwd(), 'packs')
  const outputPath = path.resolve(process.cwd(), 'docs/pack-registry.json')
  const files = await listPackFiles(packsDir)
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const pack = await validatePackFile(filePath)
      return getPackRegistryEntry(pack, path.relative(process.cwd(), filePath))
    }),
  )

  await writeFile(outputPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  console.log(`Wrote registry with ${entries.length} packs to ${outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
