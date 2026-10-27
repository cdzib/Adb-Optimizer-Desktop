import { describe, expect, it } from 'vitest'
import {
  assertComponentName,
  assertHostPort,
  assertLocale,
  assertPackageName,
  assertPort,
} from '../src/main/validation'

describe('validacion de datos del renderer', () => {
  it('acepta nombres de paquete normales', () => {
    expect(assertPackageName('com.example.app')).toBe('com.example.app')
    expect(assertPackageName('com.android.systemui')).toBe('com.android.systemui')
  })

  it('rechaza inyeccion y nombres incompletos', () => {
    expect(() => assertPackageName('com.foo; reboot')).toThrow(/no es valido/)
    expect(() => assertPackageName('com.foo\nreboot')).toThrow(/no es valido/)
    expect(() => assertPackageName('com')).toThrow(/no es valido/)
    expect(() => assertPackageName('../../etc/passwd')).toThrow(/no es valido/)
    expect(() => assertPackageName(42)).toThrow(/no es valido/)
  })

  it('acepta componentes de receiver y rechaza inyeccion', () => {
    expect(assertComponentName('com.test.dpc/.Admin')).toBe('com.test.dpc/.Admin')
    expect(assertComponentName('com.test.dpc/com.test.dpc.Admin$Receiver')).toBe(
      'com.test.dpc/com.test.dpc.Admin$Receiver',
    )
    expect(() => assertComponentName('com.test.dpc/.Admin; reboot')).toThrow(/componente/)
    expect(() => assertComponentName('com.test.dpc')).toThrow(/componente/)
  })

  it('acepta IPv4, IPv6 y hostname con puerto', () => {
    expect(assertHostPort('192.168.1.40:5555')).toBe('192.168.1.40:5555')
    expect(assertHostPort('[fe80::1]:41021')).toBe('[fe80::1]:41021')
    expect(assertHostPort('android-tv.local:5555')).toBe('android-tv.local:5555')
  })

  it('rechaza opciones de adb, puertos invalidos y metacaracteres', () => {
    expect(() => assertHostPort('-l')).toThrow(/no es valida/)
    expect(() => assertHostPort('192.168.1.40:0')).toThrow(/host:puerto/)
    expect(() => assertHostPort('192.168.1.40:70000')).toThrow(/host:puerto/)
    expect(() => assertHostPort('192.168.1.40:5555; reboot')).toThrow(/caracteres/)
    expect(() => assertHostPort('192.168.1.40')).toThrow(/host:puerto/)
    expect(() => assertHostPort('[fe80::1]:5555')).not.toThrow()
  })

  it('valida puertos e idiomas', () => {
    expect(assertPort(5555)).toBe(5555)
    expect(() => assertPort(0)).toThrow(/puerto/)
    expect(() => assertPort(Number.NaN)).toThrow(/puerto/)
    expect(assertLocale('es')).toBe('es')
    expect(assertLocale('en')).toBe('en')
    expect(() => assertLocale('../es')).toThrow(/idioma/)
  })
})
