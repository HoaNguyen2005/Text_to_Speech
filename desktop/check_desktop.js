const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DesktopRuntimeManager,
  parseNvidiaSmiOutput,
  parseEnvContent,
  prependToPathEnv,
  findFilesRecursive,
} = require('./runtime-manager');

function execNodePath(envObj) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', 'process.stdout.write(process.env.PATH || "")'], { env: envObj, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

(async () => {
  const gpu = parseNvidiaSmiOutput('NVIDIA GeForce RTX 4060, 8188\n');
  assert.deepEqual(gpu, { hasNvidiaGpu: true, gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8188 });
  assert.deepEqual(parseNvidiaSmiOutput(''), { hasNvidiaGpu: false, gpuName: null, vramMb: null });

  const parsed = parseEnvContent('# comment\nFOO="bar"\nLOCAL_ENGINE_FIRST=true\n');
  assert.deepEqual(parsed, { FOO: 'bar', LOCAL_ENGINE_FIRST: 'true' });

  const envObj = { Path: `C:\\Existing${path.delimiter}C:\\FfmpegBin`, PATH: 'C:\\Legacy', pAtH: 'C:\\Existing' };
  prependToPathEnv(envObj, ['C:\\FfmpegBin', 'C:\\VenvScripts']);
  const pathKeys = Object.keys(envObj).filter((k) => /^path$/i.test(k));
  assert.ok(!pathKeys.includes('pAtH'));
  assert.equal(envObj.PATH.split(path.delimiter)[0], 'C:\\FfmpegBin');
  assert.equal(envObj.PATH.split(path.delimiter).filter((x) => x.toLowerCase() === 'c:\\existing').length, 1);
  if (process.platform === 'win32') {
    assert.equal(envObj.Path, envObj.PATH);
    const spawnedPath = await execNodePath({ ...process.env, ...envObj });
    assert.ok(spawnedPath.startsWith('C:\\FfmpegBin'));
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-desktop-chk-'));
  try {
    const nested = path.join(tmpDir, 'ffmpeg-build', 'bin');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'ffmpeg.exe'), '');
    fs.writeFileSync(path.join(nested, 'ffprobe.exe'), '');
    const found = findFilesRecursive(tmpDir, ['ffmpeg.exe', 'ffprobe.exe']);
    assert.equal(found['ffmpeg.exe'], path.join(nested, 'ffmpeg.exe'));
    assert.equal(found['ffprobe.exe'], path.join(nested, 'ffprobe.exe'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const mgr = new DesktopRuntimeManager();
  const hw = await mgr.detectHardware();
  assert.ok(['cuda', 'cpu'].includes(hw.preferredDevice));
  assert.ok(hw.cpuThreads >= 1);

  const venvPy = mgr._pythonPath(path.join(mgr.rootDir, 'engine', 'venv'));
  if (fs.existsSync(venvPy)) {
    const pyVer = await mgr._probePythonCommand(venvPy);
    assert.match(String(pyVer), /^\d+\.\d+\.\d+$/);
  }
  assert.equal(await mgr._probePythonCommand('nonexistent_python_binary_xyz_123'), null);

  await mgr.ensureFfmpeg();
  const st = mgr.getStatus();
  assert.ok(st.toolchain);
  assert.equal(typeof st.toolchain.pythonSource, 'string');
  assert.equal(st.toolchain.ffmpegReady, true);
  assert.ok(['portable', 'venv', 'system'].includes(st.toolchain.ffmpegSource));

  process.env.LOCAL_ENGINE_FIRST = 'true';
  process.env.ENGINE_URL = 'http://127.0.0.1:8000';
  process.env.BOOK_ENGINE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const { getCandidates } = require('../backend/app/services/engine_artifact.service');
  const candidates = await getCandidates(false);
  assert.equal(candidates[0].url, 'http://127.0.0.1:8000');
  assert.equal(candidates[0].role, 'local-primary');

  const { signToken, verifyToken } = require('../backend/app/services/local_client_tts.service');
  const token = signToken({ kind: 'lecture', user_id: 'user-1', job_id: 'abc123', preview: false, parts: [{ text: 'Xin chào', pause_ms: 0 }] });
  const decoded = verifyToken(token, 'lecture', 'user-1');
  assert.equal(decoded.job_id, 'abc123');
  assert.throws(() => verifyToken(token, 'lecture', 'user-2'));
  assert.throws(() => verifyToken(`${token}x`, 'lecture', 'user-1'));

  console.log('PASS desktop self-check:', {
    preferredDevice: hw.preferredDevice,
    gpuName: hw.gpuName,
    cpuThreads: hw.cpuThreads,
    toolchain: st.toolchain,
    firstEngineCandidate: candidates[0],
  });
})();
