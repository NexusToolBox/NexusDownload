import childProcess from 'node:child_process'
import path from 'node:path'

/** Electron 45's system theme getter also follows themeSource on Windows. */
export function readWindowsTaskbarTheme(): Promise<'light' | 'dark' | null> {
  const regExe = path.win32.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'reg.exe'
  )
  return new Promise((resolve) => {
    try {
      childProcess.execFile(
        regExe,
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
          '/v',
          'SystemUsesLightTheme',
          '/reg:64',
        ],
        { windowsHide: true, timeout: 2000, maxBuffer: 4096, encoding: 'utf8' },
        (error, stdout) => {
          const value = !error
            ? /SystemUsesLightTheme\s+REG_DWORD\s+0x([01])\b/i.exec(stdout)?.[1]
            : undefined
          resolve(value === '0' ? 'dark' : value === '1' ? 'light' : null)
        }
      )
    } catch {
      resolve(null)
    }
  })
}
