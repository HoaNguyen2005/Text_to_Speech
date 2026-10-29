const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const file = path.join(__dirname, '../.env.books.local');
try {
    fs.writeFileSync(file, `BOOK_ENGINE_SECRET=${crypto.randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    console.log('Đã tạo khóa nội bộ trong backend/.env.books.local. Khởi động lại Backend, Engine và worker.');
} catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Cấu hình sách nói đã tồn tại; giữ nguyên khóa nội bộ.');
}
