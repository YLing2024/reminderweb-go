#!/usr/bin/env node
// 验收工具：用「旧实现」（Node + TS，只读导入，不修改旧仓库）解码并核对备份 zip。
//
// 用途：验证新 Go 实现导出的备份能被旧实现的导入路径读回（结构、条数、设置键一致）。
// 旧仓库路径可用环境变量 OLD_REPO 覆盖，默认 ../../ReminderWeb。
//
// 用法：node tools/old-backup-read.mjs <backup.zip>

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const zipPath = process.argv[2]
if (!zipPath) {
  console.error('用法：node tools/old-backup-read.mjs <backup.zip>')
  process.exit(2)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const oldRepo = resolve(process.env.OLD_REPO ?? join(root, '..', 'ReminderWeb'))
const load = (relative) => import(pathToFileURL(join(oldRepo, relative)).href)

const { decodeArchive, parseBackupMetadata } = await load('server/src/backup-format.ts')

const bytes = new Uint8Array(readFileSync(zipPath))
const content = decodeArchive(bytes)
// updatedAt 传 0：只关心能读回哪些条目与设置，不关心合并时钟。
const parsed = parseBackupMetadata(content.metadataJson, 0)
const raw = JSON.parse(content.metadataJson)
const credentialKeys = ['webDavServer', 'webDavUsername', 'webDavPassword', 'webDavPath']

console.log(
  JSON.stringify(
    {
      zip: zipPath,
      reminders: parsed.reminders.length,
      tags: parsed.tags.length,
      rejected: parsed.rejected,
      settingsKeys: parsed.settings ? Object.keys(parsed.settings.value).sort() : [],
      images: Object.keys(content.images).sort(),
      hasWebdavCredentials: credentialKeys.some((key) => key in raw),
    },
    null,
    2,
  ),
)
