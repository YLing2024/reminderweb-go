#!/usr/bin/env node
// 验收工具：用「旧实现」（Node + TS，只读导入，不修改旧仓库）生成备份 zip。
//
// 用途：验证新 Go 实现能导入旧实现现场导出的备份（加密 / 明文各一份）。
// 旧仓库路径可用环境变量 OLD_REPO 覆盖，默认 ../../ReminderWeb。
//
// 用法：node tools/old-backup-export.mjs <reminder.db> <out.zip> [encrypted|plain]

import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const [dbPath, outPath, mode = 'encrypted'] = process.argv.slice(2)
if (!dbPath || !outPath) {
  console.error('用法：node tools/old-backup-export.mjs <reminder.db> <out.zip> [encrypted|plain]')
  process.exit(2)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const oldRepo = resolve(process.env.OLD_REPO ?? join(root, '..', 'ReminderWeb'))
const load = (relative) => import(pathToFileURL(join(oldRepo, relative)).href)

const { readServerData } = await load('server/src/data.ts')
const { buildBackupMetadata, encodeArchive } = await load('server/src/backup-format.ts')

const db = new DatabaseSync(dbPath, { readOnly: true })
const server = readServerData(db)
db.close()

const metadataJson = buildBackupMetadata(server)
const zip = encodeArchive({ metadataJson }, mode === 'encrypted')
writeFileSync(outPath, zip)

const parsed = JSON.parse(metadataJson)
console.log(
  JSON.stringify(
    {
      out: outPath,
      mode,
      bytes: zip.length,
      reminders: parsed.reminders.length,
      tags: parsed.tags.length,
      hasWebdavCredentials: ['webDavServer', 'webDavUsername', 'webDavPassword', 'webDavPath'].some(
        (key) => key in parsed,
      ),
    },
    null,
    2,
  ),
)
