require('dotenv').config();
const mongoose = require('mongoose');
const Voice = require('./app/models/voice.model');
const User = require('./app/models/user.model');
const fs = require('fs');
const path = require('path');
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
    },
    {
        voice_id: 'male_ThanhHoa',
        name: 'Giọng Nam Thanh Hòa',
        gender: 'male',
        file_name: 'male_ThanhHoa.m4a',
        is_global: true
    }
];

async function seedVoices() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Đã kết nối MongoDB để khởi tạo giọng mẫu...");

        // Tìm tài khoản admin để gán làm chủ sở hữu
        const admin = await User.findOne({ role: 'admin' });
        if (!admin) {
            console.error("❌ Không tìm thấy tài khoản admin! Hãy chạy create_admin.js trước.");
            throw new Error('Không tìm thấy tài khoản admin! Hãy chạy create_admin.js trước.');
        }

        console.log(`👤 Gán giọng mẫu cho admin: ${admin.email}`);

        // Seed the sample objects when R2 is configured; otherwise keep local paths.
        const voicesWithOwner = [];
        for (const voice of defaultVoices) {
            const localPath = path.join(sampleDir, voice.file_name);
            const file_path = storage.isR2Enabled()
                ? `samples/${voice.file_name}`
                : `public/audio/samples/${voice.file_name}`;
            if (!fs.existsSync(localPath)) {
                throw new Error(`Không tìm thấy file giọng mẫu: ${localPath}`);
            }
            if (storage.isR2Enabled()) {
                const ext = path.extname(voice.file_name).toLowerCase();
                const contentType = ext === '.m4a' ? 'audio/mp4' : 'audio/wav';
                await storage.uploadFile(localPath, file_path, contentType);
            }
            const { file_name, ...voiceData } = voice;
            voicesWithOwner.push({ ...voiceData, file_path, user_id: admin._id });
        }
        // Preserve existing records if validation or an R2 upload fails.
        await Voice.deleteMany({});
        await Voice.insertMany(voicesWithOwner);
        
        console.log("✅ Đã đẩy 3 giọng mẫu mặc định lên MongoDB Atlas thành công!");
        await mongoose.disconnect();
    } catch (error) {
        console.error("❌ Lỗi khi khởi tạo giọng mẫu:", error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    }
}

seedVoices();
