require('dotenv').config();
const database = require('./app/db/postgres');
const Voice = require('./app/models/voice.model');
const User = require('./app/models/user.model');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const storage = require('./app/services/storage.service');
const sampleDir = path.join(__dirname, 'public', 'audio', 'samples');

// file_path = key lưu trữ (R2 nếu bật; Engine fallback đĩa local vẫn glob theo voice_id
// nên chế độ dev không R2 cũng chạy được)
const defaultVoices = [
    {
        voice_id: 'male',
        name: 'Giọng Nam Mẫu',
        gender: 'male',
        file_name: 'male.wav',
        is_global: true
    },
    {
        voice_id: 'female',
        name: 'Giọng Nữ Mẫu',
        gender: 'female',
        file_name: 'female.wav',
        is_global: true
    }
];

async function seedVoices() {
    try {
        await database.connect();
        console.log("Đã kết nối PostgreSQL để khởi tạo giọng mẫu...");

        // Chỉ bổ sung mẫu chuẩn còn thiếu, không nhận giọng người dùng làm mẫu hệ thống.
        let created = 0;
        for (const voice of defaultVoices) {
            let pendingKey;
            try {
                const added = await database.transaction(async () => {
                    await database.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`voice-seed:${voice.voice_id}`]);
                    // Giữ nguyên cả bản ghi đã ẩn, tên, chủ sở hữu và đường dẫn hiện tại.
                    if (await Voice.findOne({ voice_id: voice.voice_id })) return false;
                    const admin = await User.findOne({ role: 'admin', status: 'active' });
                    if (!admin) throw new Error('Không tìm thấy admin đang hoạt động. Đăng nhập bằng admin Keycloak trước.');
                    const localPath = path.join(sampleDir, voice.file_name);
                    if (!fs.existsSync(localPath)) throw new Error(`Không tìm thấy file giọng mẫu: ${localPath}`);
                    let file_path = `public/audio/samples/${voice.file_name}`;
                    if (storage.isR2Enabled()) {
                        // Key mới riêng biệt, không ghi đè âm thanh đã được sử dụng.
                        pendingKey = `samples/${voice.voice_id}.${randomUUID()}${path.extname(voice.file_name)}`;
                        await storage.uploadFile(localPath, pendingKey, 'audio/wav');
                        file_path = pendingKey;
                    }
                    const { file_name, ...voiceData } = voice;
                    await Voice.create({ ...voiceData, file_path, user_id: admin._id });
                    return true;
                });
                pendingKey = undefined;
                if (added) created++;
                console.log(`${voice.voice_id}: ${added ? 'đã thêm' : 'đã có, giữ nguyên'}`);
            } catch (error) {
                if (pendingKey) {
                    // Chỉ dọn file mới chưa được DB tham chiếu nếu thao tác bị rollback.
                    const referenced = await Voice.findOne({ file_path: pendingKey });
                    if (!referenced) await storage.deleteVoiceSample(pendingKey).catch(() => console.error('Không dọn được file seed tạm.'));
                }
                throw error;
            }
        }
        console.log(`✅ Đã bổ sung ${created} giọng mẫu. Giữ nguyên toàn bộ giọng đã có.`);
        await database.close();
    } catch (error) {
        console.error("❌ Lỗi khi khởi tạo giọng mẫu:", error);
        await database.close().catch(() => {});
        process.exitCode = 1;
    }
}

seedVoices();
