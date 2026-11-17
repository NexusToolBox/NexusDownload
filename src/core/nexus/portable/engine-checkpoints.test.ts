// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { relocateEngineCheckpoints } from './engine-checkpoints'

it('moves only owned native bitfields, keeps the WAL source, and purges request data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexus-checkpoints-'))
  const source = path.join(directory, 'source.db')
  const db = new Database(source)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('wal_autocheckpoint = 0')
    db.exec(`PRAGMA user_version = 6;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE task (gid TEXT PRIMARY KEY, serialized TEXT);
      CREATE TABLE task_cookie (gid TEXT, value TEXT);
      CREATE TABLE task_http_context (gid TEXT, output_path TEXT);
      CREATE TABLE legacy_checkpoint_import (gid TEXT);
      CREATE TABLE task_progress (gid TEXT, out_path TEXT UNIQUE, bitfield BLOB, digest BLOB);`)
    const transient = randomBytes(32).toString('hex')
    db.prepare('INSERT INTO task VALUES (?,?)').run('owned', transient)
    db.prepare('INSERT INTO task_cookie VALUES (?,?)').run('owned', transient)
    db.prepare('INSERT INTO task_http_context VALUES (?,?)').run(
      'owned',
      'E:/App/data/a'
    )
    db.prepare('INSERT INTO legacy_checkpoint_import VALUES (?)').run('legacy')
    const insert = db.prepare('INSERT INTO task_progress VALUES (?,?,?,?)')
    for (const [gid, location] of [
      ['owned', 'E:/App/data/a'],
      ['external', 'D:/Other/a'],
      ['unowned', 'E:/App/data/unowned'],
      ['legacy', 'E:/App/data/legacy'],
      ['pathless', null],
    ])
      insert.run(gid, location, Buffer.from([0x80]), Buffer.from([1, 2]))
    for (const [index, targetRoot] of [
      'F:\\App',
      'G:\\App\\nested',
    ].entries()) {
      const destination = path.join(directory, `moved-${index}.db`)
      await relocateEngineCheckpoints(
        source,
        destination,
        'E:\\App',
        targetRoot,
        ['E:\\App\\data\\a', 'D:\\Other\\a', 'E:\\App\\data\\legacy']
      )
      const moved = new Database(destination, { readonly: true })
      try {
        expect(moved.prepare('SELECT * FROM task_progress').all()).toEqual([
          {
            gid: 'owned',
            out_path: `${targetRoot.replaceAll('\\', '/')}/data/a`,
            bitfield: Buffer.from([0x80]),
            digest: Buffer.from([1, 2]),
          },
        ])
        for (const table of [
          'task',
          'task_cookie',
          'task_http_context',
          'legacy_checkpoint_import',
        ])
          expect(
            moved.prepare(`SELECT count(*) AS n FROM ${table}`).get()
          ).toEqual({ n: 0 })
        expect(moved.pragma('quick_check', { simple: true })).toBe('ok')
      } finally {
        moved.close()
      }
      expect(
        (await readFile(destination)).includes(Buffer.from(transient))
      ).toBe(false)
    }
    expect(db.prepare('SELECT count(*) AS n FROM task_progress').get()).toEqual(
      { n: 5 }
    )
    expect(db.prepare('SELECT count(*) AS n FROM task').get()).toEqual({ n: 1 })
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})

it('does not reinterpret an unknown native format', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexus-checkpoints-'))
  const source = path.join(directory, 'source.db')
  const db = new Database(source)
  try {
    db.pragma('user_version = 7')
    const destination = path.join(directory, 'moved.db')
    await relocateEngineCheckpoints(
      source,
      destination,
      'E:\\App',
      'F:\\App',
      []
    )
    await expect(readFile(destination)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
