import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'
import type { ActionCatalog, ActionSpec, Catalog, DeviceInfo, Recipe, Risk } from '../../shared/types'

export interface CatalogBundle {
  catalog: Catalog
  actions: ActionCatalog
}

export function loadCatalog(sharedDir: string): CatalogBundle {
  const schema = JSON.parse(readFileSync(join(sharedDir, 'recipes', 'schema.json'), 'utf8'))
  const catalog = JSON.parse(readFileSync(join(sharedDir, 'recipes', 'recipes.json'), 'utf8')) as Catalog
  const actions = JSON.parse(readFileSync(join(sharedDir, 'recipes', 'actions.json'), 'utf8')) as ActionCatalog

  const ajv = new Ajv({ allErrors: true, strict: false })
  const validate = ajv.compile<Catalog | ActionCatalog>(schema)

  if (!validate(catalog)) {
    throw new Error(`recipes.json invalido: ${ajv.errorsText(validate.errors)}`)
  }
  if (!validate(actions)) {
    throw new Error(`actions.json invalido: ${ajv.errorsText(validate.errors)}`)
  }

  assertUniqueIds(catalog.recipes.map((recipe: Recipe) => `recipe:${recipe.id}`))
  assertUniqueIds(actions.actions.map((action: ActionSpec) => `action:${action.id}`))

  return { catalog, actions }
}

function assertUniqueIds(ids: string[]): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Id duplicado en el catalogo: ${id}`)
    }
    seen.add(id)
  }
}

/** Filtra recetas por compatibilidad real con el dispositivo objetivo. */
export function isSupported(recipe: Recipe, device: DeviceInfo): { supported: boolean; reason?: string } {
  if (recipe.steps.some((step) => step.type === 'installSystemApk')) {
    return { supported: false, reason: 'specializedFlow' }
  }
  if (recipe.requiresRoot && !device.hasRoot) {
    return { supported: false, reason: 'requiresRoot' }
  }
  if (recipe.appliesTo.minSdk && device.sdk < recipe.appliesTo.minSdk) {
    return { supported: false, reason: 'minSdk' }
  }
  if (recipe.appliesTo.maxSdk && device.sdk > recipe.appliesTo.maxSdk) {
    return { supported: false, reason: 'maxSdk' }
  }
  if (recipe.appliesTo.isTv === true && !device.isTv) {
    return { supported: false, reason: 'tvOnly' }
  }
  if (recipe.appliesTo.isTv === false && device.isTv) {
    return { supported: false, reason: 'phoneOnly' }
  }
  if (recipe.appliesTo.manufacturers && recipe.appliesTo.manufacturers.length > 0) {
    const matches = recipe.appliesTo.manufacturers.some(
      (brand) => brand.toLowerCase() === device.manufacturer.toLowerCase(),
    )
    if (!matches) {
      return { supported: false, reason: 'manufacturer' }
    }
  }
  return { supported: true }
}

const RISK_ORDER: Record<Risk, number> = { safe: 0, moderate: 1, advanced: 2 }

export function riskAllowed(risk: Risk, maxRisk: Risk): boolean {
  return RISK_ORDER[risk] <= RISK_ORDER[maxRisk]
}
