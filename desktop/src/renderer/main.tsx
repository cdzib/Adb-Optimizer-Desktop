import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, readThemePreference } from './lib/theme'
import './styles.css'

// Se resuelve antes de montar para que no parpadee el tema claro.
applyTheme(readThemePreference())

const container = document.getElementById('root')
if (!container) {
  throw new Error('No se encontro el nodo #root')
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
