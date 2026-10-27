import { describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import type { CommandRunner, CommandResult } from '../src/main/adb/runner'

class LauncherRunner implements CommandRunner {
  readonly calls: string[][] = []

  async run(_bin: string, args: string[]): Promise<CommandResult> {
    this.calls.push(args)
    const command = args.at(-1) ?? ''
    const stdout = args.includes('install')
      ? 'Success'
      : command === 'cmd package query-activities --brief --components --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME'
      ? 'com.example.tvlauncher/.HomeActivity'
      : command === 'cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.HOME'
        ? 'com.example.tvlauncher/.HomeActivity'
        : command.startsWith('adb install') ? 'Success' : ''
    return { code: 0, stdout, stderr: '', durationMs: 1, timedOut: false }
  }
}

describe('instalación de launcher en Android TV/Google TV', () => {
  it('instala el APK como app normal, sin solicitar root ni remount', async () => {
    const runner = new LauncherRunner()
    const client = new AdbClient({ adbPath: 'adb', runner, serial: '192.0.2.20:5555' })

    expect(await client.install('/safe/launcher.apk')).toBe('Success')
    expect(runner.calls[0]).toEqual(['-s', '192.0.2.20:5555', 'install', '-r', '-g', '/safe/launcher.apk'])
    expect(runner.calls.some((args) => ['root', 'remount', 'push'].includes(args.at(-1) ?? ''))).toBe(false)
  })

  it('permite elegir como Home un launcher instalado que declara MAIN/HOME', async () => {
    const runner = new LauncherRunner()
    const client = new AdbClient({ adbPath: 'adb', runner, serial: '192.0.2.20:5555' })

    const selected = await client.setDefaultHomeLauncher('com.example.tvlauncher')

    expect(selected.packageName).toBe('com.example.tvlauncher')
    expect(runner.calls.some((args) => args.at(-1)?.includes('set-home-activity'))).toBe(true)
    expect(runner.calls.some((args) => ['root', 'remount', 'push'].includes(args.at(-1) ?? ''))).toBe(false)
  })
})
