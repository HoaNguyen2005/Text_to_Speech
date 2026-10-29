const fs = require('fs');

// Lớp trừu tượng lưu trữ file âm thanh: Cloudflare R2 (S3-compatible) hoặc đĩa local.
// - Khi cấu hình đủ 4 biến R2_* → mọi upload/download đi qua R2, URL trả về là
//   public URL (nếu có R2_PUBLIC_BASE_URL) hoặc presigned URL tạm thời.
// - Khi chưa cấu hình → hệ thống chạy như cũ (file trên đĩa, phục vụ qua /public).
//
// Quy ước key trong R2 (và trong DB):
//   - Giọng mẫu:    samples/<voice_id>.<ext>   (Voice.file_path)
//   - Audio kết quả: generated/<tên file>.wav  (GeneratedLecture.audio_url)
// DB chỉ lưu key; URL chơi được được sinh ra lúc trả API (history tự làm mới presign).

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL; // vd: https://cdn.tenmien.com (tùy chọn)
const configuredExpiry = Number.parseInt(process.env.R2_PRESIGN_EXPIRY || '3600', 10);
const PRESIGN_EXPIRY_SECONDS = Number.isInteger(configuredExpiry) && configuredExpiry > 0
    ? Math.min(configuredExpiry, 604800)
    : 3600;

let _client = null;

function isR2Enabled() {
    return Boolean(R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

function _getClient() {
    if (_client) return _client;
    const { S3Client } = require('@aws-sdk/client-s3');
    _client = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY
        }
    });
    return _client;
}

// Giá trị trong DB là "key" (samples/..., generated/...) hay URL http đầy đủ (dữ liệu cũ)
function isStorageKey(value) {
    return typeof value === 'string' && /^(samples|generated)\/[^/]+$/.test(value);
}

async function uploadBuffer(buffer, key, contentType) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await _getClient().send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream'
    }));
}

async function uploadFile(filePath, key, contentType) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const stat = await fs.promises.stat(filePath);
    await _getClient().send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key,
        Body: fs.createReadStream(filePath), ContentLength: stat.size,
        ContentType: contentType || 'application/octet-stream' }));
}

// Sinh URL truy cập được từ key: public base URL nếu cấu hình, ngược lại presigned.
// Không bật R2 → trả nguyên giá trị (chế độ local cũ).
async function resolveUrl(keyOrUrl) {
    if (!isR2Enabled() || !isStorageKey(keyOrUrl)) {
        return keyOrUrl;
    }
    if (R2_PUBLIC_BASE_URL) {
        return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${keyOrUrl}`;
    }
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return getSignedUrl(_getClient(), new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: keyOrUrl
    }), { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

async function deleteFile(key) {
    if (!isR2Enabled() || !/^generated\/book-[a-f0-9]{24}-[a-f0-9]{64}\.wav$/.test(key)) return;
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await _getClient().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
// Compensate only a newly uploaded sample with a request-specific UUID.
// Legacy sample keys and all other objects are excluded.
async function deleteVoiceSample(key) {
    if (!isR2Enabled() || !/^samples\/[a-zA-Z0-9_-]{1,80}\.[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.(wav|mp3|m4a|flac|ogg|webm)$/.test(key)) {
        throw new Error('Invalid pending voice sample key');
    }
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await _getClient().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
async function deleteBookParts(jobId) {
    if (!isR2Enabled() || !/^[a-f0-9]{24}$/.test(jobId)) return;
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    let cursor;
    do {
        const page = await _getClient().send(new ListObjectsV2Command({ Bucket: R2_BUCKET,
            Prefix: `generated/book-${jobId}-`, ContinuationToken: cursor }));
        // The final MP3 uses the same prefix. Only disposable hashed WAV parts
        // belong to cleanup; never remove a published result/history object.
        const partPattern = new RegExp(`^generated/book-${jobId}-[a-f0-9]{64}\\.wav$`);
        for (const object of page.Contents || []) if (partPattern.test(object.Key)) await deleteFile(object.Key);
        cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (cursor);
}
// Call after processing stops and after checking that no published history exists.
async function deleteDiscardedBookAudio(jobId) {
    if (!/^[a-f0-9]{24}$/.test(jobId)) throw new Error('Invalid discarded book ID');
    const patterns = [new RegExp(`^book-${jobId}-(?:[a-f0-9]{64}[.]wav|final_[a-f0-9]{64}[.](?:mp3|srt))$`),
        new RegExp(`^book-preview-${jobId}-preview_[a-f0-9]{64}[.]mp3$`)];
    const allowed = (name) => patterns.some((pattern) => pattern.test(name));
    if (isR2Enabled()) {
        const { ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
        for (const prefix of [`generated/book-${jobId}-`, `generated/book-preview-${jobId}-`]) {
            let cursor;
            do {
                const page = await _getClient().send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: cursor }));
                for (const object of page.Contents || []) {
                    if (object.Key?.startsWith('generated/') && allowed(object.Key.slice('generated/'.length))) {
                        await _getClient().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: object.Key }));
                    }
                }
                cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (cursor);
        }
    }
    const path = require('path');
    const directory = path.resolve(__dirname, '../../public/audio/generated');
    let files;
    try { files = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const file of files) {
        const target = path.resolve(directory, file.name);
        if (file.isFile() && allowed(file.name) && path.dirname(target) === directory) {
            await fs.promises.unlink(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
        }
    }
}
async function deletePendingStudioFile(key) {
    if(!isR2Enabled()||!/^generated\/studio-[a-f0-9]{24}-final_[a-f0-9]{64}[.](?:mp3|srt)$/.test(key))return;
    const {DeleteObjectCommand}=require('@aws-sdk/client-s3');
    await _getClient().send(new DeleteObjectCommand({Bucket:R2_BUCKET,Key:key}));
}
module.exports = { isR2Enabled, isStorageKey, uploadBuffer, uploadFile, resolveUrl, deleteFile, deleteVoiceSample, deleteBookParts, deleteDiscardedBookAudio, deletePendingStudioFile };
