import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandResult, CommandRunner, RunOptions } from '../src/main/adb/runner'
import {
  appendLogcat,
  filterLogcat,
  parseLogcat,
} from '../src/main/logcat/logcat-parser'
import { LogcatService } from '../src/main/logcat/logcat-service'
import type { LogcatEntry } from '../src/shared/types'

const FIXTURE = [
  '01-02 03:04:05.678  1234  1250 I ActivityManager: Start proc 4321:com.example',
  '01-02 03:04:06.100  1234  1250 E AndroidRuntime: FATAL EXCEPTION: main',
  '\tjava.lang.RuntimeException: boom',
  '\t\tat com.example.Main.onCreate(Main.kt:12)',
  '\t\tat android.app.Activity.performCreate(Activity.java:8000)',
  '01-02 03:04:07.000   200   200 W lowleveltag : short message',
  '',
].join('\n')

class CapturingRunner implements CommandRunner {
  readonly calls: Array<{ bin: string; args: string[] }> = []

  constructor(
    private readonly stdout = FIXTURE,
    private readonly stderr = '',
    private readonly code = 0,
  ) {}

  async run(bin: string, args: string[], _options?: RunOptions): Promise<CommandResult> {
    this.calls.push({ bin, args })
    return { code: this.code, stdout: this.stdout, stderr: this.stderr, durationMs: 3, timedOut: false }
  }
}

function serviceFor(runner: CommandRunner): LogcatService {
  return new LogcatService(new AdbClient({ adbPath: 'adb', runner, serial: 'x' }))
}

describe('parseLogcat', () => {
  it('separa threadtime y anexa stack traces multilinea al mensaje anterior', () => {
    const entries = parseLogcat(FIXTURE)

    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      time: '01-02 03:04:05.678',
      pid: '1234',
      tid: '1250',
      level: 'I',
      tag: 'ActivityManager',
      message: 'Start proc 4321:com.example',
    })
    expect(entries[1]).toMatchObject({
      level: 'E',
      tag: 'AndroidRuntime',
      pid: '1234',
    })
    expect(entries[1]?.message).toContain('FATAL EXCEPTION: main')
    expect(entries[1]?.message).toContain('java.lang.RuntimeException: boom')
    expect(entries[1]?.message).toContain('at com.example.Main.onCreate(Main.kt:12)')
    expect(entries[2]).toMatchObject({
      time: '01-02 03:04:07.000',
      level: 'W',
      tag: 'lowleveltag',
      message: 'short message',
    })
  })

  it('ignora texto que no es threadtime ni continuacion', () => {
    expect(parseLogcat('--------- beginning of main\nbasura suelta')).toEqual([])
  })
})

describe('appendLogcat', () => {
  const first: LogcatEntry = {
    time: '01-02 03:04:05.678',
    pid: '10',
    tid: '11',
    level: 'I',
    tag: 'Tag',
    message: 'primera',
  }
  const second: LogcatEntry = { ...first, time: '01-02 03:04:06.000', message: 'segunda' }
  const third: LogcatEntry = { ...first, time: '01-02 03:04:07.000', message: 'tercera' }

  it('descarta el primer duplicado cuando repite la ultima entrada', () => {
    expect(appendLogcat([first], [first, second])).toEqual([first, second])
  })

  it('no filtra nada cuando las entradas son nuevas', () => {
    expect(appendLogcat([first], [second, third])).toEqual([first, second, third])
  })

  it('conserva solo las max entradas mas recientes', () => {
    expect(appendLogcat([first, second], [third], 2)).toEqual([second, third])
  })
})

describe('filterLogcat', () => {
  const entries = parseLogcat(FIXTURE)

  it('aplica el nivel minimo', () => {
    const filtered = filterLogcat(entries, 'W', '')
    expect(filtered.map((entry) => entry.level)).toEqual(['E', 'W'])
  })

  it('busca en tag y en mensaje sin distinguir mayusculas', () => {
    expect(filterLogcat(entries, 'V', 'androidruntime').map((entry) => entry.level)).toEqual(['E'])
    expect(filterLogcat(entries, 'V', 'start proc').map((entry) => entry.level)).toEqual(['I'])
  })
})

describe('LogcatService', () => {
  it('lee con -t cuando no hay marca de tiempo', async () => {
    const runner = new CapturingRunner()
    const entries = await serviceFor(runner).read(100)

    expect(runner.calls).toHaveLength(1)
    expect(runner.calls[0]?.args).toEqual([
      '-s',
      'x',
      'shell',
      'logcat -d -v threadtime -t 100',
    ])
    expect(entries).toHaveLength(3)
  })

  it('lee con -T cuando se pasa since', async () => {
    const runner = new CapturingRunner()
    await serviceFor(runner).read(500, '01-02 03:04:05.678')

    expect(runner.calls[0]?.args).toEqual([
      '-s',
      'x',
      'shell',
      'logcat -d -v threadtime -T "01-02 03:04:05.678"',
    ])
  })

  it('valida el limite y el formato de since', async () => {
    const runner = new CapturingRunner()
    const service = serviceFor(runner)

    await expect(service.read(0)).rejects.toThrow(/limite/)
    await expect(service.read(5001)).rejects.toThrow(/limite/)
    await expect(service.read(1.5)).rejects.toThrow(/limite/)
    await expect(service.read(100, 'ayer')).rejects.toThrow(/formato/)
    expect(runner.calls).toHaveLength(0)
  })

  it('propaga el mensaje del dispositivo cuando falla la lectura', async () => {
    const runner = new CapturingRunner('', 'error: device not found', 1)
    await expect(serviceFor(runner).read(100)).rejects.toThrow(/device not found/)
  })

  it('limpia el registro con logcat -c', async () => {
    const runner = new CapturingRunner('')
    await serviceFor(runner).clear()

    expect(runner.calls[0]?.args).toEqual(['-s', 'x', 'shell', 'logcat -c'])
  })
})
