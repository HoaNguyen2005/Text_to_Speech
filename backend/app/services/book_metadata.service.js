const AI_SUMMARY_NOTICE = 'Bản tóm tắt do AI hỗ trợ';
const OPENING_LINES = Object.freeze([
    'Phần nội dung chính xin được bắt đầu.',
    'Và bây giờ, mời bạn cùng bước vào nội dung của cuốn sách.',
    'Sau đây, chúng ta sẽ cùng khám phá những nội dung chính của tác phẩm.',
    'Mời bạn cùng lắng nghe phần nội dung được tóm lược ngay sau đây.',
]);
function openingLine(index) {
    return Number.isInteger(index) && index >= 0 && index < OPENING_LINES.length ? OPENING_LINES[index] : '';
}
function normalizeMetadata(input, fallbackTitle = '') {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
        throw Object.assign(new Error('Thông tin nguồn sách không hợp lệ.'), { status: 400 });
    }
    const value = input || { title: fallbackTitle };
    const result = {};
    for (const [key, limit] of Object.entries({ title: 200, author: 200, source: 500 })) {
        if (value[key] !== undefined && typeof value[key] !== 'string') {
            throw Object.assign(new Error('Tên sách, tác giả và nguồn phải là văn bản.'), { status: 400 });
        }
        const text = (value[key] || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim();
        if (text.length > limit) throw Object.assign(new Error(`Thông tin ${key === 'title' ? 'tên sách' : key === 'author' ? 'tác giả' : 'nguồn'} vượt ${limit} ký tự.`), { status: 400 });
        result[key] = text;
    }
    if (input !== undefined && !result.title) throw Object.assign(new Error('Vui lòng nhập tên sách hoặc tài liệu.'), { status: 400 });
    return result;
}
function introduction(metadata, opening = '') {
    const title = metadata.title ? `Từ sách hoặc tài liệu: ${metadata.title}.` : 'Thông tin tên sách chưa được cung cấp.';
    const author = metadata.author ? `Tác giả: ${metadata.author}.` : 'Thông tin tác giả chưa được cung cấp.';
    const credits = `${AI_SUMMARY_NOTICE}. ${title} ${author} Nội dung tóm lược các ý chính của tài liệu. Hãy đối chiếu tác phẩm gốc khi cần thông tin chi tiết.`;
    return opening ? `${credits}\n\n${opening}` : credits;
}
module.exports = { AI_SUMMARY_NOTICE, normalizeMetadata, introduction, openingLine, openingCount:OPENING_LINES.length };
