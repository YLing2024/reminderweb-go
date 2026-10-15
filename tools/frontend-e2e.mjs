#!/usr/bin/env node
// 验收工具：用无头 Chrome（CDP）真实驱动前端，覆盖三种形态下的核心路径。
//
// 只依赖 Node 内建的 fetch / WebSocket，无第三方依赖；Chrome 路径由 --chrome 或
// CHROME_PATH 指定（默认 /opt/chrome-for-testing/chrome）。
//
// 用法：
//   node tools/frontend-e2e.mjs --base http://127.0.0.1:19240 --mode server --out ./e2e-out
//   node tools/frontend-e2e.mjs --base http://127.0.0.1:19240 --mode client --out ./e2e-out
//
// 覆盖：首屏渲染、经 UI 新建一条、刷新后仍在、分享图导出 PNG、控制台 error 计数。
// 每一步都会打印 `步骤 | 结果 | 证据`，末尾输出 JSON 汇总，任何断言失败以非 0 退出。

import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
}

const base = args.get('base') ?? 'http://127.0.0.1:19240'
const mode = args.get('mode') ?? 'server'
const outDir = args.get('out') ?? './e2e-out'
const chromePath = args.get('chrome') ?? process.env.CHROME_PATH ?? '/opt/chrome-for-testing/chrome'
const debugPort = Number(args.get('port') ?? 19244)
const title = `E2E-${mode}-${Date.now()}`

mkdirSync(outDir, { recursive: true })
// 下载单独落一个子目录，跑前清空，避免同名覆盖导致「文件数不变」的误判。
const downloadsDir = join(outDir, 'downloads')
rmSync(downloadsDir, { recursive: true, force: true })
mkdirSync(downloadsDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'rw-e2e-'))

const steps = []
const consoleErrors = []
const record = (name, ok, evidence) => {
  steps.push({ name, ok, evidence })
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${evidence}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 启动无头 Chrome，打开远程调试端口。
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=430,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

async function waitDebugger() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      // 调试端口尚未就绪，继续等待。
    }
    await sleep(100)
  }
  throw new Error('Chrome 调试端口未就绪')
}

// 极简 CDP 客户端：一个 WebSocket、一张 id → resolver 表。
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    const listeners = new Map()
    let nextId = 1
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}, sessionId) {
          const id = nextId++
          return new Promise((res, rej) => {
            pending.set(id, { res, rej })
            socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
          })
        },
        on(event, handler) {
          if (!listeners.has(event)) listeners.set(event, [])
          listeners.get(event).push(handler)
        },
        close() {
          socket.close()
        },
      }),
    )
    socket.addEventListener('error', reject)
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.error.message))
        else res(msg.result)
        return
      }
      for (const handler of listeners.get(msg.method) ?? []) handler(msg.params, msg.sessionId)
    })
  })
}

const version = await waitDebugger()
const browser = await connect(version.webSocketDebuggerUrl)

// 允许下载到 outDir，便于校验「下载 PNG」真实产出了文件。
await browser.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: downloadsDir,
  eventsEnabled: true,
})

const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })

let pageSocketUrl
for (const target of await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) {
  if (target.id === targetId) pageSocketUrl = target.webSocketDebuggerUrl
}
const page = await connect(pageSocketUrl)

// 应用自身探测后端时必然产生的 404 属设计内回落，不计入「应用错误」。
// 见 web/src/lib/app-mode.ts：auto 模式先取 /config.json，再探测 /api/health。
const EXPECTED_PROBE_404 = /(\/config\.json|\/api\/health|favicon\.ico)/
const isExpectedProbeNoise = (text) => EXPECTED_PROBE_404.test(text) && /\b404\b/.test(text)

const addError = (text) => {
  if (isExpectedProbeNoise(text)) return
  consoleErrors.push(text)
}

let navigateResolve
page.on('Page.loadEventFired', () => navigateResolve?.())
page.on('Runtime.consoleAPICalled', (params) => {
  if (params.type === 'error') addError(params.args.map((a) => a.value ?? a.description ?? '').join(' '))
})
page.on('Runtime.exceptionThrown', (params) => {
  addError(params.exceptionDetails?.exception?.description ?? 'uncaught exception')
})
page.on('Log.entryAdded', (params) => {
  if (params.entry.level === 'error') addError(`${params.entry.url ? params.entry.url + ' ' : ''}${params.entry.text}`)
})

await page.send('Page.enable')
await page.send('Runtime.enable')
await page.send('Log.enable')

async function evaluate(expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败')
  return result.result.value
}

async function navigate(url) {
  const loaded = new Promise((resolve) => {
    navigateResolve = resolve
  })
  await page.send('Page.navigate', { url })
  await Promise.race([loaded, sleep(15000)])
  await sleep(1200)
}

