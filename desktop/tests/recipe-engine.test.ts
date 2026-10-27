import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdbClient } from '../src/main/adb/adb-client'
import { loadCatalog } from '../src/main/optimization/catalog'
import { Journal } from '../src/main/optimization/journal'
import { RecipeEngine } from '../src/main/optimization/recipe-engine'
import type { DeviceInfo } from '../src/shared/types'
import { FakeRunner, findSharedDir } from './fake-runner'

const { catalog } = loadCatalog(findSharedDir())

const device: DeviceInfo = {
  id: '192.168.1.40:5555',
  model: 'Chromecast HD',
  manufacturer: 'Google',
  sdk: 31,
  androidVersion: '12',
  isTv: true,
  hasRoot: false,
  abi: 'arm64-v8a',
}

function setup(initial: Record<string, string> = {}) {
  const runner = new FakeRunner(initial)
  const client = new AdbClient({ adbPath: 'adb', runner, serial: device.id })
  const dir = mkdtempSync(join(tmpdir(), 'adb-optimizer-'))
  const journal = new Journal(join(dir, 'journal.json'))
  const engine = new RecipeEngine(client, journal)
  return { runner, client, journal, engine }
}

function recipe(id: string) {
  const found = catalog.recipes.find((item) => item.id === id)
  if (!found) throw new Error(`Receta no encontrada: ${id}`)
  return found
}

describe('RecipeEngine', () => {
  let context: ReturnType<typeof setup>

  beforeEach(() => {
    context = setup({
      'global:window_animation_scale': '1',
      'global:transition_animation_scale': '1',
      'global:animator_duration_scale': '1',
    })
  })

  it('el preview no muta el dispositivo ni escribe bitacora', async () => {
    const result = await context.engine.run(recipe('animations-off'), device, { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.status).toBe('ok')
    expect(result.steps.every((step) => step.status === 'skipped')).toBe(true)
    expect(context.runner.values.get('global:window_animation_scale')).toBe('1')
    expect(context.journal.list()).toHaveLength(0)
    expect(result.steps[0]?.previousValue).toBe('1')
  })

  it('aplica la receta, registra el valor previo y permite deshacer', async () => {
    const result = await context.engine.run(recipe('animations-off'), device)
    expect(result.status).toBe('ok')
    expect(context.runner.values.get('global:window_animation_scale')).toBe('0')

    const [entry] = context.journal.list()
    expect(entry).toBeDefined()
    if (!entry) return

    expect(entry.steps).toHaveLength(3)
    expect(entry.steps[0]?.previousValue).toBe('1')
    expect(entry.steps[0]?.undo).toBe('settings put global window_animation_scale 1')

    const undo = await context.engine.undo(entry.id)
    expect(undo.ok).toBe(true)
    expect(context.runner.values.get('global:window_animation_scale')).toBe('1')
    expect(context.journal.get(entry.id)?.revertedAt).toBeTruthy()
  })

  it('restaura borrando el ajuste cuando antes no existia', async () => {
    context = setup()
    const result = await context.engine.run(recipe('animations-off'), device)
    expect(result.status).toBe('ok')

    const [entry] = context.journal.list()
    if (!entry) throw new Error('sin entrada de bitacora')

    expect(entry.steps[0]?.previousValue).toBeNull()
    expect(entry.steps[0]?.undo).toBe('settings delete global window_animation_scale')

    await context.engine.undo(entry.id)
    expect(context.runner.values.has('global:window_animation_scale')).toBe(false)
  })

  it('no deshace cambios si el dispositivo conectado es otro', async () => {
    const result = await context.engine.run(recipe('animations-off'), device)
    expect(result.status).toBe('ok')

    const [entry] = context.journal.list()
    if (!entry) throw new Error('sin entrada de bitacora')

    const otherClient = new AdbClient({
      adbPath: 'adb',
      runner: context.runner,
      serial: '10.0.0.99:5555',
    })
    const otherEngine = new RecipeEngine(otherClient, context.journal)
    context.runner.history.length = 0

    await expect(otherEngine.undo(entry.id)).rejects.toThrow(/mismo dispositivo/i)
    expect(context.runner.history).toEqual([])
    expect(context.journal.get(entry.id)?.revertedAt).toBeUndefined()
  })

  it('detiene el undo al primer fallo y no marca la entrada como revertida', async () => {
    const result = await context.engine.run(recipe('animations-off'), device)
    expect(result.status).toBe('ok')

    const [entry] = context.journal.list()
    if (!entry) throw new Error('sin entrada de bitacora')
    const firstUndo = entry.steps.at(-1)?.undo
    if (!firstUndo) throw new Error('sin comando de undo')

    context.runner.failing.add(firstUndo)
    const undo = await context.engine.undo(entry.id)

    expect(undo.ok).toBe(false)
    expect(undo.steps[0]?.status).toBe('failed')
    expect(undo.steps.slice(1).every((step) => step.status === 'skipped')).toBe(true)
    expect(context.journal.get(entry.id)?.revertedAt).toBeUndefined()
  })

  it('reporta fallo cuando la verificacion no coincide', async () => {
    const runner = new FakeRunner()
    const original = runner.run.bind(runner)
    runner.run = async (bin, args, options) => {
      const command = args[args.length - 1] ?? ''
      if (command.startsWith('settings get')) {
        return { code: 0, stdout: 'no-aplica', stderr: '', durationMs: 1, timedOut: false }
      }
      return original(bin, args, options)
    }

    const client = new AdbClient({ adbPath: 'adb', runner, serial: device.id })
    const journal = new Journal(join(mkdtempSync(join(tmpdir(), 'adb-opt-')), 'journal.json'))
    const engine = new RecipeEngine(client, journal)

    const result = await engine.run(recipe('animations-halved'), device)
    expect(result.status).toBe('failed')
    expect(result.steps[0]?.error).toContain('se esperaba')
    expect(journal.list()).toHaveLength(0)
  })

  it('plan filtra por perfil y compatibilidad', () => {
    const plan = context.engine.plan(catalog.recipes, device, 'conservative')
    const aggressive = context.engine.plan(catalog.recipes, device, 'aggressive')

    const byId = (id: string) => plan.find((item) => item.recipe.id === id)
    expect(byId('animations-off')?.supported).toBe(true)
    expect(byId('force-doze')?.reason).toBe('profile')

    expect(aggressive.find((item) => item.recipe.id === 'force-doze')?.supported).toBe(true)

    const phonePlan = context.engine.plan(
      catalog.recipes,
      { ...device, isTv: false },
      'aggressive',
    )
    expect(phonePlan.find((item) => item.recipe.id === 'screensaver-off')?.supported).toBe(false)
  })
})
