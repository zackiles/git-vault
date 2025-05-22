import { join } from '@std/path'
import { exists } from '@std/fs'

const isWindows = Deno.build.os === 'windows'
const home = Deno.env.get('HOME') || '~'

// Define base name constant outside the PATHS object
const BASE_NAME = 'gv'

type PathsType = {
  BINARY_NAME: string
  BASE_NAME: string
  WINDOWS: {
    LOCAL_APP_DATA: string
    WINDOWS_APPS: string
    CHOCOLATEY: string
    CHOCOLATEY_LIB: string
  }
  UNIX: {
    LOCAL_BIN: string
    USR_BIN: string
    USER_LOCAL_BIN: string
  }
  PACKAGE_MANAGERS: {
    HOMEBREW_CELLAR: string
    LINUXBREW_CELLAR: string
  }
  getBinaryDirs(): string[]
  getBinaryName(baseName?: string): string
  isInstalledByHomebrew(execPath: string): boolean
  isInstalledByChocolatey(execPath: string): boolean
}

/**
 * Platform-specific binary names and paths
 */
export const PATHS: PathsType = {
  // Binary names
  BINARY_NAME: isWindows ? 'gv.exe' : 'gv',
  BASE_NAME,

  // Windows specific paths
  WINDOWS: {
    LOCAL_APP_DATA: Deno.env.get('LOCALAPPDATA') || join(home, 'AppData', 'Local'),
    get WINDOWS_APPS() {
      return join(this.LOCAL_APP_DATA, 'Microsoft', 'WindowsApps')
    },
    get CHOCOLATEY() {
      const chocoInstall = Deno.env.get('ChocolateyInstall')
      return chocoInstall || join('C:', 'ProgramData', 'chocolatey')
    },
    get CHOCOLATEY_LIB() {
      return join(this.CHOCOLATEY, 'lib', 'gv')
    },
  },

  // Unix specific paths
  UNIX: {
    LOCAL_BIN: '/usr/local/bin',
    USR_BIN: '/usr/bin',
    get USER_LOCAL_BIN() {
      return join(home, '.local', 'bin')
    },
  },

  // Package manager paths
  PACKAGE_MANAGERS: {
    HOMEBREW_CELLAR: '/Cellar/gv/',
    LINUXBREW_CELLAR: '/.linuxbrew/Cellar/gv/',
  },

  /**
   * Get common binary directories for the current platform
   */
  getBinaryDirs(): string[] {
    if (isWindows) {
      return [this.WINDOWS.WINDOWS_APPS]
    }
    return [
      this.UNIX.LOCAL_BIN,
      this.UNIX.USR_BIN,
      this.UNIX.USER_LOCAL_BIN,
    ]
  },

  /**
   * Get the binary name with optional platform-specific extension
   */
  getBinaryName(baseName = BASE_NAME): string {
    return isWindows ? `${baseName}.exe` : baseName
  },

  /**
   * Check if the path indicates gv was installed via Homebrew
   */
  isInstalledByHomebrew(execPath: string): boolean {
    return execPath.includes(this.PACKAGE_MANAGERS.HOMEBREW_CELLAR) ||
      execPath.includes(this.PACKAGE_MANAGERS.LINUXBREW_CELLAR)
  },

  /**
   * Check if the path indicates gv was installed via Chocolatey
   */
  isInstalledByChocolatey(execPath: string): boolean {
    const chocoInstall = Deno.env.get('ChocolateyInstall')
    const lowerExec = execPath.toLowerCase()
    if (chocoInstall) {
      const expected = join(chocoInstall, 'lib', 'gv').toLowerCase()
      if (lowerExec.startsWith(expected)) return true
    }
    return lowerExec.includes(join('programdata', 'chocolatey', 'lib', 'gv').toLowerCase())
  },
}

/**
 * Get platform-specific elevation instructions
 */
export const getElevationInstructions = (): string =>
  isWindows ? 'Try running as Administrator.' : 'Try running with sudo.'

/**
 * Checks if gv binary exists on the PATH
 */
async function isGitVaultOnPath(): Promise<boolean> {
  // In test mode with tempDir path, we should not assume gv is already installed
  if (Deno.env.get('DENO_ENV') === 'test') {
    // Check if the binary exists in the first PATH directory specifically
    const path = Deno.env.get('PATH') || ''
    const firstPath = path.split(isWindows ? ';' : ':')[0]
    if (firstPath) {
      return await exists(join(firstPath, PATHS.BINARY_NAME))
    }
  }

  // Normal check for other environments
  try {
    const cmd = new Deno.Command(
      isWindows ? 'where' : 'which',
      { args: [PATHS.BINARY_NAME] },
    )
    const { success } = await cmd.output()
    return success
  } catch {
    return false
  }
}

export { isGitVaultOnPath }
