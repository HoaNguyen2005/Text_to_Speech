const User = require('../models/user.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
    try {
        const { email, password, fullName, gender } = req.body;

        if (!email || !password || !fullName) {
            return res.status(400).json({ error: "Vui lòng nhập họ tên, email và mật khẩu" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: "Email này đã được sử dụng" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            email, 
            password: hashedPassword,
            fullName,
            gender: gender || 'other',
            role: 'user'   // Tài khoản đăng ký qua web luôn là user
        });
        await newUser.save();

        res.status(201).json({ message: "Đăng ký thành công!" });
    } catch (error) {
        console.error("[ERROR REGISTER]", error);
        res.status(500).json({ error: "Lỗi hệ thống khi đăng ký" });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Vui lòng nhập email và mật khẩu" });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: "Email hoặc mật khẩu không đúng" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Email hoặc mật khẩu không đúng" });
        }

        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET || 'secret_key_123',
            { expiresIn: '7d' }
        );

        res.json({
            message: "Đăng nhập thành công!",
            token,
            user: { 
                email: user.email,
                fullName: user.fullName,
                gender: user.gender,
                role: user.role
            }
        });
    } catch (error) {
        console.error("[ERROR LOGIN]", error);
        res.status(500).json({ error: "Lỗi hệ thống khi đăng nhập" });
    }
};

// Lấy danh sách tất cả người dùng (Cho Admin)
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: "Lỗi khi tải danh sách người dùng" });
    }
};

// Cập nhật trạng thái người dùng (Cho Admin)
exports.updateUserStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const updatedUser = await User.findByIdAndUpdate(id, { status }, { new: true }).select('-password');
        if (!updatedUser) {
            return res.status(404).json({ error: "Không tìm thấy người dùng" });
        }
        res.json({ message: "Cập nhật thành công", user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: "Lỗi khi cập nhật trạng thái người dùng" });
    }
};

// Cập nhật role người dùng (Admin tạo admin)
exports.updateUserRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!['user', 'admin'].includes(role)) {
            return res.status(400).json({ error: "Role không hợp lệ" });
        }

        const updatedUser = await User.findByIdAndUpdate(
            id, 
            { role }, 
            { returnDocument: 'after' }
        ).select('-password');

        if (!updatedUser) {
            return res.status(404).json({ error: "Không tìm thấy người dùng" });
        }
        res.json({ message: "Cập nhật role thành công", user: updatedUser });
    } catch (error) {
        res.status(500).json({ error: "Lỗi khi cập nhật role" });
    }
};
