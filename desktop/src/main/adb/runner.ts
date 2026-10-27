import { spawn } from 'node:child_process'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface RunOptions {
  timeoutMs?: number
  stdin?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Indireccion sobre la ejecucion de procesos.
 * Permite probar el cliente ADB y el motor de recetas sin dispositivo real.
 */
export interface CommandRunner {
  run(bin: string, args: string[], options?: RunOptions): Promise<CommandResult>
}

export class ProcessRunner implements CommandRunner {
  run(bin: string, args: string[], options: RunOptions = {}): Promise<CommandResult> {
    const timeoutMs = options.timeoutMs ?? 30_000
    const startedAt = Date.now()

    return new Promise((resolve) => {
      const child = spawn(bin, args, { env: { ...process.env, ...options.env } })
      let stdout = ''
      let stderr = ''
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })

      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({
          code: -1,
          stdout,
          stderr: `${stderr}${error.message}`,
          durationMs: Date.now() - startedAt,
          timedOut,
        })
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({
          code: code ?? -1,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
        })
      })

      if (options.stdin !== undefined) {
        child.stdin?.write(options.stdin)
        child.stdin?.end()
      }
    })
  }
}
