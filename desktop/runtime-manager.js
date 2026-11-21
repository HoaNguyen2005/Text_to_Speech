const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

function parseEnvContent(text) {
  const result = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function execFileAsync(command, args, { timeout = 5000, env = process.env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, env, cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function isPortOpen(port, host = '127.0.0.1', timeout = 900) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function probeReady(url, timeoutMs = 2500) {
  try {
    const resp = await fetch(`${url}/health/ready`, { signal: AbortSignal.timeout(timeoutMs) });
    const data = await resp.json().catch(() => ({}));
    return { online: resp.ok && (data.status === 'ok' || data.status === 'ready'), ...data };
  } catch {
    return { online: false };
  }
}

function parseNvidiaSmiOutput(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).find(Boolean);
  if (!line) return { hasNvidiaGpu: false, gpuName: null, vramMb: null };
  const parts = line.split(',').map((s) => s.trim());
  const gpuName = parts[0] || null;
  const parsedVram = Number.parseInt(parts[1], 10);
  return {
    hasNvidiaGpu: Boolean(gpuName),
    gpuName,
    vramMb: Number.isFinite(parsedVram) ? parsedVram : null,
  };
}

function prependToPathEnv(envObj, dirs) {
  const existingChunks = [];
  for (const key of Object.keys(envObj)) {
    if (/^path$/i.test(key)) {
      if (envObj[key]) existingChunks.push(envObj[key]);
      delete envObj[key];
    }
  }
  const seen = new Set();
  const merged = [];
  const pushItem = (raw) => {
    const item = String(raw || '').trim();
    if (!item) return;
    const norm = process.platform === 'win32' ? item.toLowerCase() : item;
    if (seen.has(norm)) return;
    seen.add(norm);
    merged.push(item);
  };
  for (const d of Array.isArray(dirs) ? dirs : []) pushItem(d);
  for (const chunk of existingChunks) {
    for (const part of String(chunk).split(path.delimiter)) pushItem(part);
  }
  const combined = merged.join(path.delimiter);
  envObj.PATH = combined;
  if (process.platform === 'win32') envObj.Path = combined;
  return envObj;
}

function findFilesRecursive(rootDir, targetNames) {
  const wantedMap = new Map(
    (Array.isArray(targetNames) ? targetNames : []).map((n) => [process.platform === 'win32' ? n.toLowerCase() : n, n])
  );
  const found = {};
  if (!rootDir || !fs.existsSync(rootDir) || wantedMap.size === 0) return found;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const norm = process.platform === 'win32' ? entry.name.toLowerCase() : entry.name;
        const originalName = wantedMap.get(norm);
        if (originalName && !found[originalName]) {
          found[originalName] = fullPath;
        }
      }
    }
  }
  return found;
}

class DesktopRuntimeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
    this.dataDir = this._resolveWritableDataDir(options.dataDir);
    this.runtimeDir = path.join(this.dataDir, 'desktop-app');
    this.toolsDir = path.join(this.dataDir, 'tools');
    this.venvBaseDir = this._isDirWritable(path.join(this.rootDir, 'engine'))
      ? path.join(this.rootDir, 'engine')
      : path.join(this.dataDir, 'python-runtime');
    this.children = new Map();
    this.logs = { vieneu: [], engine: [], backend: [], worker: [], setup: [] };
    this.setupState = { running: false, stage: 'idle', percent: 0, message: '' };
    this.hardware = { hasNvidiaGpu: false, gpuName: null, vramMb: null, preferredDevice: 'cpu', cpuModel: '', cpuThreads: 1 };
    this.toolchain = { pythonSource: 'unknown', pythonVersion: null, ffmpegReady: false, ffmpegSource: 'unknown', ffmpegDir: null };
    this.cloud = { backendUrl: '', keycloakUrl: '', realm: 'tts-local', backend: 'unknown', keycloak: 'unknown', lastCheck: null };
    this.services = {
      vieneu: { running: false, online: false, managed: false, device: 'cpu', pid: null },
      engine: { running: false, online: false, managed: false, device: 'cpu', gpuName: null, pid: null },
      backend: { running: false, online: false, managed: false, pid: null },
      worker: { running: false, managed: false, pid: null, enabled: false },
    };
    this.pollTimer = null;
    this.setupPromise = null;
    this.stopping = false;
  }

  _isDirWritable(target) {
    try {
      fs.accessSync(target, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  _resolveWritableDataDir(explicitDir) {
    if (explicitDir) return path.resolve(explicitDir);
    const localData = path.join(this.rootDir, 'backend', 'data');
    if (this._isDirWritable(this.rootDir) || this._isDirWritable(localData)) return localData;
    const base = process.env.LOCALAPPDATA || os.homedir();
    return path.join(base, 'Text2SpeechDesktop');
  }

  _appendLog(channel, text) {
    const bucket = this.logs[channel] || this.logs.setup;
    for (const line of String(text || '').split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      bucket.push(`[${new Date().toLocaleTimeString()}] ${trimmed}`);
      if (bucket.length > 100) bucket.shift();
    }
  }

  _emitStatus() {
    this.emit('status', this.getStatus());
  }

  getStatus() {
    return {
      isDesktop: true,
      hardware: { ...this.hardware },
      toolchain: { ...this.toolchain },
      setup: { ...this.setupState },
      cloud: { ...this.cloud },
      services: JSON.parse(JSON.stringify(this.services)),
      logs: {
        engine: this.logs.engine.slice(-25),
        vieneu: this.logs.vieneu.slice(-25),
        worker: this.logs.worker.slice(-25),
        setup: this.logs.setup.slice(-25),
      },
    };
  }

  loadEnv() {
    const merged = { ...process.env };
    const candidates = [
      path.join(this.rootDir, '.env.local'),
      path.join(this.rootDir, '.env'),
      path.join(this.rootDir, 'backend', '.env.local'),
      path.join(this.rootDir, 'backend', '.env.postgres.local'),
      path.join(this.rootDir, 'backend', '.env.keycloak.local'),
      path.join(this.rootDir, 'backend', '.env.books.local'),
      path.join(this.rootDir, 'backend', '.env'),
      path.join(this.rootDir, 'deploy', 'main-backend.env'),
      path.join(this.rootDir, 'deploy', 'main-worker.env'),
      path.join(this.rootDir, 'deploy', 'engine.gpu.env'),
      path.join(this.rootDir, 'deploy', 'engine.env'),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      const parsed = parseEnvContent(fs.readFileSync(file, 'utf8'));
      for (const [k, v] of Object.entries(parsed)) {
        if (!merged[k] && v) merged[k] = v;
      }
    }
    if (!merged.BOOK_ENGINE_SECRET) {
      merged.BOOK_ENGINE_SECRET = crypto.randomBytes(32).toString('hex');
      try {
        const booksEnv = path.join(this.rootDir, 'backend', '.env.books.local');
        if (!fs.existsSync(booksEnv) && this._isDirWritable(path.dirname(booksEnv))) {
          fs.writeFileSync(booksEnv, `BOOK_ENGINE_SECRET=${merged.BOOK_ENGINE_SECRET}\n`, 'utf8');
        }
      } catch {}
    }
    if (!merged.BOOK_ARTIFACT_ROOT) merged.BOOK_ARTIFACT_ROOT = path.join(this.dataDir, 'book-audio');
    if (!merged.AUDIO_ROOT) merged.AUDIO_ROOT = path.join(this.dataDir, 'public-audio');

    const feEnv = {};
    for (const f of [path.join(this.rootDir, 'frontend', '.env.production'), path.join(this.rootDir, 'frontend', '.env.local')]) {
      if (fs.existsSync(f)) Object.assign(feEnv, parseEnvContent(fs.readFileSync(f, 'utf8')));
    }
    this.cloud.backendUrl = (merged.VITE_API_URL || feEnv.VITE_API_URL || merged.PUBLIC_BACKEND_URL || 'https://text2speech-backend.onrender.com').replace(/\/+$/, '');
    this.cloud.keycloakUrl = (merged.VITE_KEYCLOAK_URL || feEnv.VITE_KEYCLOAK_URL || merged.KEYCLOAK_URL || 'https://text2speech-keycloak.onrender.com').replace(/\/+$/, '');
    this.cloud.realm = merged.VITE_KEYCLOAK_REALM || feEnv.VITE_KEYCLOAK_REALM || merged.KEYCLOAK_REALM || 'tts-local';

    return merged;
  }

  async detectHardware() {
    const cpus = os.cpus();
    let gpu = { hasNvidiaGpu: false, gpuName: null, vramMb: null };
    const nvidiaBins = process.platform === 'win32'
      ? ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe']
      : ['nvidia-smi'];
    for (const bin of nvidiaBins) {
      try {
        const { stdout } = await execFileAsync(bin, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000 });
        gpu = parseNvidiaSmiOutput(stdout);
        if (gpu.hasNvidiaGpu) break;
      } catch {}
    }
    this.hardware = {
      ...gpu,
      preferredDevice: gpu.hasNvidiaGpu ? 'cuda' : 'cpu',
      cpuModel: cpus[0]?.model || '',
      cpuThreads: cpus.length || 1,
    };
    this._emitStatus();
    return this.hardware;
  }

  _pythonPath(venvDir) {
    return process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');
  }

  _runLogged(command, args, channel, { cwd, env } = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd, env, windowsHide: true });
      let lastErr = '';
      proc.stdout.on('data', (chunk) => {
        this._appendLog(channel, chunk.toString());
        this._emitStatus();
      });
      proc.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        lastErr = str.trim().slice(-300);
        this._appendLog(channel, str);
        this._emitStatus();
      });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${path.basename(command)} exited with code ${code}${lastErr ? `: ${lastErr}` : ''}`));
      });
    });
  }

  async _downloadFile(url, destFile, onProgress) {
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    const partFile = `${destFile}.part`;
    const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status} khi tải ${url}`);
    }
    const totalBytes = Number.parseInt(resp.headers.get('content-length') || '0', 10) || 0;
    let downloadedBytes = 0;
    let lastEmit = 0;
    const out = fs.createWriteStream(partFile);
    try {
      for await (const chunk of resp.body) {
        downloadedBytes += chunk.length;
        if (!out.write(chunk)) {
          await new Promise((resolve) => out.once('drain', resolve));
        }
        const now = Date.now();
        if (typeof onProgress === 'function' && (now - lastEmit >= 250 || downloadedBytes === totalBytes)) {
          lastEmit = now;
          const pct = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          onProgress(
            pct,
            (downloadedBytes / (1024 * 1024)).toFixed(1),
            totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : null
          );
        }
      }
      await new Promise((resolve, reject) => {
        out.on('error', reject);
        out.end(resolve);
      });
      fs.renameSync(partFile, destFile);
    } catch (err) {
      out.destroy();
      try { fs.unlinkSync(partFile); } catch {}
      throw err;
    }
    return destFile;
  }

  async _extractArchive(archivePath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const lower = archivePath.toLowerCase();
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir], { timeout: 5 * 60 * 1000 });
      return;
    }
    try {
      await execFileAsync('tar', ['-xf', archivePath, '-C', destDir], { timeout: 5 * 60 * 1000 });
    } catch (tarErr) {
      if (process.platform !== 'win32') throw tarErr;
      await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        { timeout: 5 * 60 * 1000 }
      );
    }
  }

  async _probePythonCommand(cmd, prefix = []) {
    try {
      const { stdout } = await execFileAsync(
        cmd,
        [
          ...prefix,
          '-c',
          'import sys, venv; assert sys.version_info >= (3, 10); print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")',
        ],
        { timeout: 6000 }
      );
      return String(stdout || '').trim().split(/\r?\n/)[0] || null;
    } catch {
      return null;
    }
  }

  async ensurePortablePython(updateSetup) {
    const portableDir = path.join(this.toolsDir, 'python');
    const portableCandidates = process.platform === 'win32'
      ? [
          path.join(portableDir, 'tools', 'python.exe'),
          path.join(portableDir, 'python.exe'),
          path.join(portableDir, 'python', 'python.exe'),
        ]
      : [
          path.join(portableDir, 'bin', 'python3'),
          path.join(portableDir, 'python', 'bin', 'python3'),
        ];

    for (const candidate of portableCandidates) {
      if (!fs.existsSync(candidate)) continue;
      const version = await this._probePythonCommand(candidate, []);
      if (version) {
        this.toolchain = { ...this.toolchain, pythonSource: 'portable', pythonVersion: version };
        return { cmd: candidate, prefix: [], source: 'portable', version };
      }
    }

    const systemCandidates = process.platform === 'win32'
      ? [['python', []], ['py', ['-3']], ['python3', []]]
      : [['python3', []], ['python', []]];
    for (const [cmd, prefix] of systemCandidates) {
      const version = await this._probePythonCommand(cmd, prefix);
      if (version) {
        this.toolchain = { ...this.toolchain, pythonSource: 'system', pythonVersion: version };
        return { cmd, prefix, source: 'system', version };
      }
    }

    if (process.platform !== 'win32') {
      throw new Error('Không tìm thấy Python 3.10+ (có module venv). Vui lòng cài Python 3.10+ rồi thử lại.');
    }

    const urls = [
      process.env.PORTABLE_PYTHON_URL,
      'https://www.nuget.org/api/v2/package/python/3.10.11',
      'https://github.com/astral-sh/python-build-standalone/releases/download/20250317/cpython-3.10.16+20250317-x86_64-pc-windows-msvc-install_only.tar.gz',
    ].filter(Boolean);

    let lastErr = null;
    for (const url of urls) {
      const isTarGz = /\.(tar\.gz|tgz)(?:$|\?)/i.test(url);
      const archivePath = path.join(this.toolsDir, '_downloads', isTarGz ? 'python-portable.tar.gz' : 'python-portable.zip');
      try {
        updateSetup?.('downloading-python', 5, 'Máy chưa có Python 3.10+ — đang tải Portable Python…');
        await this._downloadFile(url, archivePath, (pct, mb, totalMb) => {
          const scaled = 5 + Math.round(pct * 0.12);
          const detail = totalMb ? `${mb}/${totalMb} MB` : `${mb} MB`;
          updateSetup?.('downloading-python', scaled, `Đang tải Portable Python (${detail})…`);
        });
        updateSetup?.('downloading-python', 18, 'Đang giải nén Portable Python…');
        fs.rmSync(portableDir, { recursive: true, force: true });
        await this._extractArchive(archivePath, portableDir);
        try { fs.unlinkSync(archivePath); } catch {}

        const foundExe = portableCandidates.find((p) => fs.existsSync(p))
          || findFilesRecursive(portableDir, ['python.exe'])['python.exe'];
        if (!foundExe) {
          throw new Error('Không tìm thấy python.exe sau khi giải nén Portable Python.');
        }
        await execFileAsync(foundExe, ['-m', 'ensurepip', '--upgrade'], { timeout: 60000 }).catch(() => {});
        const version = await this._probePythonCommand(foundExe, []);
        if (!version) {
          throw new Error('Portable Python vừa tải không hỗ trợ đầy đủ module venv.');
        }
        this.toolchain = { ...this.toolchain, pythonSource: 'portable', pythonVersion: version };
        this._emitStatus();
        return { cmd: foundExe, prefix: [], source: 'portable', version };
      } catch (err) {
        lastErr = err;
        try { fs.unlinkSync(archivePath); } catch {}
        this._appendLog('setup', `Thử tải Portable Python từ ${url} thất bại: ${err.message}`);
      }
    }

    throw new Error(`Không thể tải Portable Python 3.10+: ${lastErr?.message || 'lỗi mạng'}`);
  }

  async _probeFfmpegDir(dir) {
    const ffmpegName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const ffmpegBin = dir ? path.join(dir, ffmpegName) : 'ffmpeg';
    const ffprobeBin = dir ? path.join(dir, ffprobeName) : 'ffprobe';
    if (dir && (!fs.existsSync(ffmpegBin) || !fs.existsSync(ffprobeBin))) {
      return false;
    }
    try {
      await Promise.all([
        execFileAsync(ffmpegBin, ['-version'], { timeout: 4000 }),
        execFileAsync(ffprobeBin, ['-version'], { timeout: 4000 }),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async ensureFfmpeg(updateSetup) {
    const scriptsFolder = process.platform === 'win32' ? 'Scripts' : 'bin';
    const rawCandidates = [
      { dir: path.join(this.toolsDir, 'ffmpeg', 'bin'), source: 'portable' },
      { dir: path.join(this.rootDir, 'engine', 'venv', scriptsFolder), source: 'venv' },
      { dir: path.join(this.venvBaseDir, 'venv', scriptsFolder), source: 'venv' },
      { dir: null, source: 'system' },
    ];
    const seenDirs = new Set();
    const candidates = rawCandidates.filter((c) => {
      const key = c.dir ? path.resolve(c.dir).toLowerCase() : '__system__';
      if (seenDirs.has(key)) return false;
      seenDirs.add(key);
      return true;
    });

    for (const cand of candidates) {
      if (await this._probeFfmpegDir(cand.dir)) {
        this.toolchain = { ...this.toolchain, ffmpegReady: true, ffmpegSource: cand.source, ffmpegDir: cand.dir };
        this._emitStatus();
        return cand.dir;
      }
    }

    if (process.platform !== 'win32') {
      throw new Error('Không tìm thấy ffmpeg và ffprobe trong PATH.');
    }

    const ffmpegBinDir = path.join(this.toolsDir, 'ffmpeg', 'bin');
    const tmpExtract = path.join(this.toolsDir, 'ffmpeg', '_tmp');
    const urls = [
      process.env.PORTABLE_FFMPEG_URL,
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
      'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    ].filter(Boolean);

    let lastErr = null;
    for (const url of urls) {
      const archivePath = path.join(this.toolsDir, '_downloads', 'ffmpeg-portable.zip');
      try {
        updateSetup?.('downloading-ffmpeg', 19, 'Máy chưa có FFmpeg — đang tải Static FFmpeg & FFprobe…');
        await this._downloadFile(url, archivePath, (pct, mb, totalMb) => {
          const scaled = 19 + Math.round(pct * 0.08);
          const detail = totalMb ? `${mb}/${totalMb} MB` : `${mb} MB`;
          updateSetup?.('downloading-ffmpeg', scaled, `Đang tải FFmpeg (${detail})…`);
        });
        updateSetup?.('downloading-ffmpeg', 28, 'Đang giải nén FFmpeg & FFprobe…');
        fs.rmSync(tmpExtract, { recursive: true, force: true });
        await this._extractArchive(archivePath, tmpExtract);
        try { fs.unlinkSync(archivePath); } catch {}

        const located = findFilesRecursive(tmpExtract, ['ffmpeg.exe', 'ffprobe.exe']);
        if (!located['ffmpeg.exe'] || !located['ffprobe.exe']) {
          throw new Error('Gói FFmpeg không chứa đủ ffmpeg.exe và ffprobe.exe.');
        }
        fs.mkdirSync(ffmpegBinDir, { recursive: true });
        fs.copyFileSync(located['ffmpeg.exe'], path.join(ffmpegBinDir, 'ffmpeg.exe'));
        fs.copyFileSync(located['ffprobe.exe'], path.join(ffmpegBinDir, 'ffprobe.exe'));
        fs.rmSync(tmpExtract, { recursive: true, force: true });

        if (!(await this._probeFfmpegDir(ffmpegBinDir))) {
          throw new Error('ffmpeg.exe / ffprobe.exe vừa giải nén không chạy được.');
        }
        this.toolchain = { ...this.toolchain, ffmpegReady: true, ffmpegSource: 'portable', ffmpegDir: ffmpegBinDir };
        this._emitStatus();
        return ffmpegBinDir;
      } catch (err) {
        lastErr = err;
        try { fs.unlinkSync(archivePath); } catch {}
        fs.rmSync(tmpExtract, { recursive: true, force: true });
        this._appendLog('setup', `Thử tải FFmpeg từ ${url} thất bại: ${err.message}`);
      }
    }

    throw new Error(`Không thể tải FFmpeg: ${lastErr?.message || 'lỗi mạng'}`);
  }

  async ensurePythonRuntime() {
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = (async () => {
      const engineVenv = path.join(this.rootDir, 'engine', 'venv');
      const targetEngineVenv = fs.existsSync(this._pythonPath(engineVenv)) ? engineVenv : path.join(this.venvBaseDir, 'venv');
      const enginePy = this._pythonPath(targetEngineVenv);
      const vieneuVenv = path.join(this.rootDir, 'engine', 'vieneu_service', '.venv');
      const targetVieneuVenv = this._isDirWritable(path.join(this.rootDir, 'engine', 'vieneu_service'))
        ? vieneuVenv
        : path.join(this.venvBaseDir, 'vieneu-venv');
      const vieneuPy = this._pythonPath(targetVieneuVenv);

      const updateSetup = (stage, percent, message) => {
        this.setupState = { running: stage !== 'ready' && stage !== 'error', stage, percent, message };
        this._appendLog('setup', `[${percent}%] ${message}`);
        this._emitStatus();
      };

      try {
        await this.detectHardware();
        let engineOk = false;
        if (fs.existsSync(enginePy)) {
          try {
            await execFileAsync(enginePy, ['-c', 'import torch, fastapi, uvicorn, edge_tts, librosa, soundfile'], { timeout: 12000 });
            engineOk = true;
          } catch {}
        }

        const sysPy = engineOk ? null : await this.ensurePortablePython(updateSetup);
        await this.ensureFfmpeg(updateSetup);

        if (engineOk) {
          const ver = await this._probePythonCommand(enginePy);
          this.toolchain = { ...this.toolchain, pythonSource: 'venv', pythonVersion: ver || this.toolchain.pythonVersion };
        } else {
          updateSetup('creating-venv', 30, 'Đang khởi tạo môi trường ảo Python cho Engine…');
          fs.mkdirSync(path.dirname(targetEngineVenv), { recursive: true });
          if (!fs.existsSync(enginePy)) {
            await this._runLogged(sysPy.cmd, [...sysPy.prefix, '-m', 'venv', targetEngineVenv], 'setup');
          }
          await this._runLogged(enginePy, ['-m', 'pip', 'install', '--upgrade', 'pip'], 'setup');

          if (this.hardware.hasNvidiaGpu) {
            updateSetup('installing-torch', 35, `Phát hiện ${this.hardware.gpuName} — đang tải PyTorch CUDA…`);
            try {
              await this._runLogged(enginePy, ['-m', 'pip', 'install', '--prefer-binary', '--index-url', 'https://download.pytorch.org/whl/cu128', 'torch', 'torchaudio'], 'setup');
            } catch {
              updateSetup('installing-torch', 40, 'Không cài được PyTorch CUDA, tự động chuyển sang PyTorch CPU…');
              await this._runLogged(enginePy, ['-m', 'pip', 'install', '--prefer-binary', '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==2.10.0+cpu', 'torchaudio==2.10.0+cpu'], 'setup');
            }
          } else {
            updateSetup('installing-torch', 35, 'Đang tải PyTorch bản tối ưu cho CPU…');
            await this._runLogged(enginePy, ['-m', 'pip', 'install', '--prefer-binary', '--index-url', 'https://download.pytorch.org/whl/cpu', '-r', path.join(this.rootDir, 'engine', 'requirements.torch-cpu.txt')], 'setup');
          }

          updateSetup('installing-engine', 70, 'Đang cài đặt thư viện OpenVoice & Edge-TTS…');
          await this._runLogged(enginePy, ['-m', 'pip', 'install', '--prefer-binary', '-r', path.join(this.rootDir, 'engine', 'requirements.container.txt'), 'onnxruntime'], 'setup');
        }

        let vieneuOk = false;
        if (fs.existsSync(vieneuPy)) {
          try {
            await execFileAsync(vieneuPy, ['-c', 'import vieneu, fastapi, uvicorn'], { timeout: 10000 });
            vieneuOk = true;
          } catch {}
        }
        if (!vieneuOk) {
          updateSetup('installing-vieneu', 86, 'Đang chuẩn bị môi trường VieNeu-TTS…');
          if (!fs.existsSync(vieneuPy)) {
            await this._runLogged(enginePy, ['-m', 'venv', targetVieneuVenv], 'setup');
          }
          await this._runLogged(vieneuPy, ['-m', 'pip', 'install', '--no-deps', 'vieneu==3.8.3', 'librosa==0.11.0', 'kaldi-native-fbank==1.22.5', 'sea-g2p==0.10.0'], 'setup');
          const siteDir = process.platform === 'win32'
            ? path.join(targetVieneuVenv, 'Lib', 'site-packages')
            : fs.readdirSync(path.join(targetVieneuVenv, 'lib')).map((d) => path.join(targetVieneuVenv, 'lib', d, 'site-packages')).find((p) => fs.existsSync(p));
          const sharedSite = process.platform === 'win32'
            ? path.join(targetEngineVenv, 'Lib', 'site-packages')
            : fs.readdirSync(path.join(targetEngineVenv, 'lib')).map((d) => path.join(targetEngineVenv, 'lib', d, 'site-packages')).find((p) => fs.existsSync(p));
          if (siteDir && sharedSite) {
            fs.writeFileSync(path.join(siteDir, 'zz_engine_shared.pth'), `${sharedSite}\n`, 'ascii');
          }
        }

        updateSetup('ready', 100, `Môi trường sẵn sàng (${this.hardware.hasNvidiaGpu ? `GPU ${this.hardware.gpuName}` : 'CPU Mode'})`);
        return { enginePy, vieneuPy };
      } catch (err) {
        this.setupState = { running: false, stage: 'error', percent: 0, message: err.message };
        this._appendLog('setup', `Lỗi: ${err.message}`);
        this._emitStatus();
        throw err;
      } finally {
        this.setupPromise = null;
      }
    })();
    return this.setupPromise;
  }

  _spawnManaged(name, command, args, { cwd, env }) {
    const existing = this.children.get(name);
    if (existing && !existing.killed) return existing;
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.set(name, child);
    this.services[name].running = true;
    this.services[name].managed = true;
    this.services[name].pid = child.pid;
    child.stdout.on('data', (chunk) => {
      this._appendLog(name, chunk.toString());
      this._emitStatus();
    });
    child.stderr.on('data', (chunk) => {
      this._appendLog(name, chunk.toString());
      this._emitStatus();
    });
    child.on('exit', (code, signal) => {
      if (this.children.get(name) === child) this.children.delete(name);
      this.services[name].running = false;
      this.services[name].managed = false;
      this.services[name].pid = null;
      if (name === 'engine' || name === 'vieneu' || name === 'backend') this.services[name].online = false;
      this._appendLog(name, `Tiến trình dừng (code=${code}, signal=${signal || 'none'}).`);
      this._emitStatus();
    });
    return child;
  }

  async warmupCloud() {
    this.loadEnv();
    const tasks = [];
    if (this.cloud.backendUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(this.cloud.backendUrl)) {
      this.cloud.backend = 'waking';
      tasks.push(
        fetch(`${this.cloud.backendUrl}/api/health`, { signal: AbortSignal.timeout(45000) })
          .then((r) => { this.cloud.backend = r.ok ? 'online' : `http-${r.status}`; })
          .catch(() => { this.cloud.backend = 'unreachable'; })
      );
    } else {
      this.cloud.backend = 'local';
    }
    if (this.cloud.keycloakUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(this.cloud.keycloakUrl)) {
      this.cloud.keycloak = 'waking';
      tasks.push(
        fetch(`${this.cloud.keycloakUrl}/realms/${this.cloud.realm}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(45000) })
          .then((r) => { this.cloud.keycloak = r.ok ? 'online' : `http-${r.status}`; })
          .catch(() => { this.cloud.keycloak = 'unreachable'; })
      );
    } else {
      this.cloud.keycloak = 'local';
    }
    this._emitStatus();
    await Promise.allSettled(tasks);
    this.cloud.lastCheck = new Date().toISOString();
    this._emitStatus();
    return this.cloud;
  }

  async startServices() {
    this.stopping = false;
    const env = this.loadEnv();
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    fs.mkdirSync(env.BOOK_ARTIFACT_ROOT, { recursive: true });
    fs.mkdirSync(path.join(env.AUDIO_ROOT, 'samples'), { recursive: true });
    fs.mkdirSync(path.join(env.AUDIO_ROOT, 'generated'), { recursive: true });

    const { enginePy, vieneuPy } = await this.ensurePythonRuntime();
    if (this.stopping) return;

    const pyEnv = prependToPathEnv({
      ...env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      ENGINE_HOST: '127.0.0.1',
      VIENEU_URL: 'http://127.0.0.1:8001',
      VIENEU_DEVICE: 'auto',
      OPENVOICE_WATERMARK: env.OPENVOICE_WATERMARK || '0',
      SILERO_VAD_BACKEND: env.SILERO_VAD_BACKEND || 'package',
      OPENVOICE_CHECKPOINT_DIR: env.OPENVOICE_CHECKPOINT_DIR || path.join(this.rootDir, 'engine', 'checkpoints', 'converter'),
    }, [this.toolchain.ffmpegDir, path.dirname(enginePy)].filter(Boolean));

    if (!(await isPortOpen(8001))) {
      this._spawnManaged('vieneu', vieneuPy, ['-X', 'utf8', '-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8001'], {
        cwd: path.join(this.rootDir, 'engine', 'vieneu_service'),
        env: pyEnv,
      });
    } else {
      this.services.vieneu.running = true;
    }

    if (!(await isPortOpen(8000))) {
      this._spawnManaged('engine', enginePy, ['-X', 'utf8', '-u', 'main.py'], {
        cwd: path.join(this.rootDir, 'engine'),
        env: pyEnv,
      });
    } else {
      this.services.engine.running = true;
    }

    const nodeBin = process.versions.electron ? process.execPath : 'node';
    const nodeEnvBase = {
      ...env,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      LOCAL_ENGINE_FIRST: 'true',
      ENGINE_URL: 'http://127.0.0.1:8000',
      BOOK_ENGINE_URL: 'http://127.0.0.1:8000',
      VIENEU_URL: 'http://127.0.0.1:8001',
    };

    if (env.DATABASE_URL && env.KEYCLOAK_SERVICE_CLIENT_SECRET && !(await isPortOpen(3000))) {
      this._spawnManaged('backend', nodeBin, ['server.js'], {
        cwd: path.join(this.rootDir, 'backend'),
        env: { ...nodeEnvBase, HOST: '127.0.0.1', PORT: '3000' },
      });
    }

    if (env.DATABASE_URL) {
      this.services.worker.enabled = true;
      this._spawnManaged('worker', nodeBin, ['workers/book.worker.js'], {
        cwd: path.join(this.rootDir, 'backend'),
        env: { ...nodeEnvBase, BOOK_WORKER_ID_FILE: path.join(this.runtimeDir, 'book-worker-id') },
      });
    }

    await this.pollHealth();
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => { this.pollHealth().catch(() => {}); }, 4000);
    }
  }

  async pollHealth() {
    const [eHealth, vHealth] = await Promise.all([
      probeReady('http://127.0.0.1:8000', 2200),
      probeReady('http://127.0.0.1:8001', 2200),
    ]);
    this.services.engine.online = Boolean(eHealth.online);
    this.services.engine.device = eHealth.device || this.hardware.preferredDevice;
    this.services.engine.gpuName = eHealth.gpu_name || this.hardware.gpuName || null;
    if (eHealth.online) this.services.engine.running = true;

    this.services.vieneu.online = Boolean(vHealth.online);
    this.services.vieneu.device = vHealth.device || this.hardware.preferredDevice;
    if (vHealth.online) this.services.vieneu.running = true;

    this.services.backend.online = await isPortOpen(3000);
    if (this.services.backend.online) this.services.backend.running = true;
    this._emitStatus();
  }

  async restartServices() {
    await this.stopServices();
    await this.startServices();
    return this.getStatus();
  }

  async synthesizeLocal({ jobId, parts, preview = false }, onProgress) {
    if (!Array.isArray(parts) || !parts.length) {
      throw new Error('Danh sách đoạn đọc trống.');
    }
    const engineBase = 'http://127.0.0.1:8000';
    const health = await probeReady(engineBase, 3000);
    if (!health.online) {
      const err = new Error('Local Engine chưa sẵn sàng.');
      err.code = 'LOCAL_ENGINE_UNAVAILABLE';
      throw err;
    }
    const env = this.loadEnv();
    const secret = env.BOOK_ENGINE_SECRET || '';
    const callEngine = async (endpoint, payload) => {
      const resp = await fetch(`${engineBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Book-Engine-Secret': secret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Local Engine báo lỗi khi tạo âm thanh.';
        throw new Error(msg);
      }
      return data;
    };

    try {
      const timings = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const result = await callEngine('/book/part', { ...part, job_id: jobId, interactive: Boolean(preview) });
        timings.push({
          part_id: part.part_id,
          duration_seconds: result.duration_seconds,
          speech_duration_seconds: result.speech_duration_seconds,
        });
        if (typeof onProgress === 'function') {
          onProgress({
            jobId,
            current: i + 1,
            total: parts.length,
            percent: Math.round(((i + 1) / parts.length) * 100),
          });
        }
      }

      const merged = await callEngine('/book/merge', {
        job_id: jobId,
        part_ids: timings.map((t) => t.part_id),
        interactive: Boolean(preview),
      });
      let outputName = path.posix.basename(String(merged.output_path || '').replace(/\\/g, '/'));
      let finalDuration = merged.duration_seconds;

      if (preview) {
        const match = outputName.match(/^final_([a-f0-9]{64})[.]mp3$/);
        if (!match) throw new Error('Đường dẫn nghe thử từ Local Engine không hợp lệ.');
        const clip = await callEngine('/book/preview', { job_id: jobId, part_id: match[1], merged: true });
        outputName = path.posix.basename(String(clip.output_path || '').replace(/\\/g, '/'));
        finalDuration = clip.duration_seconds;
      }

      const fileResp = await fetch(`${engineBase}/book/artifact/${encodeURIComponent(jobId)}/${encodeURIComponent(outputName)}`, {
        headers: { 'X-Book-Engine-Secret': secret },
        signal: AbortSignal.timeout(120000),
      });
      if (!fileResp.ok) throw new Error('Không đọc được file âm thanh từ Local Engine.');
      const buffer = Buffer.from(await fileResp.arrayBuffer());
      return {
        audioBase64: buffer.toString('base64'),
        duration_seconds: finalDuration,
        timings,
      };
    } finally {
      await fetch(`${engineBase}/book/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Book-Engine-Secret': secret },
        body: JSON.stringify({ job_id: jobId }),
      }).catch(() => {});
    }
  }

  async stopServices() {
    this.stopping = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    const entries = [...this.children.entries()];
    this.children.clear();
    await Promise.all(entries.map(([, child]) => new Promise((resolve) => {
      if (!child?.pid) return resolve();
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      } else {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(resolve, 600);
      }
    })));
    for (const key of ['vieneu', 'engine', 'backend', 'worker']) {
      this.services[key].running = false;
      this.services[key].managed = false;
      this.services[key].pid = null;
      if (key !== 'worker') this.services[key].online = false;
    }
    this._emitStatus();
  }
}

module.exports = {
  DesktopRuntimeManager,
  parseNvidiaSmiOutput,
  parseEnvContent,
  prependToPathEnv,
  findFilesRecursive,
  isPortOpen,
};
