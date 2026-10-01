require('dotenv').config();
const mongoose = require('mongoose');
const Voice = require('./app/models/voice.model');
const User = require('./app/models/user.model');

const defaultVoices = [
    {
        voice_id: 'male',
        name: 'Giọng Nam Mẫu',
        gender: 'male',
        file_path: 'public/audio/samples/male.wav',
        is_global: true
    },
    {
        voice_id: 'female',
        name: 'Giọng Nữ Mẫu',
        gender: 'female',
        file_path: 'public/audio/samples/female.wav',
        is_global: true
    },
    {
        voice_id: 'male_ThanhHoa',
        name: 'Giọng Nam Thanh Hòa',
        gender: 'male',
        file_path: 'public/audio/samples/male_ThanhHoa.m4a',
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
            process.exit(1);
        }

        console.log(`👤 Gán giọng mẫu cho admin: ${admin.email}`);

        // Xóa hết giọng mẫu cũ để tránh trùng lặp
        await Voice.deleteMany({});
        
        // Thêm giọng mặc định, đính kèm user_id của admin
        const voicesWithOwner = defaultVoices.map(v => ({ ...v, user_id: admin._id }));
        await Voice.insertMany(voicesWithOwner);
        
        console.log("✅ Đã đẩy 3 giọng mẫu mặc định lên MongoDB Atlas thành công!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Lỗi khi khởi tạo giọng mẫu:", error);
        process.exit(1);
    }
}

seedVoices();
