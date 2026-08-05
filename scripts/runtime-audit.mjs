import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const [url, output, widthValue = '1920', heightValue = '1080', waitValue = '12000'] = process.argv.slice(2)
if (!url || !output) throw new Error('Usage: node scripts/runtime-audit.mjs <url> <screenshot> [width] [height] [waitMs]')

const width = Math.max(640, Number(widthValue) || 1920)
const height = Math.max(480, Number(heightValue) || 1080)
const waitMs = Math.max(1_000, Number(waitValue) || 12_000)
const port = 31_000 + Math.floor(Math.random() * 2_000)
const profile = path.join(tmpdir(), `project01-runtime-audit-${randomUUID()}`)
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
await mkdir(path.dirname(path.resolve(output)), { recursive: true })

const processHandle = spawn(chrome, [
  '--headless=new', '--hide-scrollbars', '--mute-audio', '--disable-extensions',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true })

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration))
let target
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
    target = list.find((entry) => entry.type === 'page')
    if (target) break
  } catch {}
  await sleep(100)
}
if (!target) throw new Error('Chrome DevTools endpoint did not start')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
let nextId = 0
const pending = new Map()
socket.on('message', (raw) => {
  const message = JSON.parse(String(raw))
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(message.error.message))
  else resolve(message.result)
})
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})

try {
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url })
  const auditUrl = new URL(url)
  const automated = auditUrl.searchParams.has('auditReady') || auditUrl.searchParams.has('auditMenu') || auditUrl.searchParams.has('auditInventory')
  if (automated) {
    let spent = Math.min(5_000, waitMs)
    await sleep(spent)
    if (auditUrl.searchParams.has('auditReady')) {
      await command('Runtime.evaluate', { awaitPromise: true, expression: `(new Promise((resolve) => {
        const started = performance.now();
        const attempt = () => {
          const button = document.querySelector('.event-ready > button');
          if (button && !button.disabled) { button.click(); resolve(true); return; }
          if (performance.now() - started > 8000) { resolve(false); return; }
          setTimeout(attempt, 200);
        };
        attempt();
      }))` })
      spent += 8_000
      const startWait = Math.min(6_000, Math.max(0, waitMs - spent))
      await sleep(startWait)
      spent += startWait
    }
    if (auditUrl.searchParams.has('auditMenu')) await command('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find((button) => /menu|메뉴/i.test(button.getAttribute('aria-label') || ''))?.click()` })
    if (auditUrl.searchParams.has('auditInventory')) await command('Runtime.evaluate', { expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))` })
    await sleep(Math.max(1_000, waitMs - spent))
  } else await sleep(waitMs)
  await command('Runtime.evaluate', {
    awaitPromise: true,
    expression: `Promise.all([...document.images].map((image) => image.complete ? image.decode?.().catch(() => {}) : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })))`,
  })
  const hoverSelector = auditUrl.searchParams.get('auditHover')
  if (hoverSelector) {
    await command('Runtime.evaluate', { expression: `(() => {
      const candidates = [...document.querySelectorAll(${JSON.stringify(hoverSelector)})];
      const target = candidates.at(-1);
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
      target.focus?.();
      return true;
    })()` })
    await sleep(500)
  }
  const runtime = await command('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const fps = await new Promise((resolve) => {
        let frames = 0; const start = performance.now();
        const tick = (now) => { frames += 1; if (now - start >= 2500) resolve(frames * 1000 / (now - start)); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      const text = document.querySelector('.interface')?.innerText ?? '';
      const resources = performance.getEntriesByType('resource');
      const brokenImages = [...document.images].filter((entry) => entry.complete && entry.naturalWidth === 0).map((entry) => entry.currentSrc || entry.src);
      const imageAudit = [...document.querySelectorAll('.shop-tile > img, .inventory-slot img, .event-ready-prize-item img')].map((entry) => {
        const rect = entry.getBoundingClientRect(); const style = getComputedStyle(entry);
        return { src: entry.getAttribute('src'), width: Math.round(rect.width), height: Math.round(rect.height), opacity: style.opacity, visibility: style.visibility, display: style.display };
      });
      const tooltip = document.querySelector('.hover-tip.floating');
      const tooltipRect = tooltip?.getBoundingClientRect();
      const tooltipAudit = tooltipRect ? {
        text: tooltip.textContent,
        left: Math.round(tooltipRect.left), top: Math.round(tooltipRect.top), right: Math.round(tooltipRect.right), bottom: Math.round(tooltipRect.bottom),
        clipped: tooltipRect.left < 0 || tooltipRect.top < 0 || tooltipRect.right > innerWidth || tooltipRect.bottom > innerHeight,
      } : null;
      return { fps: Math.round(fps * 10) / 10, sceneReady: !text.includes('LOADING') && !text.includes('불러오는 중'), text, brokenImages, imageAudit, tooltipAudit, resourceCount: resources.length, transferredMB: Math.round(resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) / 104857.6) / 10 };
    })()`,
  })
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.resolve(output), Buffer.from(screenshot.data, 'base64'))
  console.log(JSON.stringify(runtime.result.value, null, 2))
} finally {
  try { await command('Browser.close') } catch {}
  socket.close()
  await Promise.race([
    new Promise((resolve) => processHandle.once('exit', resolve)),
    sleep(2_000),
  ])
  if (processHandle.exitCode === null) processHandle.kill()
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true })
      break
    } catch {
      await sleep(300)
    }
  }
}
