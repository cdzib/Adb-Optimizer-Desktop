# ADR-006 — Bitácora en JSON con escritura atómica

## Contexto
Cada cambio debe poder revertirse con el valor previo real del dispositivo.

## Decisión
`ChangeJournal` guarda `JournalEntry[]` en un JSON local (tmp + rename) en:
- Android: `filesDir/change-journal.json`
- Escritorio: `userData/journal.json`

Lo hace `append` al terminar una receta con al menos un paso OK, y `markReverted` al deshacer.

## Motivos
Volumen bajo (decenas de entradas), cero dependencias nativas, fácil de inspeccionar y
exportar como evidencia.

## Consecuencias
- (−) Sin consultas ni índices. Cuando supere ~5.000 entradas hay que migrar a Room/SQLite;
  el puerto (`ChangeJournal`) permite hacerlo sin tocar el motor.
- (+) Sobrevive a cierres inesperados gracias a la escritura atómica.
