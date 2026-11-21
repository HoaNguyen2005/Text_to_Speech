const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { DesktopRuntimeManager, isPortOpen } = require('./runtime-manager');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'frontend', 'dist');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

let mainWindow = null;
let tray = null;
let staticServer = null;
let quitting = false;
const runtime = new DesktopRuntimeManager({
  rootDir: ROOT_DIR,
  dataDir: app.isPackaged ? path.join(app.getPath('userData'), 'data') : undefined,
});

function createStaticSpaServer(port = 5173) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const cleanPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const relative = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
      let filePath = path.resolve(DIST_DIR, relative);
      if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Frontend dist not built yet.');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function resolveStartUrl() {
  if (process.env.DESKTOP_START_URL) return process.env.DESKTOP_START_URL;
  // Keycloak redirect URIs target http://localhost:5173/*. Reuse an active dev/Docker
  // server on 5173 if present, otherwise serve frontend/dist cleanly at localhost:5173.
  if (await isPortOpen(5173, '127.0.0.1', 600)) return 'http://localhost:5173';
  staticServer = await createStaticSpaServer(5173);
  return 'http://localhost:5173';
}

function setupTray() {
  try {
    const svgPath = path.join(ROOT_DIR, 'frontend', 'public', 'favicon.svg');
    const img = nativeImage.createFromPath(svgPath);
    if (img.isEmpty()) return;
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('Text2Speech Desktop');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mở Text2Speech', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: 'Khởi động lại Engine', click: () => { runtime.restartServices().catch(() => {}); } },
      { type: 'separator' },
      { label: 'Thoát hoàn toàn', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  } catch {}
}

async function createWindow() {
  const startUrl = await resolveStartUrl();
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: 'Text2Speech — Desktop Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost:') || url.startsWith(runtime.cloud.keycloakUrl || '')) {
      return { action: 'allow' };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  await mainWindow.loadURL(startUrl);
}

runtime.on('status', (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:status', payload);
  }
});

ipcMain.handle('desktop:get-status', () => runtime.getStatus());
ipcMain.handle('desktop:warmup-cloud', () => runtime.warmupCloud());
ipcMain.handle('desktop:setup-runtime', () => runtime.ensurePythonRuntime());
ipcMain.handle('desktop:restart-services', () => runtime.restartServices());

app.whenReady().then(async () => {
  setupTray();
  // Cách 1: đánh thức Cloud Backend & Keycloak song song ngay khi bật ứng dụng.
  runtime.warmupCloud().catch(() => {});
  runtime.startServices().catch((err) => runtime._appendLog('setup', err.message));
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => {});
    else mainWindow?.show();
  });
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  await runtime.stopServices().catch(() => {});
  if (staticServer) {
    await new Promise((resolve) => staticServer.close(() => resolve()));
    staticServer = null;
  }
  app.exit(0);
});