async function waitFor(expression, { timeout = 15000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true
    await sleep(interval)
  }
  return false
}

async function screenshot(name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  const path = join(outDir, `${name}.png`)
  writeFileSync(path, Buffer.from(data, 'base64'))
  return path
}

try {
  // 1. 首屏渲染。
  await navigate(`${base}/`)
  const rendered = await waitFor(`document.querySelector('#root') && document.querySelector('#root').children.length > 0`)
  const wordmark = await evaluate(`document.querySelector('header')?.textContent?.includes('Reminder') ?? false`)
  record('首屏渲染出应用骨架', rendered && wordmark, `root 有内容=${rendered}，wordmark=${wordmark}`)
  await screenshot(`01-home-${mode}`)

  // 2. 经 UI 新建一条提醒。空数据下入口是空态按钮，有数据时才是右下角 FAB。
  await evaluate(`(() => {
    const fab = document.querySelector('[aria-label="新增提醒"]');
    const emptyButton = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === '新增提醒');
    (fab ?? emptyButton)?.click();
    return fab !== null;
  })()`)
  const formReady = await waitFor(`!!document.querySelector('input[placeholder="标题"]')`)
  record('进入新建页', formReady, `标题输入框出现=${formReady}`)
  const typed = formReady
    ? await evaluate(`(() => {
        const el = document.querySelector('input[placeholder="标题"]');
        if (!el) return null;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(title)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value;
      })()`)
    : null
  await evaluate(`document.querySelector('[aria-label="保存"]')?.click()`)
  const appeared = await waitFor(`document.body.textContent.includes(${JSON.stringify(title)})`)
  record('新建一条提醒', typed === title && appeared, `输入值=${typed}，列表中可见=${appeared}`)
  await screenshot(`02-created-${mode}`)

  // 3. 刷新后仍在（服务端模式经 /api/data 持久化；客户端模式经 IndexedDB）。
  await navigate(`${base}/`)
  const persisted = await waitFor(`document.body.textContent.includes(${JSON.stringify(title)})`)
  record('刷新后仍存在', persisted, `重载后可见=${persisted}`)
  await screenshot(`03-reloaded-${mode}`)

  // 4. 分享成图片 → 打开详情 → 分享 → 画布为合法 PNG → 下载 PNG 落盘。
  await evaluate(`[...document.querySelectorAll('button,a')].find((el) => el.textContent?.includes(${JSON.stringify(title)}))?.click()`)
  const detailReady = await waitFor(`!!document.querySelector('[aria-label="分享成图片"]')`)
  await evaluate(`document.querySelector('[aria-label="分享成图片"]')?.click()`)
  const canvasReady = await waitFor(`!!document.querySelector('canvas[aria-label="分享图预览"]')`)
  await sleep(400)
  const png = await evaluate(`(() => {
    const canvas = document.querySelector('canvas[aria-label="分享图预览"]');
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    return { prefix: url.slice(0, 22), length: url.length };
  })()`)
  const before = readdirSync(downloadsDir).filter((f) => f.endsWith('.png'))
  await evaluate(`[...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === '下载 PNG')?.click()`)
  await sleep(1200)
  const after = readdirSync(downloadsDir).filter((f) => f.endsWith('.png'))
  const newFiles = after.filter((f) => !before.includes(f))
  const newFile = newFiles.length > 0 ? join(downloadsDir, newFiles[0]) : null
  const newSize = newFile === null ? 0 : statSync(newFile).size
  const downloaded = newFiles.length > 0 && newSize > 0
  record(
    '分享图导出 PNG',
    detailReady && canvasReady && png?.prefix?.startsWith('data:image/png') && downloaded,
    `详情页=${detailReady}，画布=${canvasReady}，PNG 头=${png?.prefix}，下载文件=${newFiles.join(',') || '无'}（${newSize} 字节）`,
  )
  await screenshot(`04-share-${mode}`)

  // 5. 控制台 error 计数。
  record('控制台 error 为 0', consoleErrors.length === 0, `error 数=${consoleErrors.length}${consoleErrors.length ? '：' + consoleErrors.join(' | ') : ''}`)
} catch (error) {
  record('执行过程未抛异常', false, String(error?.message ?? error))
} finally {
  const failed = steps.filter((step) => !step.ok)
  console.log('\n==== 汇总 ====')
  console.log(JSON.stringify({ mode, base, title, steps, consoleErrors }, null, 2))
  rmSync(profile, { recursive: true, force: true })
  chrome.kill('SIGKILL')
  process.exit(failed.length === 0 ? 0 : 1)
}
