import { randomUUID } from 'node:crypto'
import { rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  isWithinPortableRoot,
  relocatePortablePath,
} from '@core/session/portable-relocation'
import Database from 'better-sqlite3'

const nativeTables = new Set([
  'meta',
  'task',
  'download_history',
  'sqlite_sequence',
  'download_history_files',
  'download_history_file_uris',
  'task_cookie_context',
  'task_cookie',
  'task_progress',
  'legacy_checkpoint_import',
  'legacy_checkpoint_file',
  'legacy_torrent_metadata',
  'task_http_context',
])
const canonical = (value: string) => path.win32.normalize(value).toLowerCase()

/**
 * Move only app-owned checkpoints from the pinned native schema. Never replay
 * serialized engine tasks, cookies, HTTP contexts or legacy identity receipts.
 * The original DB (including its WAL) remains the immutable retry source.
 */
export async function relocateEngineCheckpoints(
  source: string,
  destination: string,
  sourceRoot: string,
  targetRoot: string,
  ownedPaths: readonly string[]
): Promise<void> {
  try {
    await stat(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const temporary = `${destination}.relocating-${randomUUID()}`
  const original = new Database(source, { readonly: true, fileMustExist: true })
  try {
    // Future engine formats need an explicit migration; retain their originals.
    if (original.pragma('user_version', { simple: true }) !== 6) return
    await original.backup(temporary)
  } finally {
    original.close()
  }
  try {
    const db = new Database(temporary, { fileMustExist: true })
    try {
      const objects = db
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'trigger', 'view')"
        )
        .all() as Array<{ name: string; type: string }>
      if (
        objects.some(
          ({ name, type }) => type !== 'table' || !nativeTables.has(name)
        )
      )
        throw new Error('Unsupported portable engine checkpoint schema')
      const tables = new Set(objects.map(({ name }) => name))
      const legacy = new Set<string>()
      for (const table of [
        'legacy_checkpoint_import',
        'legacy_torrent_metadata',
      ]) {
        if (!tables.has(table)) continue
        for (const row of db
          .prepare(`SELECT gid FROM ${table}`)
          .all() as Array<{ gid: string }>)
          legacy.add(row.gid)
      }
      const owned = new Set(ownedPaths.map(canonical))
      const rows = db
        .prepare('SELECT rowid, gid, out_path FROM task_progress')
        .all() as Array<{ rowid: number; gid: string; out_path: string | null }>
      db.pragma('foreign_keys = OFF')
      db.pragma('secure_delete = ON')
      db.transaction(() => {
        const remove = db.prepare('DELETE FROM task_progress WHERE rowid = ?')
        const move = db.prepare(
          'UPDATE task_progress SET out_path = ? WHERE rowid = ?'
        )
        for (const row of rows) {
          if (
            !row.out_path ||
            !isWithinPortableRoot(row.out_path, sourceRoot) ||
            !owned.has(canonical(row.out_path)) ||
            legacy.has(row.gid)
          ) {
            remove.run(row.rowid)
            continue
          }
          // Native checkpoint keys use forward slashes. Its digest covers
          // piece lengths/bitfields, never the output path (motrix.24).
          move.run(
            relocatePortablePath(
              row.out_path,
              [sourceRoot],
              targetRoot
            ).replaceAll('\\', '/'),
            row.rowid
          )
        }
        for (const name of tables) {
          if (name !== 'meta' && name !== 'task_progress')
            db.exec(`DELETE FROM "${name}"`)
        }
      })()
      // Purge discarded serialized requests from free pages before publishing.
      db.exec('VACUUM')
      if (
        db.pragma('quick_check', { simple: true }) !== 'ok' ||
        (db.pragma('foreign_key_check') as unknown[]).length
      )
        throw new Error('Portable engine checkpoint integrity check failed')
    } finally {
      db.close()
    }
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}
