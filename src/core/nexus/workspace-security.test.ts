import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  accountRefSchema,
  classificationRuleSchema,
  nexusPreferencesSchema,
} from '@shared/schemas/nexus-workspace'
import { afterEach, describe, expect, it } from 'vitest'
import { classifiedDirectory } from './classification'
import { recognizeSources } from './source-recognizer'
import { NexusWorkspace } from './workspace'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
describe('Nexus source and credential boundaries', () => {
  it('keeps signed parameters and share extraction material out of persisted evidence', async () => {
    const secret = randomBytes(24).toString('hex')
    const root = await mkdtemp(path.join(tmpdir(), 'nexus-workspace-'))
    roots.push(root)
    const file = path.join(root, 'workspace.json')
    const workspace = new NexusWorkspace({
      file,
      defaultDirectory: () => root,
      changed: () => {},
    })
    await workspace.collect({
      input: `分享 https://pan.quark.cn/s/resource 提取码：${secret}`,
    })
    const persisted = await readFile(file, 'utf8')
    expect(persisted.includes(secret)).toBe(false)
    const signed = recognizeSources(
      `https://example.test/file.zip?signature=${secret}`
    )
    expect(JSON.stringify(signed[0].entry).includes(secret)).toBe(false)
    expect(JSON.stringify(signed[0].entry).includes('signature=')).toBe(false)
  })
  it('returns an original offline source only for a live collected entry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexus-offline-input-'))
    roots.push(root)
    const options = {
      file: path.join(root, 'workspace.json'),
      defaultDirectory: () => root,
      changed: () => {},
    }
    const workspace = new NexusWorkspace(options)
    const source = `https://example.test/file.zip?signature=${randomBytes(24).toString('hex')}`
    await workspace.collect({ input: source })
    const entry = workspace.snapshot().inbox[0]
    expect(workspace.cloudInput(entry.id)).toBe(source)
    expect(workspace.cloudInput('missing')).toBe('')
    const restarted = new NexusWorkspace(options)
    expect(restarted.cloudInput(entry.id)).toBe('')
    await workspace.discard({ ids: [entry.id] })
    expect(workspace.cloudInput(entry.id)).toBe('')
  })
  it('recognizes and deduplicates ordinary links, magnets and six cloud platforms', () => {
    const hash = randomBytes(20).toString('hex')
    const input = [
      'https://example.test/file.zip',
      'https://example.test/file.zip',
      `magnet:?xt=urn:btih:${hash}`,
      'https://pan.baidu.com/s/resource',
      'https://pan.quark.cn/s/resource',
      'https://drive.uc.cn/s/resource',
      'https://www.alipan.com/s/resource',
      'https://115.com/s/resource',
      'https://www.123pan.com/s/resource',
    ].join(' ')
    expect(
      recognizeSources(input).map((value) => value.entry.source.platform)
    ).toEqual([
      'http',
      'magnet',
      'baidu',
      'quark',
      'uc',
      'aliyun',
      '115',
      '123',
    ])
  })
  it('rejects credential values and unsupported account fields', () => {
    const secret = randomBytes(24).toString('hex')
    const account = {
      id: 'account',
      platform: 'baidu',
      identity: 'user',
      credentialRef: 'vault-ref',
      authorization: 'official-login',
      governor: 'conservative',
    }
    expect(accountRefSchema.safeParse(account).success).toBe(true)
    expect(
      accountRefSchema.safeParse({ ...account, token: secret }).success
    ).toBe(false)
    expect(
      recognizeSources(`https://user:${secret}@example.test/file.zip`)
        .length === 0
    ).toBe(true)
  })
  it('retains only source identities across restart and requires original input again', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexus-workspace-'))
    roots.push(root)
    const options = {
      file: path.join(root, 'workspace.json'),
      defaultDirectory: () => root,
      changed: () => {},
    }
    const before = new NexusWorkspace(options)
    await before.collect({ input: 'https://pan.baidu.com/s/resource' })
    const after = new NexusWorkspace(options)
    await after.load()
    expect(after.snapshot().inbox).toHaveLength(1)
    expect(after.snapshot().availableInputIds).toHaveLength(0)
    expect(
      (
        await after.preflight({
          ids: after.snapshot().inbox.map((entry) => entry.id),
        })
      ).items[0].available
    ).toBe(false)
  })
})
describe('classification destinations', () => {
  it('rejects traversal, absolute paths, reserved devices and alternate data streams', () => {
    for (const directory of [
      '../outside',
      'C:\\outside',
      '\\outside',
      'CON',
      'video:stream',
      'video/../outside',
      'video.',
    ]) {
      expect(
        classificationRuleSchema.safeParse({
          id: 'rule',
          enabled: true,
          kind: 'type',
          value: 'video',
          directory,
        }).success
      ).toBe(false)
    }
  })
  it('uses first matching rule and rejects a junction escaping the selected root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nexus-path-'))
    roots.push(root)
    const base = path.join(root, 'downloads')
    const outside = path.join(root, 'outside')
    await mkdir(base)
    await mkdir(outside)
    const entry = recognizeSources('https://example.test/film.mp4')[0].entry
    const preferences = nexusPreferencesSchema.parse({})
    expect(await classifiedDirectory(base, entry, preferences)).toBe(
      path.join(base, '视频')
    )
    await symlink(
      outside,
      path.join(base, '视频'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await expect(
      classifiedDirectory(base, entry, preferences)
    ).rejects.toThrow()
  })
})
