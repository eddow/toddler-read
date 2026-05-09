#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const readerRoot = path.join(repoRoot, 'reader');
const browserCandidates = [
  process.env.CHROMIUM_BIN,
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
].filter(Boolean);

const previousReaderServiceWorker = `
const APP_VERSION = 'v11';
self.addEventListener('install', () => {});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports && event.ports[0] && event.ports[0].postMessage({ version: APP_VERSION });
    return;
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
self.addEventListener('fetch', () => {});
`;

const currentVersionServiceWorker = `
const APP_VERSION = 'v12';
self.addEventListener('install', () => {});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports && event.ports[0] && event.ports[0].postMessage({ version: APP_VERSION });
    return;
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
self.addEventListener('fetch', () => {});
`;

const sameVersionWaitingServiceWorker = `
const APP_VERSION = 'v12';
self.addEventListener('install', () => {});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports && event.ports[0] && event.ports[0].postMessage({ version: APP_VERSION });
    return;
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
self.addEventListener('fetch', () => {});
`;

const newVersionWaitingServiceWorker = `
const APP_VERSION = 'v13';
self.addEventListener('install', () => {});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports && event.ports[0] && event.ports[0].postMessage({ version: APP_VERSION });
    return;
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
self.addEventListener('fetch', () => {});
`;

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

