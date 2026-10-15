#!/usr/bin/env node
// 逐请求核对「旧 Node 实现」与「新 Go 实现」在路由层的状态码 / 错误码是否一致。
//
// 用法（两个实例都必须是 AUTH_MODE=none，或用 --cookie 提供同一会话）：
//   node tools/route-parity.mjs --old http://127.0.0.1:19555 --new http://127.0.0.1:19557
//   node tools/route-parity.mjs --old ... --new ... --cookie 'rwsession=...'
//
// 只读探测；不改任何数据（GET/PUT 会写库，旧实现建议用一次性 DATA_DIR，新实现建议指向一次性 MySQL 库）。
// 退出码：0 = 完全一致；1 = 存在差异。

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}
const oldBase = args.get('old')
const newBase = args.get('new')
const cookie = args.get('cookie')
if (!oldBase || !newBase) {
  console.error('用法：node tools/route-parity.mjs --old <base> --new <base> [--cookie <header>]')
  process.exit(2)
}

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'PROPFIND', 'MKCOL']
const PATHS = [
  '/api/health', '/api/version',
  '/api/auth/login', '/api/auth/logout', '/api/auth/me',
  '/api/data', '/api/data/full', '/api/data/replace', '/api/data/',
  '/api/images/card-bg-1.jpg', '/api/images/', '/api/images',
  '/api/webdav', '/api/webdav/foo', '/api/webdav/config',
  '/api/sync/config', '/api/sync/status', '/api/sync/now', '/api/sync/upload',
  '/api/sync/files', '/api/sync/restore', '/api/sync/files/x.zip',
  '/api/unknown', '/api/', '/api/data/unknown', '/api/health/extra',
]

async function probe(base, method, path) {
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = cookie
  try {
    const res = await fetch(base + path, { method, headers, redirect: 'manual' })
    const text = method === 'HEAD' ? '' : await res.text()
    let code = '-'
    if (method !== 'HEAD') {
      try { code = JSON.parse(text).error ?? '-' } catch { code = '-' }
    }
    return { status: res.status, code }
  } catch (error) {
    return { status: 0, code: `err:${error.message}` }
  }
}

let mismatches = 0
let total = 0
for (const path of PATHS) {
  for (const method of METHODS) {
    total += 1
    const a = await probe(oldBase, method, path)
    const b = await probe(newBase, method, path)
    const same = a.status === b.status && a.code === b.code
    if (!same) {
      mismatches += 1
      console.error(`差异 ${method} ${path}：旧=${a.status} ${a.code} 新=${b.status} ${b.code}`)
    }
  }
}
console.log(`核对 ${total} 个请求，差异 ${mismatches} 个`)
process.exit(mismatches === 0 ? 0 : 1)
