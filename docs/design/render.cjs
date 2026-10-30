const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const inputs = process.argv.slice(2)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

app.whenReady().then(async () => {
  for (const input of inputs) {
    const file = resolve(input)
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: { offscreen: true, sandbox: true },
    })
    await win.loadFile(file)
    const [width, height] = await win.webContents.executeJavaScript(
      `(() => { const s = document.querySelector('svg'); return [Number(s.getAttribute('width')), Number(s.getAttribute('height'))] })()`,
    )
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Page.enable')
    const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })
    const output = file.replace(/\.svg$/i, '.png')
    writeFileSync(output, Buffer.from(shot.data, 'base64'))
    console.log(output, `${width}x${height} @2x`)
    win.webContents.debugger.detach()
    win.destroy()
  }
  app.quit()
})
