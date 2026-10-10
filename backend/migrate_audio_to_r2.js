// Migration một lần: đưa toàn bộ audio trên đĩa lên Cloudflare R2 và cập nhật DB.
//
// Cách chạy (yêu cầu đã điền đủ R2_* trong backend/.env):
//   node migrate_audio_to_r2.js
//
// File sẽ:
//   1. Upload mọi file trong public/audio/samples/*  → key R2 "samples/<tên file>"
//      và cập nhật Voice.file_path từ đường dẫn local sang key.
//   2. Upload mọi file trong public/audio/generated/* → key R2 "generated/<tên file>"
//      và cập nhật GeneratedLecture.audio_url từ URL local sang key.
//
// Script idempotent (chạy lại không trùng lặp), file trên đĩa được GIỮ NGUYÊN
// (để fallback dev vẫn chạy; xóa tay khi chắc chắn không cần nữa).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const storage = require('./app/services/storage.service');
const Voice = require('./app/models/voice.model');
const GeneratedLecture = require('./app/models/generated_lecture.model');

const SAMPLES_DIR = path.join(__dirname, 'public', 'audio', 'samples');
const GENERATED_DIR = path.join(__dirname, 'public', 'audio', 'generated');

const AUDIO_EXTS = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm'];
const CONTENT_TYPES = {
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
    '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.webm': 'audio/webm'
};

async function uploadDir(dir, prefix) {
    if (!fs.existsSync(dir)) {
        console.log(`  Thư mục không tồn tại, bỏ qua: ${dir}`);
        return [];
    }
    const uploaded = [];
    for (const name of fs.readdirSync(dir)) {
        const ext = path.extname(name).toLowerCase();
        if (!AUDIO_EXTS.includes(ext)) continue;
        const localPath = path.join(dir, name);
        const key = `${prefix}/${name}`;
        console.log(`  ↑ ${key}`);
        await storage.uploadFile(localPath, key, CONTENT_TYPES[ext]);
        uploaded.push({ name, key });
    }
    return uploaded;
}

async function migrate() {
    if (!storage.isR2Enabled()) {
        console.error("❌ Chưa cấu hình R2! Điền R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY trong backend/.env rồi chạy lại.");
        process.exit(1);
    }
    console.log(`🪣 Bucket: ${process.env.R2_BUCKET}\n`);

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Đã kết nối MongoDB\n");

    // 1. Giọng mẫu
    console.log("=== 1. Upload giọng mẫu (samples/) ===");
    await uploadDir(SAMPLES_DIR, 'samples');
    const voices = await Voice.find();
    let voiceUpdated = 0;
    for (const v of voices) {
        if (storage.isStorageKey(v.file_path)) continue; // đã là key R2
        const newName = path.posix.basename((v.file_path || '').replace(/\\/g, '/').split(/[?#]/)[0]);
        if (!newName) continue;
        const localPath = path.join(SAMPLES_DIR, newName);
        if (!fs.existsSync(localPath)) {
            console.warn(`  ! Không tìm thấy file mẫu ${newName}; giữ nguyên Voice ${v.voice_id}`);
            continue;
        }
        v.file_path = `samples/${newName}`;
        await v.save();
        voiceUpdated++;
    }
    console.log(`   → Đã cập nhật ${voiceUpdated}/${voices.length} bản ghi Voice sang key R2.\n`);

    // 2. Audio đã sinh (generated/)
    console.log("=== 2. Upload audio kết quả (generated/) ===");
    const generatedFiles = await uploadDir(GENERATED_DIR, 'generated');
    const generatedFileNames = new Set(generatedFiles.map(file => file.name));
    const lectures = await GeneratedLecture.find();
    let lecUpdated = 0;
    let lecMissing = 0;
    for (const l of lectures) {
        if (storage.isStorageKey(l.audio_url)) continue; // đã là key
        const oldName = path.posix.basename((l.audio_url || '').replace(/\\/g, '/').split(/[?#]/)[0]);
        if (!oldName || !generatedFileNames.has(oldName)) {
            console.warn(`  ! Thiếu file nguồn cho lịch sử ${l._id}: ${oldName || '(không có tên file)'}`);
            lecMissing++;
            continue;
        }
        l.audio_url = `generated/${oldName}`;
        await l.save();
        lecUpdated++;
    }
    console.log(`   → Đã cập nhật ${lecUpdated}/${lectures.length} bản ghi GeneratedLecture; thiếu file nguồn: ${lecMissing}.\n`);

    console.log("✅ Migration hoàn tất! File trên đĩa được giữ lại để fallback dev (có thể xóa tay sau này).");
    await mongoose.disconnect();
}

migrate().catch(err => {
    console.error("❌ Lỗi migration:", err.message);
    mongoose.disconnect().finally(() => { process.exitCode = 1; });
});
