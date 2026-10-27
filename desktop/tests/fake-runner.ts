import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CommandResult, CommandRunner, RunOptions } from '../src/main/adb/runner'

export function findSharedDir(start = process.cwd()): string {
  let current = start
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, 'shared', 'recipes', 'recipes.json')
    if (existsSync(candidate)) return join(current, 'shared')
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`No se encontro shared/ desde ${start}`)
}

/**
 * Transporte ADB falso: emula lo justo de `settings`, `echo` y comandos sin salida.
 * Permite probar el motor completo sin dispositivo.
 */
export class FakeRunner implements CommandRunner {
  readonly values = new Map<string, string>()
  readonly history: string[] = []
  readonly failing = new Set<string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.values.set(key, value)
    }
  }

  async run(_bin: string, args: string[], _options?: RunOptions): Promise<CommandResult> {
    const command = args[args.length - 1] ?? ''
    this.history.push(command)

    if (this.failing.has(command)) {
      return { code: 1, stdout: '', stderr: 'error: forced failure', durationMs: 1, timedOut: false }
    }

    const stdout = this.handle(command)
    return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
  }

  private handle(command: string): string {
    const get = command.match(/^settings get (\w+) ([\w.]+)$/)
    if (get) {
      return this.values.get(`${get[1]}:${get[2]}`) ?? 'null'
    }

    const put = command.match(/^settings put (\w+) ([\w.]+) (.+)$/)
    if (put) {
      this.values.set(`${put[1]}:${put[2]}`, put[3])
      return ''
    }

    const del = command.match(/^settings delete (\w+) ([\w.]+)$/)
    if (del) {
      this.values.delete(`${del[1]}:${del[2]}`)
      return ''
    }

    if (command.startsWith('echo ')) {
      return command.slice(5)
    }

    if (command === 'am kill-all' || command.startsWith('pm trim-caches') || command.startsWith('logcat')) {
      return ''
    }

    return ''
  }
}
