const fs = require('fs/promises');
const { createWriteStream } = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('../config/book');
const { validateEngineUrl } = require('../config/runtime');
const db = require('../db/postgres');

const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;
const DB_CACHE_TTL_MS = 8000;
const HEALTH_TTL_MS = 15000;
const PROBE_TIMEOUT_MS = 2500;
const problem = (status, message) => Object.assign(new Error(message), { status });

let dbNodesCache = { checkedAt: 0, gpu: null, cpu: null };
let healthCache = { checkedAt: 0, url: null, role: null, device: null };
const jobPinnedUrl = new Map();

function invalidateEngineCache(removedUrl = null) {
    dbNodesCache = { checkedAt: 0, gpu: null, cpu: null };
    healthCache = { checkedAt: 0, url: null, role: null, device: null };
    if (removedUrl) {
        for (const [jobId, url] of jobPinnedUrl.entries()) {
            if (url === removedUrl) jobPinnedUrl.delete(jobId);
        }
    }
}

async function loadRegisteredNodes(force = false) {
    if (!force && Date.now() - dbNodesCache.checkedAt < DB_CACHE_TTL_MS) {
        return dbNodesCache;
    }
    try {
        const res = await db.query(
            "SELECT _id, owner, until, legacy_data FROM worker_leases WHERE _id IN ('engine-node:gpu', 'engine-node:cpu')"
        );
        let gpu = null;
        let cpu = null;
        for (const row of res.rows || []) {
            if (!row.owner) continue;
            const entry = {
                url: String(row.owner).replace(/\/+$/, ''),
                updatedAt: row.until,
                meta: row.legacy_data || {},
            };
            if (row._id === 'engine-node:gpu') gpu = entry;
            if (row._id === 'engine-node:cpu') cpu = entry;
        }
        dbNodesCache = { checkedAt: Date.now(), gpu, cpu };
    } catch {
        // Keep working with env config if DB is not yet connected or during unit tests.
    }
    return dbNodesCache;
}

async function getCandidates(forceDb = false) {
    const registered = await loadRegisteredNodes(forceDb);
    const raw = [];
    if (registered.gpu?.url) {
        raw.push({ role: 'gpu', source: 'registered-gpu', url: registered.gpu.url, meta: registered.gpu.meta });
    }
    if (config.engineUrl) {
        raw.push({ role: 'primary-env', source: 'env-primary', url: config.engineUrl, meta: {} });
    }
    if (registered.cpu?.url) {
        raw.push({ role: 'cpu', source: 'registered-cpu', url: registered.cpu.url, meta: registered.cpu.meta });
    }
    if (config.engineFallbackUrl) {
        raw.push({ role: 'fallback-env', source: 'env-fallback', url: config.engineFallbackUrl, meta: {} });
    }
    const seen = new Set();
    const unique = [];
    for (const item of raw) {
        const normalized = String(item.url || '').replace(/\/+$/, '');
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push({ ...item, url: normalized });
    }
    return unique.length ? unique : [{ role: 'default', source: 'default', url: 'http://127.0.0.1:8000', meta: {} }];
}

