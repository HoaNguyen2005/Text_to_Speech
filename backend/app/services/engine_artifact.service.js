const fs = require('fs/promises');
const { createWriteStream } = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('../config/book');

const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;
const problem = (status, message) => Object.assign(new Error(message), { status });

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
    const url = `${config.engineUrl}/book/artifact/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'X-Book-Engine-Secret': config.engineSecret },
        signal: AbortSignal.timeout(120000),
    });
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
    const url = `${config.engineUrl}/book/artifact/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-Book-Engine-Secret': config.engineSecret,
        },
        body: buffer,
        signal: AbortSignal.timeout(120000),
    });
    return response.ok;
}

async function cleanupLocal(jobId) {
    const id = String(jobId || '');
    if (!/^[a-f0-9]{24}$/.test(id)) return;
    const directory = path.resolve(config.artifactRoot, id);
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
}

async function status() {
    try {
        const response = await fetch(`${config.engineUrl}/health/ready`, {
            method: 'GET',
            signal: AbortSignal.timeout(8000),
        });
        const data = await response.json().catch(() => ({}));
        return {
            online: response.ok,
            http_status: response.status,
            engine_url: config.engineUrl,
            ...data,
        };
    } catch (error) {
        return {
            online: false,
            engine_url: config.engineUrl,
            error: error.name === 'TimeoutError' ? 'Engine phản hồi quá hạn.' : 'Không kết nối được Engine.',
        };
    }
}

module.exports = {
    localPath,
    exists,
    materialize,
    pushToEngine,
    cleanupLocal,
    status,
};