function createReaderServer() {
  let serviceWorkerOverride = null;

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const requestedFile = decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
    const filePath = path.resolve(readerRoot, requestedFile);

    if (!filePath.startsWith(readerRoot + path.sep) && filePath !== readerRoot) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    if (requestedFile === 'sw.js' && serviceWorkerOverride !== null) {
      response.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Cache-Control': 'no-store',
      });
      response.end(serviceWorkerOverride);
      return;
    }

    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }

      response.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Cache-Control': 'no-store',
      });
      response.end(body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${port}`,
        setServiceWorkerOverride(nextServiceWorker) {
          serviceWorkerOverride = nextServiceWorker;
        },
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(process) {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    process.once('exit', resolve);
  });
}

async function waitForFile(filePath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function removeDirectory(directory) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'ENOTEMPTY' && error.code !== 'EBUSY') throw error;
      await wait(100);
    }
  }

  fs.rmSync(directory, { recursive: true, force: true });
}

function findBrowser() {
  for (const candidate of browserCandidates) {
    const result = childProcess.spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status === 0) return candidate;
  }

  return null;
}

async function getJson(url, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(50);
  }

  throw lastError || new Error(`Timed out fetching ${url}`);
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;

    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);

    if (message.error) {
      request.reject(new Error(message.error.message));
      return;
    }

    request.resolve(message.result);
  });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function getPageClient(debugPort, pageUrl) {
  const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find((entry) => entry.type === 'page' && entry.url === pageUrl)
    || targets.find((entry) => entry.type === 'page');

  if (!target) throw new Error('No Chromium page target found');

  const client = createCdpClient(target.webSocketDebuggerUrl);
  await client.ready;
  return client;
}

async function evaluate(client, expression) {
  let result = null;
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!/(Execution context was destroyed|Inspected target navigated or closed)/i.test(error.message)) break;
      await wait(300);
    }
  }

  if (lastError) throw lastError;

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }

  return result.result.value;
}

async function assertUpdatePromptHidden(client, label) {
  const state = await evaluate(client, `
    new Promise((resolve) => {
      let promptWasVisible = false;
      const checkPrompt = () => {
        const prompt = document.getElementById('updatePrompt');
        if (prompt) {
          const style = getComputedStyle(prompt);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
          promptWasVisible = promptWasVisible || isVisible;
        }
      };
      const intervalId = setInterval(checkPrompt, 50);

      setTimeout(() => {
        clearInterval(intervalId);
        checkPrompt();
        const prompt = document.getElementById('updatePrompt');
        navigator.serviceWorker.getRegistration().then((registration) => {
          const style = prompt ? getComputedStyle(prompt) : null;
          resolve({
            promptVisible: style ? (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) : false,
            promptWasVisible,
            computedDisplay: style ? style.display : null,
            hasHiddenClass: Boolean(prompt && prompt.classList.contains('hidden')),
            controlled: Boolean(navigator.serviceWorker.controller),
            hasWaitingWorker: Boolean(registration && registration.waiting),
            hasInstallingWorker: Boolean(registration && registration.installing),
            hasActiveWorker: Boolean(registration && registration.active),
          });
        });
      }, 1500);
    })
  `);

  if (state.promptVisible || state.promptWasVisible) {
    throw new Error(`Update prompt was visible after ${label}: ${JSON.stringify(state)}`);
  }
}

async function assertUpdatePromptVisible(client, label) {
  const state = await evaluate(client, `
    new Promise((resolve) => {
      let promptWasVisible = false;
      const checkPrompt = () => {
        const prompt = document.getElementById('updatePrompt');
        if (prompt) {
          const style = getComputedStyle(prompt);
          const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
          promptWasVisible = promptWasVisible || isVisible;
        }
      };
      const intervalId = setInterval(checkPrompt, 50);

      setTimeout(() => {
        clearInterval(intervalId);
        checkPrompt();
        const prompt = document.getElementById('updatePrompt');
        navigator.serviceWorker.getRegistration().then((registration) => {
          const style = prompt ? getComputedStyle(prompt) : null;
          resolve({
            promptVisible: style ? (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0) : false,
            promptWasVisible,
            computedDisplay: style ? style.display : null,
            hasHiddenClass: Boolean(prompt && prompt.classList.contains('hidden')),
            controlled: Boolean(navigator.serviceWorker.controller),
            hasWaitingWorker: Boolean(registration && registration.waiting),
            hasInstallingWorker: Boolean(registration && registration.installing),
            hasActiveWorker: Boolean(registration && registration.active),
          });
        });
      }, 1500);
    })
  `);

  if (!state.promptVisible && !state.promptWasVisible) {
    throw new Error(`Update prompt was NOT visible after ${label}: ${JSON.stringify(state)}`);
  }
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function main() {
  const { server, origin, setServiceWorkerOverride } = await createReaderServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toddler-reader-chrome-'));
  const pageUrl = `${origin}/index.html`;
  const browser = findBrowser();
  let chromiumProcess = null;
  let client = null;

  try {
    if (!browser) {
      console.log('reader update prompt smoke test: skipped (set CHROMIUM_BIN to a working Chrome/Chromium binary)');
      return;
    }

    chromiumProcess = childProcess.spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      pageUrl,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    chromiumProcess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    chromiumProcess.once('exit', (code) => {
      if (code && code !== 0) {
        process.stderr.write(stderr);
      }
    });

    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    const [debugPort] = (await waitForFile(portFile, 5000)).trim().split('\n');
    client = await getPageClient(debugPort, pageUrl);
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    await assertUpdatePromptHidden(client, 'fresh reader load');
    await client.send('Page.reload', { ignoreCache: true });
    await assertUpdatePromptHidden(client, 'reloading the freshly installed reader');

    setServiceWorkerOverride(currentVersionServiceWorker);
    await evaluate(client, `navigator.serviceWorker.getRegistration(${JSON.stringify(origin + '/')}).then((registration) => registration.unregister())`);
    await navigate(client, 'about:blank');
    await navigate(client, pageUrl);
    await assertUpdatePromptHidden(client, 'installing current version worker');

    setServiceWorkerOverride(sameVersionWaitingServiceWorker);
    await navigate(client, pageUrl);
    await assertUpdatePromptHidden(client, 'loading current reader with a same-version waiting worker');

    // Now test with a new version - we need to trigger an update check
    setServiceWorkerOverride(newVersionWaitingServiceWorker);
    await evaluate(client, `
      navigator.serviceWorker.getRegistration(${JSON.stringify(origin + '/')}).then((registration) => {
        if (registration) {
          return registration.update();
        }
      })
    `);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await assertUpdatePromptVisible(client, 'loading current reader with a new-version waiting worker');

    setServiceWorkerOverride(null);

    console.log('reader update prompt smoke test: ok');
  } finally {
    if (client) client.close();
    if (chromiumProcess) {
      chromiumProcess.kill();
      await waitForExit(chromiumProcess);
    }
    await new Promise((resolve) => server.close(resolve));
    await removeDirectory(userDataDir);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
