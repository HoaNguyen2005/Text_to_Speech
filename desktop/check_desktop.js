const assert = require('node:assert/strict');
const { DesktopRuntimeManager, parseNvidiaSmiOutput, parseEnvContent } = require('./runtime-manager');

(async () => {
  const gpu = parseNvidiaSmiOutput('NVIDIA GeForce RTX 4060, 8188\n');
  assert.deepEqual(gpu, { hasNvidiaGpu: true, gpuName: 'NVIDIA GeForce RTX 4060', vramMb: 8188 });
  assert.deepEqual(parseNvidiaSmiOutput(''), { hasNvidiaGpu: false, gpuName: null, vramMb: null });

  const parsed = parseEnvContent('# comment\nFOO="bar"\nLOCAL_ENGINE_FIRST=true\n');
  assert.deepEqual(parsed, { FOO: 'bar', LOCAL_ENGINE_FIRST: 'true' });

  const mgr = new DesktopRuntimeManager();
  const hw = await mgr.detectHardware();
  assert.ok(['cuda', 'cpu'].includes(hw.preferredDevice));
  assert.ok(hw.cpuThreads >= 1);

  process.env.LOCAL_ENGINE_FIRST = 'true';
  process.env.ENGINE_URL = 'http://127.0.0.1:8000';
  const { getCandidates } = require('../backend/app/services/engine_artifact.service');
  const candidates = await getCandidates(false);
  assert.equal(candidates[0].url, 'http://127.0.0.1:8000');
  assert.equal(candidates[0].role, 'local-primary');

  console.log('PASS desktop self-check:', {
    preferredDevice: hw.preferredDevice,
    gpuName: hw.gpuName,
    cpuThreads: hw.cpuThreads,
    firstEngineCandidate: candidates[0],
  });
})();
