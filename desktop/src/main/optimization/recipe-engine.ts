import type {
  ActionSpec,
  DeviceInfo,
  JournalEntry,
  PlanItem,
  Profile,
  Recipe,
  Risk,
  RunResult,
  StepResult,
  StepSpec,
  VerifySpec,
} from '../../shared/types'
import { AdbClient } from '../adb/adb-client'
import { isSupported, riskAllowed } from './catalog'
import { Journal } from './journal'

export interface RunOptions {
  dryRun?: boolean
  onProgress?: (result: StepResult) => void
}

const PROFILE_MAX_RISK: Record<Profile, Risk> = {
  conservative: 'safe',
  recommended: 'moderate',
  aggressive: 'advanced',
}

export class RecipeEngine {
  private readonly client: AdbClient
  private readonly journal: Journal

  constructor(client: AdbClient, journal: Journal) {
    this.client = client
    this.journal = journal
  }

  plan(recipes: Recipe[], device: DeviceInfo, profile: Profile): PlanItem[] {
    const maxRisk = PROFILE_MAX_RISK[profile]
    return recipes.map((recipe) => {
      const compatibility = isSupported(recipe, device)
      if (!compatibility.supported) {
        return { recipe, supported: false, reason: compatibility.reason }
      }
      if (!riskAllowed(recipe.risk, maxRisk)) {
        return { recipe, supported: false, reason: 'profile' }
      }
      return { recipe, supported: true }
    })
  }

  async run(recipe: Recipe, device: DeviceInfo, options: RunOptions = {}): Promise<RunResult> {
    const startedAt = new Date().toISOString()
    const dryRun = options.dryRun ?? false
    const steps: StepResult[] = []
    const journalSteps: JournalEntry['steps'] = []

    for (const [index, step] of recipe.steps.entries()) {
      const result = await this.executeStep(index, step, dryRun)
      steps.push(result)
      options.onProgress?.(result)

      if (!dryRun && result.status === 'ok') {
        journalSteps.push({
          index,
          run: step.run,
          undo: resolveUndo(step, result.previousValue ?? null),
          undoIfUnset: step.undoIfUnset,
          previousValue: result.previousValue ?? null,
          output: result.output,
          reversible: Boolean(resolveUndo(step, result.previousValue ?? null)),
        })
      }
    }

    if (!dryRun && journalSteps.length > 0) {
      this.journal.append({
        deviceId: device.id,
        deviceModel: `${device.manufacturer} ${device.model}`.trim(),
        recipeId: recipe.id,
        titleKey: recipe.titleKey,
        risk: recipe.risk,
        steps: journalSteps,
      })
    }

    return {
      recipeId: recipe.id,
      status: summarize(steps, dryRun),
      steps,
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun,
    }
  }

  async runAction(action: ActionSpec, device: DeviceInfo, pkg: string): Promise<StepResult> {
    if (action.paramKind === 'package' && action.blocklist?.includes(pkg)) {
      return {
        index: 0,
        run: action.run.replace('{{pkg}}', pkg),
        status: 'failed',
        output: '',
        error: 'Paquete protegido: no se puede modificar.',
        durationMs: 0,
      }
    }

    const step: StepSpec = {
      run: action.run.replace('{{pkg}}', pkg),
      verify: {
        ...action.verify,
        run: action.verify.run.replace('{{pkg}}', pkg),
        contains: action.verify.contains?.replace('{{pkg}}', pkg),
      },
      undo: action.undo ? action.undo.replace('{{pkg}}', pkg) : null,
      timeoutMs: action.timeoutMs,
    }

    const result = await this.executeStep(0, step, false)

    if (result.status === 'ok') {
      const undo = step.undo ?? null
      this.journal.append({
        deviceId: device.id,
        deviceModel: `${device.manufacturer} ${device.model}`.trim(),
        recipeId: `${action.id}:${pkg}`,
        titleKey: action.titleKey,
        risk: action.risk,
        steps: [
          {
            index: 0,
            run: step.run,
            undo,
            previousValue: result.previousValue ?? null,
            output: result.output,
            reversible: Boolean(undo),
          },
        ],
      })
    }

    return result
  }

  private async executeStep(index: number, step: StepSpec, dryRun: boolean): Promise<StepResult> {
    const startedAt = Date.now()
    const previousValue = await this.readValue(step.verify.run)

    if (dryRun) {
      return {
        index,
        run: step.run,
        status: 'skipped',
        output: previousValue ?? '',
        previousValue,
        durationMs: Date.now() - startedAt,
      }
    }

    try {
      const result = await this.client.shell(step.run, step.timeoutMs)
      const output = (result.stdout || result.stderr).trim()
      const verified = await this.verify(step.verify)

      if (!verified.ok) {
        return {
          index,
          run: step.run,
          status: 'failed',
          output,
          error: verified.detail,
          previousValue,
          durationMs: Date.now() - startedAt,
        }
      }

      return {
        index,
        run: step.run,
        status: 'ok',
        output,
        previousValue,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        index,
        run: step.run,
        status: 'failed',
        output: '',
        error: message,
        previousValue,
        durationMs: Date.now() - startedAt,
      }
    }
  }

