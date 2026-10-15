#!/usr/bin/env node
// 验收工具：用「旧实现」的备份封装逻辑，把一段 metadata.json 打包成备份 zip。
//
// 用途：模拟「远端被人改了」——手工构造一份含目标变更的备份，直接 PUT 到假 WebDAV，
// 再让新实现拉取，验证远端→本地方向。
// 旧仓库路径可用环境变量 OLD_REPO 覆盖，默认 ../../ReminderWeb。
//
// 用法：node tools/backup-build.mjs <metadata.json> <out.zip> [encrypted|plain]

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const [metadataPath, outPath, mode = 'encrypted'] = process.argv.slice(2)
if (!metadataPath || !outPath) {
  console.error('用法：node tools/backup-build.mjs <metadata.json> <out.zip> [encrypted|plain]')
  process.exit(2)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const oldRepo = resolve(process.env.OLD_REPO ?? join(root, '..', 'ReminderWeb'))
const { encodeArchive } = await import(pathToFileURL(join(oldRepo, 'server/src/backup-format.ts')).href)

const metadataJson = readFileSync(metadataPath, 'utf8')
const zip = encodeArchive({ metadataJson }, mode === 'encrypted')
writeFileSync(outPath, zip)
console.log(JSON.stringify({ out: outPath, mode, bytes: zip.length }))
