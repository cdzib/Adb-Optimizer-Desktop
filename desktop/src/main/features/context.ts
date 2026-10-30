import type { IpcMain } from 'electron'
import type { AdbClient } from '../adb/adb-client'

/**
 * Contexto que recibe cada modulo de feature al registrar sus canales IPC.
 *
 * El cliente ADB es la sesion unica del proceso main: ya apunta al dispositivo
 * conectado. Las features no crean clientes ni leen variables de entorno.
 */
export interface FeatureContext {
  client: AdbClient
  /** app.getPath('userData'): journal, respaldos y estado de las features. */
  dataDir: string
  /** Evento dirigido a la ventana activa. */
  send: (channel: string, payload: unknown) => void
  log: (line: string) => void
}

export type FeatureRegister = (ipc: IpcMain, ctx: FeatureContext) => void

/** Falla con un mensaje accionable cuando el usuario no ha conectado un equipo. */
export function requireDevice(client: AdbClient): AdbClient {
  if (!client.deviceSerial) {
    throw new Error('Conecta un dispositivo para usar esta funcion.')
  }
  return client
}
