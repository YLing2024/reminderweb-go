#!/usr/bin/env node
// 只读统计 SQLite 库中的条目数，用于验收「旧库直读」与「整库替换」：
// 以 `node:sqlite` 只读方式打开，绝不写库，输出可直接比对的 JSON。
//
// 用法：node tools/db-count.mjs <reminder.db 路径>

import { DatabaseSync } from 'node:sqlite'

const path = process.argv[2]
if (!path) {
  console.error('用法：node tools/db-count.mjs <reminder.db>')
  process.exit(2)
}

const db = new DatabaseSync(path, { readOnly: true })
const count = (sql) => Number(db.prepare(sql).get().n)
const scalar = (sql) => db.prepare(sql).get()?.value ?? null

const result = {
  reminders: count('SELECT COUNT(*) AS n FROM reminders WHERE deleted = 0'),
  remindersDeleted: count('SELECT COUNT(*) AS n FROM reminders WHERE deleted = 1'),
  tags: count('SELECT COUNT(*) AS n FROM tags WHERE deleted = 0'),
  tagsDeleted: count('SELECT COUNT(*) AS n FROM tags WHERE deleted = 1'),
  settings: count('SELECT COUNT(*) AS n FROM settings'),
  images: count('SELECT COUNT(*) AS n FROM images'),
  revision: Number(scalar("SELECT value FROM meta WHERE key = 'revision'")) || 0,
  schemaVersion: Number(scalar("SELECT value FROM meta WHERE key = 'schema_version'")) || 0,
  journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
}

db.close()
console.log(JSON.stringify(result, null, 2))
