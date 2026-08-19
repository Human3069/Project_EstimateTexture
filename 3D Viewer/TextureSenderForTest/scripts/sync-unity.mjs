import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const sourceDirectory = path.resolve(projectDirectory, '..', 'Builds')
const destinationDirectory = path.resolve(projectDirectory, 'public', 'unity')

await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })

for (const directoryName of ['Build', 'StreamingAssets']) {
  await cp(
    path.join(sourceDirectory, directoryName),
    path.join(destinationDirectory, directoryName),
    { recursive: true },
  )
}

const buildFiles = await readdir(path.join(sourceDirectory, 'Build'))

function findBuildFile(pattern, description) {
  const fileName = buildFiles.find((candidate) => pattern.test(candidate))

  if (fileName === undefined) {
    throw new Error(`Unity ${description} file was not found in Build directory.`)
  }

  return fileName
}

const buildManifest = {
  loader: findBuildFile(/\.loader\.js$/, 'loader'),
  data: findBuildFile(/\.data(?:\.br|\.gz)?$/, 'data'),
  framework: findBuildFile(/\.framework\.js(?:\.br|\.gz)?$/, 'framework'),
  code: findBuildFile(/\.wasm(?:\.br|\.gz)?$/, 'wasm'),
}

await writeFile(
  path.join(destinationDirectory, 'build-manifest.json'),
  `${JSON.stringify(buildManifest, null, 2)}\n`,
  'utf8',
)

console.log(`Unity build synchronized from ${sourceDirectory}`)
console.log(`Unity build destination: ${destinationDirectory}`)
console.log(`Unity build files: ${JSON.stringify(buildManifest)}`)
