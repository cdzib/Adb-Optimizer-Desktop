import { afterEach, describe, expect, it } from 'vitest'
import { assertLabAllowed, isLabMode, labAllowedSerials } from '../src/main/lab'

afterEach(() => {
  delete process.env.ADB_OPTIMIZER_LAB
  delete process.env.ADB_OPTIMIZER_LAB_SERIALS
})

describe('modo laboratorio', () => {
  it('no bloquea nada si está desactivado', () => {
    expect(isLabMode()).toBe(false)
    expect(() => assertLabAllowed('R58XB0APW0J', 'flashear')).not.toThrow()
  })

  it('bloquea dispositivos reales y permite emuladores al activarse', () => {
    process.env.ADB_OPTIMIZER_LAB = '1'
    expect(isLabMode()).toBe(true)
    expect(() => assertLabAllowed('emulator-5554', 'flashear')).not.toThrow()
    expect(() => assertLabAllowed('R58XB0APW0J', 'flashear')).toThrow('Modo laboratorio activo')
  })

  it('permite seriales explícitos de un equipo de pruebas', () => {
    process.env.ADB_OPTIMIZER_LAB = '1'
    process.env.ADB_OPTIMIZER_LAB_SERIALS = 'EQUIPO-1, EQUIPO-2'
    expect(labAllowedSerials()).toEqual(['EQUIPO-1', 'EQUIPO-2'])
    expect(() => assertLabAllowed('EQUIPO-2', 'convertir')).not.toThrow()
    expect(() => assertLabAllowed('EQUIPO-3', 'convertir')).toThrow('no está permitido')
  })

  it('exige un dispositivo cuando el modo está activo', () => {
    process.env.ADB_OPTIMIZER_LAB = '1'
    expect(() => assertLabAllowed(undefined, 'flashear')).toThrow('no hay dispositivo')
  })
})
