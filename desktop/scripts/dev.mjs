#!/usr/bin/env node
/**
 * Dev runner propio en lugar de concurrently + wait-on.
 *
 * Motivos:
 *  - Si el puerto 5173 esta ocupado, Vite fallaba y `concurrently -k` mataba todo
 *    con exit 1 sin mostrar la causa.
 *  - `wait-on tcp:5173 dist/main/index.js` puede quedarse esperando para siempre.
 *
 * Aqui: se compila main una vez, se levanta Vite (puerto libre), se lanza Electron
 * con la URL real y se propaga el codigo de salida.
 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = (name) => join(desktop, 'node_modules', '.bin', name)

function fail(message, error) {
  console.error(`\n[dev] ${message}`)
  if (error) console.error(error)
  process.exit(1)
}

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: desktop, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} termino con codigo ${code}`)),
    )
  })
}

if (!existsSync(join(desktop, '..', 'shared', 'recipes', 'recipes.json'))) {
  fail('No se encontro ../shared/recipes/recipes.json. Corre el script desde desktop/.')
}

console.log('[dev] compilando proceso principal…')
await runOnce(bin('tsc'), ['-p', 'tsconfig.node.json']).catch((error) =>
  fail('Fallo la compilacion de src/main. Revisa los errores de TypeScript de arriba.', error),
)

const server = await createServer({
  configFile: join(desktop, 'vite.config.ts'),
  server: { strictPort: false },
}).catch((error) => fail('No se pudo iniciar Vite.', error))

await server.listen()
const url =
  server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}`
console.log(`[dev] renderer en ${url}`)

const tsc = spawn(bin('tsc'), ['-p', 'tsconfig.node.json', '--watch', '--preserveWatchOutput'], {
  cwd: desktop,
  stdio: 'inherit',
})

const app = spawn(electronPath, ['.'], {
  cwd: desktop,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
})

let shuttingDown = false
async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  tsc.kill('SIGTERM')
  if (!app.killed) app.kill('SIGTERM')
  await server.close().catch(() => {})
  process.exit(code)
}

app.on('error', (error) => fail('Electron no pudo iniciarse.', error))
app.on('exit', (code) => {
  if (code !== 0) console.error(`\n[dev] Electron termino con codigo ${code}.`)
  void shutdown(code ?? 0)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void shutdown(0))
}
