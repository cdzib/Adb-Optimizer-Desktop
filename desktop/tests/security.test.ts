import { describe, expect, it } from 'vitest'
import {
  isNavigationAllowed,
  isSafeExternalUrl,
  resolveLocale,
} from '../src/main/security'

describe('politica de seguridad de la ventana', () => {
  it('solo permite locales conocidos', () => {
    expect(resolveLocale('es')).toBe('es')
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('../../etc/passwd')).toBe('es')
    expect(resolveLocale(undefined)).toBe('es')
  })

  it('solo abre enlaces http y https', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/docs')).toBe(true)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeExternalUrl('no-es-una-url')).toBe(false)
  })

  it('permite navegar dentro del mismo documento en produccion', () => {
    const current = 'file:///opt/app/dist/renderer/index.html'
    expect(isNavigationAllowed(current, current)).toBe(true)
    expect(isNavigationAllowed('file:///etc/passwd', current)).toBe(false)
    expect(isNavigationAllowed('file:///opt/app/dist/renderer/../../secret.html', current)).toBe(false)
  })

  it('permite el mismo origen del dev server y bloquea otros', () => {
    const current = 'http://localhost:5173/'
    expect(isNavigationAllowed('http://localhost:5173/index.html', current)).toBe(true)
    expect(isNavigationAllowed('http://localhost:5174/', current)).toBe(false)
    expect(isNavigationAllowed('https://evil.example/', current)).toBe(false)
    expect(isNavigationAllowed('javascript:alert(1)', current)).toBe(false)
    expect(isNavigationAllowed('data:text/html,hola', current)).toBe(false)
  })
})
