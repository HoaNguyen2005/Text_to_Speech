const fs = require('fs');
const path = require('path');
// Old Phase 2/3 tools use raw Mongo collections. Never point their fixture server at PostgreSQL.
if (fs.existsSync(path.join(__dirname,'../../.env.postgres.local')) || process.env.DATABASE_URL) {
    throw new Error('Công cụ này dành cho giai đoạn MongoDB cũ và đã khóa khi cấu hình PostgreSQL tồn tại. Không chạy với database ứng dụng PostgreSQL; xem POSTGRES_MIGRATION.md.');
}
