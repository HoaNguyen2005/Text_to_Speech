const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

const verifyToken = async (req, res, next) => {
    try {
        let token = req.headers.authorization;
        if (!token) {
            return res.status(403).json({ error: "Không tìm thấy token xác thực!" });
        }

        if (token.startsWith('Bearer ')) {
            token = token.slice(7, token.length).trimLeft();
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key_123');
        const user = await User.findById(decoded.userId).select('-password');
        
        if (!user) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }

        if (user.status === 'banned') {
            return res.status(403).json({ error: "Tài khoản của bạn đã bị cấm!" });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn!" });
    }
};

// Middleware nhận diện người dùng "mềm": nếu có token hợp lệ thì gắn req.user,
// nếu không (khách vãng lai / token hết hạn) vẫn cho request đi tiếp.
const optionalAuth = async (req, res, next) => {
    try {
        let token = req.headers.authorization;
        if (token && token.startsWith('Bearer ')) {
            token = token.slice(7, token.length).trimLeft();
        }
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key_123');
            const user = await User.findById(decoded.userId).select('-password');
            if (user && user.status !== 'banned') {
                req.user = user;
            }
        }
    } catch (error) {
        // Token thiếu/hết hạn → coi như khách, không chặn request
    }
    next();
};

module.exports = { verifyToken, optionalAuth };
