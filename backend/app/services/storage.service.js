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
    const buffer = await fs.promises.readFile(filePath);
    await uploadBuffer(buffer, key, contentType);
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

module.exports = { isR2Enabled, isStorageKey, uploadBuffer, uploadFile, resolveUrl };
