import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSupported, loadCatalog } from '../src/main/optimization/catalog'
import { resolveUndo } from '../src/main/optimization/recipe-engine'
import type { DeviceInfo } from '../src/shared/types'
import { findSharedDir } from './fake-runner'

const sharedDir = findSharedDir()
const { catalog, actions } = loadCatalog(sharedDir)

const phone: DeviceInfo = {
  id: 'x',
  model: 'Pixel',
  manufacturer: 'Google',
  sdk: 34,
  androidVersion: '14',
  isTv: false,
  hasRoot: false,
  abi: 'arm64-v8a',
}

const tv: DeviceInfo = { ...phone, model: 'Chromecast', isTv: true, sdk: 31 }

describe('catalogo compartido', () => {
  it('valida contra el JSON Schema y no tiene ids duplicados', () => {
    expect(catalog.schemaVersion).toBe(1)
    expect(catalog.recipes.length).toBeGreaterThan(0)
    expect(actions.actions.length).toBeGreaterThan(0)
  })

  it('solo permite WanboOS como receta de sistema que requiere root', () => {
    expect(catalog.recipes.filter((recipe) => recipe.requiresRoot).map((recipe) => recipe.id)).toEqual([
      'wanboos-launcher',
    ])
    const launcher = catalog.recipes.find((recipe) => recipe.id === 'wanboos-launcher')
    expect(launcher?.steps[0]).toMatchObject({
      type: 'installSystemApk',
      targetPath: '/system/priv-app/WanboOSLauncher/WanboOSLauncher.apk',
      mode: '0644',
      owner: '0:0',
      selinuxContext: 'u:object_r:system_file:s0',
      disablePackages: ['com.google.android.tvlauncher'],
    })
    expect(launcher?.steps[0]?.verify.contains).toBe('com.tv.launcher.custom')
    expect(launcher?.steps[0]?.undo).toContain('restoreSystemApk')
  })

  it('toda receta con mas de un paso tiene undo o es explicitamente irreversible', () => {
    for (const recipe of catalog.recipes) {
      for (const step of recipe.steps) {
        if (step.undo === undefined) {
          expect(step.undo, `${recipe.id}/${step.run} debe declarar undo o null`).toBeNull()
        }
      }
    }
  })

  it('cada titleKey y summaryKey existe en es y en', () => {
    const dictionaries = ['es', 'en'].map((locale) =>
      JSON.parse(readFileSync(join(sharedDir, 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>,
    )

    for (const recipe of catalog.recipes) {
      for (const dictionary of dictionaries) {
        expect(dictionary[recipe.titleKey], recipe.titleKey).toBeTruthy()
        expect(dictionary[recipe.summaryKey], recipe.summaryKey).toBeTruthy()
      }
    }

    for (const action of actions.actions) {
      for (const dictionary of dictionaries) {
        expect(dictionary[action.titleKey], action.titleKey).toBeTruthy()
      }
    }
  })

  it('respeta appliesTo por dispositivo', () => {
    const tvOnly = catalog.recipes.find((recipe) => recipe.appliesTo.isTv === true)
    expect(tvOnly).toBeDefined()
    if (!tvOnly) return

    expect(isSupported(tvOnly, phone).supported).toBe(false)
    expect(isSupported(tvOnly, tv).supported).toBe(true)
  })

  it('resolveUndo usa el valor previo y cae al borrado cuando no habia valor', () => {
    const recipe = catalog.recipes.find((item) => item.id === 'animations-off')
    expect(recipe).toBeDefined()
    const step = recipe?.steps[0]
    if (!step) return

    expect(resolveUndo(step, '1')).toBe('settings put global window_animation_scale 1')
    expect(resolveUndo(step, 'null')).toBe('settings delete global window_animation_scale')
    expect(resolveUndo(step, null)).toBe('settings delete global window_animation_scale')
  })
})
