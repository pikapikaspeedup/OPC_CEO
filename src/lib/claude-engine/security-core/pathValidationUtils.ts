// @ts-nocheck — lightweight stub for pathValidationUtils
import * as path from 'path'

export function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME || '/home/user', p.slice(1))
  }
  return p
}

export function formatDirectoryList(dirs: string[]): string {
  return dirs.map(d => `  - ${d}`).join('\n')
}

export function isDangerousRemovalPath(filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath)
  const dangerous = ['/', '/etc', '/usr', '/bin', '/sbin', '/var', '/tmp', '/home', '/root']
  return dangerous.includes(resolved)
}

export function validatePath(
  filePath: string,
  cwd: string,
  allowedDirs: string[],
): { valid: boolean; reason?: string } {
  const resolved = path.resolve(cwd, filePath)
  const isAllowed = allowedDirs.some(dir => resolved.startsWith(dir))
  if (!isAllowed) {
    return { valid: false, reason: `Path ${resolved} is outside allowed directories` }
  }
  return { valid: true }
}