async function probeUrl(url, timeoutMs = PROBE_TIMEOUT_MS) {
    try {
        const response = await fetch(`${url}/health/ready`, {
            method: 'GET',
            signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await response.json().catch(() => ({}));
        const online = response.ok && (data?.status === 'ok' || data?.status === 'ready');
        return {
            online,
            http_status: response.status,
            engine_url: url,
            ...data,
        };
    } catch (error) {
        return {
            online: false,
            engine_url: url,
            error: error.name === 'TimeoutError' ? 'Engine phản hồi quá hạn.' : 'Không kết nối được Engine.',
        };
    }
}

async function resolveEngineUrl(jobId = null, { forceRefresh = false, excludeUrl = null } = {}) {
    const candidates = await getCandidates(forceRefresh);
    const id = jobId ? String(jobId) : null;

    if (!forceRefresh && !excludeUrl && candidates.length === 1) {
        const single = candidates[0].url;
        if (id) jobPinnedUrl.set(id, single);
        return single;
    }

    if (id && jobPinnedUrl.has(id) && !forceRefresh) {
        const pinned = jobPinnedUrl.get(id);
        if (pinned !== excludeUrl) {
            if (healthCache.url === pinned && Date.now() - healthCache.checkedAt < HEALTH_TTL_MS) {
                return pinned;
            }
            const check = await probeUrl(pinned, PROBE_TIMEOUT_MS);
            if (check.online) {
                healthCache = { checkedAt: Date.now(), url: pinned, role: 'pinned', device: check.device || null };
                return pinned;
            }
        }
        jobPinnedUrl.delete(id);
    }

    if (!forceRefresh && !excludeUrl && healthCache.url && Date.now() - healthCache.checkedAt < HEALTH_TTL_MS) {
        // If currently on a non-GPU node and a registered GPU node exists, re-probe once TTL expires.
        if (id) jobPinnedUrl.set(id, healthCache.url);
        return healthCache.url;
    }

    for (const candidate of candidates) {
        if (excludeUrl && candidate.url === excludeUrl) continue;
        const check = await probeUrl(candidate.url, PROBE_TIMEOUT_MS);
        if (check.online) {
            if (healthCache.url !== candidate.url) {
                console.log(`[ENGINE ROUTER] Chuyển sang node ${candidate.role} (${candidate.url}, device=${check.device || 'unknown'})`);
            }
            healthCache = {
                checkedAt: Date.now(),
                url: candidate.url,
                role: candidate.role,
                device: check.device || null,
            };
            if (id) jobPinnedUrl.set(id, candidate.url);
            return candidate.url;
        }
    }

    const fallback = (candidates.find((c) => c.url !== excludeUrl) || candidates[0]).url;
    if (id) jobPinnedUrl.set(id, fallback);
    return fallback;
}

async function fetchWithFailover(pathSuffix, initFactory, { jobId = null } = {}) {
    const firstUrl = await resolveEngineUrl(jobId);
    const attemptFetch = async (baseUrl) => {
        const init = typeof initFactory === 'function' ? initFactory(baseUrl) : initFactory;
        return fetch(`${baseUrl}${pathSuffix}`, init);
    };

    try {
        const response = await attemptFetch(firstUrl);
        // Cloudflare Tunnel offline codes: 530 (Error 1033), 502, 504
        if ([502, 504, 530].includes(response.status)) {
            const nextUrl = await resolveEngineUrl(jobId, { forceRefresh: true, excludeUrl: firstUrl });
            if (nextUrl && nextUrl !== firstUrl) {
                console.warn(`[ENGINE FAILOVER] Node ${firstUrl} trả mã ${response.status}; chuyển tự động sang ${nextUrl}`);
                return { response: await attemptFetch(nextUrl), engineUrl: nextUrl, switched: true };
            }
        }
        return { response, engineUrl: firstUrl, switched: false };
    } catch (firstError) {
        if (firstError?.name === 'AbortError') throw firstError;
        const nextUrl = await resolveEngineUrl(jobId, { forceRefresh: true, excludeUrl: firstUrl });
        if (nextUrl && nextUrl !== firstUrl) {
            console.warn(`[ENGINE FAILOVER] Không kết nối được ${firstUrl} (${firstError.message}); chuyển tự động sang ${nextUrl}`);
            return { response: await attemptFetch(nextUrl), engineUrl: nextUrl, switched: true };
        }
        throw firstError;
    }
}

async function registerNode({ role, engineUrl, label = '' }) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (!['gpu', 'cpu'].includes(normalizedRole)) {
        throw problem(400, 'role phải là "gpu" hoặc "cpu".');
    }
    let normalizedUrl;
    try {
        normalizedUrl = validateEngineUrl(engineUrl, 'engine_url');
    } catch (err) {
        throw problem(400, err.message);
    }
    const probe = await probeUrl(normalizedUrl, 4000);
    const meta = {
        role: normalizedRole,
        label: String(label || '').slice(0, 120),
        device: probe.device || (normalizedRole === 'gpu' ? 'cuda' : 'cpu'),
        gpu_name: probe.gpu_name || null,
        online_at_register: probe.online,
        registered_at: new Date().toISOString(),
    };
    await db.query(
        `INSERT INTO worker_leases (_id, owner, until, legacy_data)
         VALUES ($1, $2, now(), $3::jsonb)
         ON CONFLICT (_id) DO UPDATE
         SET owner = EXCLUDED.owner, until = now(), legacy_data = EXCLUDED.legacy_data`,
        [`engine-node:${normalizedRole}`, normalizedUrl, JSON.stringify(meta)]
    );
    invalidateEngineCache();
    if (normalizedRole === 'gpu' && probe.online) {
        healthCache = { checkedAt: Date.now(), url: normalizedUrl, role: 'gpu', device: probe.device || 'cuda:0' };
    }
    console.log(`[ENGINE REGISTRY] Đã đăng ký node ${normalizedRole.toUpperCase()} -> ${normalizedUrl} (online=${probe.online}, device=${meta.device})`);
    return {
        status: 'ok',
        role: normalizedRole,
        engine_url: normalizedUrl,
        online: probe.online,
        device: meta.device,
        gpu_name: meta.gpu_name,
    };
}

async function unregisterNode(role) {
    const normalizedRole = String(role || '').trim().toLowerCase();
    if (!['gpu', 'cpu'].includes(normalizedRole)) {
        throw problem(400, 'role phải là "gpu" hoặc "cpu".');
    }
    const existing = await db.query('SELECT owner FROM worker_leases WHERE _id = $1', [`engine-node:${normalizedRole}`]).catch(() => ({ rows: [] }));
    const removedUrl = existing.rows?.[0]?.owner || null;
    await db.query('DELETE FROM worker_leases WHERE _id = $1', [`engine-node:${normalizedRole}`]);
    invalidateEngineCache(removedUrl);
    console.log(`[ENGINE REGISTRY] Đã gỡ đăng ký node ${normalizedRole.toUpperCase()}`);
    return { status: 'ok', role: normalizedRole, unregistered: true };
}

function localPath(jobId, engineOutputPath, errorMessage = 'Đường dẫn âm thanh không hợp lệ.') {
    const id = String(jobId || '');
    const normalized = String(engineOutputPath || '').replace(/\\/g, '/');
    const name = path.posix.basename(normalized);
    if (!/^[a-f0-9]{24}$/.test(id) || !/^[a-z0-9_.-]+$/.test(name) || name.includes('..')) {
        throw problem(503, errorMessage);
    }
    const directory = path.resolve(config.artifactRoot, id);
    const resolved = path.resolve(directory, name);
    if (path.dirname(resolved) !== directory) {
        throw problem(503, errorMessage);
    }
    return resolved;
}

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function materialize(jobId, engineOutputPath, errorMessage) {
    const target = localPath(jobId, engineOutputPath, errorMessage);
    if (await exists(target)) return target;

    const id = String(jobId);
    const name = path.basename(target);
    const { response } = await fetchWithFailover(
        `/book/artifact/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
        () => ({
            method: 'GET',
            headers: { 'X-Book-Engine-Secret': config.engineSecret },
            signal: AbortSignal.timeout(120000),
        }),
        { jobId: id }
    );
    if (!response.ok) {
        throw problem(503, errorMessage || 'Không tải được tệp âm thanh từ Engine.');
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    let bytes = 0;
    const bound = new Transform({
        transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            callback(bytes > MAX_ARTIFACT_BYTES ? problem(503, 'Tệp âm thanh từ Engine vượt giới hạn.') : null, chunk);
        },
    });
    const temp = `${target}.${process.pid}.${Date.now()}.download`;
    try {
        await pipeline(Readable.fromWeb(response.body), bound, createWriteStream(temp));
        await fs.rename(temp, target);
        return target;
    } finally {
        await fs.unlink(temp).catch(() => {});
    }
}

async function pushToEngine(jobId, localFilePath) {
    const target = localPath(jobId, localFilePath);
    if (!await exists(target)) return false;
    const id = String(jobId);
    const name = path.basename(target);
    const buffer = await fs.readFile(target);
    const { response } = await fetchWithFailover(
        `/book/artifact/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
        () => ({
            method: 'PUT',
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-Book-Engine-Secret': config.engineSecret,
            },
            body: buffer,
            signal: AbortSignal.timeout(120000),
        }),
        { jobId: id }
    );
    return response.ok;
}

async function cleanupLocal(jobId) {
    const id = String(jobId || '');
    jobPinnedUrl.delete(id);
    if (!/^[a-f0-9]{24}$/.test(id)) return;
    const directory = path.resolve(config.artifactRoot, id);
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
}

async function status() {
    const candidates = await getCandidates(true);
    const nodes = await Promise.all(
        candidates.map(async (item) => {
            const check = await probeUrl(item.url, 4000);
            return {
                role: item.role,
                source: item.source,
                ...check,
            };
        })
    );
    const active = nodes.find((n) => n.online) || nodes[0];
    if (active?.online) {
        healthCache = {
            checkedAt: Date.now(),
            url: active.engine_url,
            role: active.role,
            device: active.device || null,
        };
    }
    return {
        ...active,
        active_role: active?.role || 'unknown',
        nodes,
    };
}

module.exports = {
    localPath,
    exists,
    materialize,
    pushToEngine,
    cleanupLocal,
    status,
    resolveEngineUrl,
    fetchWithFailover,
    registerNode,
    unregisterNode,
    invalidateEngineCache,
};
