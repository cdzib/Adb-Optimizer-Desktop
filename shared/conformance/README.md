# Conformance suite

Casos compartidos que **Kotlin y TypeScript deben parsear exactamente igual**.

Cada caso es un fixture:

```json
{
  "id": "meminfo-tv-1080p",
  "command": "dumpsys meminfo",
  "stdout": "...",
  "expected": {
    "totalKb": 2097152,
    "usedKb": 1200000,
    "freeKb": 897152,
    "cachedKb": 400000
  }
}
```

Reglas:

1. Un fixture nuevo solo se acepta si se capturo de un dispositivo real (indicar `capturedOn` y `sdk`).
2. Los fixtures marcados `synthetic: true` son placeholders de Fase 0 y **deben** reemplazarse antes del release.
3. `pnpm test:conformance` y `./gradlew :core:adb:test` consumen los mismos archivos.
4. Si un parser tolera una variante (Samsung vs AOSP), se agrega un caso, no un `if` en el codigo.
