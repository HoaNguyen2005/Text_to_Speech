require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./app/models/user.model');

// === CẤU HÌNH TÀI KHOẢN ADMIN ===
const ADMIN = {
    email: 'hoanguyen.11012005@gmail.com',
    password: 'Admin@123',
    fullName: 'Nguyễn Hữu Thanh Hòa',
    gender: 'male',
    role: 'admin',
};
// ==================================

async function createAdmin() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Đã kết nối MongoDB...");

        // Kiểm tra xem email đã tồn tại chưa
        const existing = await User.findOne({ email: ADMIN.email });
        if (existing) {
            // Nếu đã có thì chỉ cập nhật role thành admin
            existing.role = 'admin';
            await existing.save();
            console.log(`⚠️  Tài khoản ${ADMIN.email} đã tồn tại. Đã nâng cấp lên Admin.`);
        } else {
            // Nếu chưa có thì tạo mới
            const hashedPassword = await bcrypt.hash(ADMIN.password, 10);
            await User.create({
                email: ADMIN.email,
                password: hashedPassword,
                fullName: ADMIN.fullName,
                gender: ADMIN.gender,
                role: ADMIN.role,
                status: 'active'
            });
            console.log(`✅ Đã tạo tài khoản Admin thành công!`);
            console.log(`   Email   : ${ADMIN.email}`);
            console.log(`   Password: ${ADMIN.password}`);
        }

        process.exit(0);
    } catch (error) {
        console.error("❌ Lỗi:", error.message);
        process.exit(1);
    }
}

createAdmin();
