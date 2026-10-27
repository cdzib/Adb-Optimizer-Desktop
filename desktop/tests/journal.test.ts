import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Journal } from '../src/main/optimization/journal'
import type { JournalEntry } from '../src/shared/types'

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'j_test',
    deviceId: '192.168.1.40:5555',
    deviceModel: 'Chromecast HD',
    recipeId: 'animations-off',
    titleKey: 'recipe.animations_off.title',
    risk: 'safe',
    appliedAt: new Date().toISOString(),
    steps: [],
    ...overrides,
  }
}

function tempJournal(): string {
  return join(mkdtempSync(join(tmpdir(), 'journal-')), 'journal.json')
}

describe('Journal', () => {
  it('arranca vacio cuando el archivo no existe', () => {
    const journal = new Journal(tempJournal())
    expect(journal.list()).toEqual([])
    expect(journal.lastLoadError).toBeNull()
  })

  it('lee el formato legacy (array)', () => {
    const file = tempJournal()
    const stored = entry()
    writeFileSync(file, JSON.stringify([stored]), 'utf8')

    const journal = new Journal(file)
    expect(journal.list()).toHaveLength(1)
    expect(journal.get('j_test')?.recipeId).toBe('animations-off')
    expect(journal.lastLoadError).toBeNull()
  })

  it('lee el formato versionado y lo conserva al escribir', () => {
    const file = tempJournal()
    writeFileSync(file, JSON.stringify({ version: 1, entries: [entry()] }), 'utf8')

    const journal = new Journal(file)
    journal.append({
      deviceId: '192.168.1.40:5555',
      deviceModel: 'Chromecast HD',
      recipeId: 'doze',
      titleKey: 'recipe.doze.title',
      risk: 'moderate',
      steps: [],
    })

    const raw = JSON.parse(readFileSync(file, 'utf8')) as { version: number; entries: JournalEntry[] }
    expect(raw.version).toBe(1)
    expect(raw.entries).toHaveLength(2)
    expect(raw.entries[0]?.recipeId).toBe('doze')
  })

  it('respalda una bitacora corrupta y reporta el problema', () => {
    const file = tempJournal()
    writeFileSync(file, '{ esto no es json', 'utf8')

    const journal = new Journal(file)
    expect(journal.list()).toEqual([])
    expect(journal.lastLoadError).toMatch(/JSON|formato|bitacora/i)
    expect(readdirSync(join(file, '..')).some((name) => name.includes('.corrupt-'))).toBe(true)
  })

  it('descarta entradas invalidas sin perder las validas', () => {
    const file = tempJournal()
    writeFileSync(
      file,
      JSON.stringify({ version: 1, entries: [entry(), { id: 'sin-pasos' }] }),
      'utf8',
    )

    const journal = new Journal(file)
    expect(journal.list()).toHaveLength(1)
    expect(journal.lastLoadError).toMatch(/invalidas/)
  })

  it('limita el crecimiento a 500 entradas', () => {
    const file = tempJournal()
    const entries = Array.from({ length: 500 }, (_, index) =>
      entry({ id: `j_${index}`, recipeId: `recipe-${index}` }),
    )
    writeFileSync(file, JSON.stringify({ version: 1, entries }), 'utf8')

    const journal = new Journal(file)
    journal.append({
      deviceId: '192.168.1.40:5555',
      deviceModel: 'Chromecast HD',
      recipeId: 'nueva',
      titleKey: 'recipe.nueva.title',
      risk: 'safe',
      steps: [],
    })

    expect(journal.list()).toHaveLength(500)
    expect(journal.list()[0]?.recipeId).toBe('nueva')
  })

  it('persiste y recarga las entradas', () => {
    const file = tempJournal()
    const journal = new Journal(file)
    journal.append({
      deviceId: '192.168.1.40:5555',
      deviceModel: 'Chromecast HD',
      recipeId: 'animations-off',
      titleKey: 'recipe.animations_off.title',
      risk: 'safe',
      steps: [{ index: 0, run: 'echo ok', undo: null, previousValue: null, output: 'ok', reversible: false }],
    })

    const reloaded = new Journal(file)
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.list()[0]?.steps[0]?.run).toBe('echo ok')
  })
})