  private async readValue(command: string): Promise<string | null> {
    try {
      const value = await this.client.shellText(command, 10_000)
      // `settings get` devuelve literal "null" cuando el ajuste no existe.
      if (value.length === 0 || value === 'null') return null
      return value
    } catch {
      return null
    }
  }

  private async verify(spec: VerifySpec): Promise<{ ok: boolean; detail: string }> {
    try {
      const result = await this.client.shell(spec.run, 10_000)
      const output = result.stdout.trim()

      if (spec.expectEmptyOrExitCode !== undefined) {
        const exitOk = result.code === spec.expectEmptyOrExitCode
        return {
          ok: output.length === 0 || exitOk,
          detail: `salida esperada vacia, se obtuvo: ${output}`,
        }
      }
      if (spec.equals !== undefined) {
        return { ok: output === spec.equals, detail: `se esperaba "${spec.equals}" y se obtuvo "${output}"` }
      }
      if (spec.contains !== undefined) {
        return {
          ok: output.includes(spec.contains),
          detail: `se esperaba contener "${spec.contains}" y se obtuvo "${output}"`,
        }
      }
      if (spec.matches !== undefined) {
        return {
          ok: new RegExp(spec.matches).test(output),
          detail: `se esperaba coincidir con /${spec.matches}/ y se obtuvo "${output}"`,
        }
      }
      return { ok: true, detail: 'sin condicion de verificacion' }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async undo(entryId: string): Promise<{ ok: boolean; steps: StepResult[] }> {
    const entry = this.journal.get(entryId)
    if (!entry) {
      throw new Error(`Entrada de bitacora no encontrada: ${entryId}`)
    }

    if (entry.deviceId !== this.client.deviceSerial) {
      throw new Error(
        'Conecta el mismo dispositivo donde se aplicaron los cambios antes de deshacerlos.',
      )
    }

    const steps: StepResult[] = []
    const ordered = [...entry.steps].reverse()
    let stopped = false

    for (const step of ordered) {
      const startedAt = Date.now()
      if (stopped) {
        steps.push({
          index: step.index,
          run: step.undo ?? step.run,
          status: 'skipped',
          output: '',
          error: 'Undo detenido por un fallo anterior',
          durationMs: 0,
        })
        continue
      }
      if (!step.reversible || !step.undo) {
        steps.push({
          index: step.index,
          run: step.run,
          status: 'skipped',
          output: '',
          error: 'Cambio no reversible',
          durationMs: 0,
        })
        continue
      }

      try {
        if (step.systemApp) {
          const output = await this.client.restoreSystemBundle(step.systemApp)
          steps.push({
            index: step.index,
            run: step.undo,
            status: 'ok',
            output,
            durationMs: Date.now() - startedAt,
          })
          continue
        }
        if (step.systemApk) {
          const output = await this.client.restoreSystemApk(step.systemApk)
          steps.push({
            index: step.index,
            run: step.undo,
            status: 'ok',
            output,
            durationMs: Date.now() - startedAt,
          })
          continue
        }
        const result = await this.client.shell(step.undo, 20_000)
        if (result.code !== 0) {
          throw new Error(
            result.stderr.trim() ||
              result.stdout.trim() ||
              `El comando de undo fallo con codigo ${result.code}.`,
          )
        }
        steps.push({
          index: step.index,
          run: step.undo,
          status: 'ok',
          output: (result.stdout || result.stderr).trim(),
          durationMs: Date.now() - startedAt,
        })
      } catch (error) {
        stopped = true
        steps.push({
          index: step.index,
          run: step.undo,
          status: 'failed',
          output: '',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        })
      }
    }

    if (steps.every((step) => step.status !== 'failed')) {
      this.journal.markReverted(entryId)
    }

    return { ok: steps.every((step) => step.status !== 'failed'), steps }
  }
}

export function resolveUndo(step: StepSpec, previousValue: string | null): string | null {
  if (!step.undo) return null
  if (!step.undo.includes('{{prev}}')) return step.undo
  if (previousValue === null || previousValue === 'null') {
    return step.undoIfUnset ?? null
  }
  return step.undo.replace(/\{\{prev\}\}/g, previousValue)
}

function summarize(steps: StepResult[], dryRun: boolean): RunResult['status'] {
  if (dryRun) return 'ok'
  const executed = steps.filter((step) => step.status !== 'skipped')
  if (executed.length === 0) return 'unsupported'
  if (executed.every((step) => step.status === 'ok')) return 'ok'
  if (executed.some((step) => step.status === 'ok')) return 'partial'
  return 'failed'
}
