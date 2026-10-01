const Lecture = require('../models/lecture.model');
const mammoth = require('mammoth');

// Lấy danh sách bài giảng
exports.getAllLectures = async (req, res) => {
    try {
        const lectures = await Lecture.find().sort({ createdAt: -1 });
        res.status(200).json({ status: 'success', data: lectures });
    } catch (error) {
        console.error('[ERROR] Lỗi khi lấy danh sách bài giảng:', error.message);
        res.status(500).json({ error: error.message });
    }
};

// Luồng 1: Tạo bài giảng bằng cách nhập liệu trực tiếp
exports.createLectureDirect = async (req, res) => {
    try {
        const { user_id, title, description, slides } = req.body;

        if (!title || !slides || !Array.isArray(slides) || slides.length === 0) {
            return res.status(400).json({ error: "Thiếu tiêu đề hoặc danh sách slides rỗng!" });
        }

        const formattedSlides = slides.map((content, index) => ({
            order_index: index + 1,
            content: content
        }));

        const newLecture = new Lecture({
            user_id: user_id || null, // Chờ tích hợp Auth thực tế
            title,
            description,
            status: 'draft',
            slides: formattedSlides
        });

        await newLecture.save();

        res.status(201).json({
            status: 'success',
            message: 'Tạo bài giảng trực tiếp thành công!',
            data: { lectureId: newLecture._id, total_slides: slides.length }
        });
    } catch (error) {
        console.error('[ERROR] Lỗi khi tạo bài giảng trực tiếp:', error.message);
        res.status(500).json({ error: error.message });
    }
};

// Luồng 2: Tạo bài giảng từ việc Upload File (.txt, .docx)
exports.createLectureFromFile = async (req, res) => {
    try {
        const { user_id, title, description } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "Vui lòng đính kèm file văn bản (.txt hoặc .docx)!" });
        }

        if (!title) {
            return res.status(400).json({ error: "Thiếu tiêu đề bài giảng!" });
        }

        let extractedText = "";

        if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
            extractedText = file.buffer.toString('utf-8');
        }
        else if (file.originalname.endsWith('.docx') || file.originalname.endsWith('.doc')) {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = result.value;
        } else {
            return res.status(400).json({ error: "Định dạng file không được hỗ trợ!" });
        }

        const rawSlides = extractedText.split('\n\n').map(s => s.trim()).filter(s => s.length > 0);
        
        if (rawSlides.length === 0) {
            return res.status(400).json({ error: "Không tìm thấy nội dung văn bản nào trong file!" });
        }

        const formattedSlides = rawSlides.map((content, index) => ({
            order_index: index + 1,
            content: content
        }));

        const newLecture = new Lecture({
            user_id: user_id || null,
            title,
            description,
            status: 'draft',
            slides: formattedSlides
        });

        await newLecture.save();

        res.status(201).json({
            status: 'success',
            message: 'Tạo bài giảng từ file thành công!',
            data: { lectureId: newLecture._id, total_slides: formattedSlides.length }
        });
    } catch (error) {
        console.error('[ERROR] Lỗi khi xử lý file bài giảng:', error.message);
        res.status(500).json({ error: error.message });
    }
};
