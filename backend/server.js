const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

app.use(cors()); 
app.use(express.json()); 
const path = require('path');
app.use('/public', express.static(path.join(__dirname, 'public')));

// Import các routes
const lectureRoutes = require('./app/routes/lecture.route');
const authRoutes = require('./app/routes/auth.route');
const voiceRoutes = require('./app/routes/voice.route');
const historyRoutes = require('./app/routes/history.route');
const GeneratedLecture = require('./app/models/generated_lecture.model');
const { optionalAuth } = require('./app/middlewares/auth.middleware');

// Mount các routes vào ứng dụng
app.use('/api/lectures', lectureRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/voices', voiceRoutes);
app.use('/api/history', historyRoutes);

// Kết nối MongoDB Atlas với cấu hình retry để chịu được lúc Atlas tải cao
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tts_db', {
    serverSelectionTimeoutMS: 30000,  // Chờ tối đa 30s để chọn server
    socketTimeoutMS: 45000,           // Timeout mỗi operation
    connectTimeoutMS: 30000,          // Timeout kết nối ban đầu
    maxPoolSize: 5,                   // Giới hạn pool connection
    retryWrites: true,
    retryReads: true,
})
  .then(() => console.log('[DEBUG - DB] Kết nối MongoDB thành công!'))
  .catch(err => console.error('[ERROR - DB] Lỗi kết nối MongoDB:', err.message?.substring(0, 100)));

const PORT = process.env.PORT || 3000;

app.post('/api/generate-lecture', optionalAuth, async (req, res) => {
    const startTime = Date.now();
    
    console.log("\n" + "=".repeat(100));
    console.log(`[DEBUG - BACKEND GATEWAY] ĐÃ BẮT ĐƯỢC REQUEST TỪ FRONTEND VUE.JS`);
    console.log(`[DEBUG - TIME] Thời điểm nhận Request : ${new Date().toISOString()}`);
    console.log("=".repeat(100));

    try {
        // 1. Kiểm tra Request Header và Body
        console.log(`[DEBUG - HTTP REQUEST] Method: ${req.method} | Path: ${req.path}`);
        console.log(`[DEBUG - HTTP REQUEST] Headers Origin: ${req.headers.origin}`);
        
        const { text, teacher_id, style_id } = req.body;
        console.log(`[DEBUG - PAYLOAD EXTRACT] Text Length : ${text ? text.length : 0} chars`);
        console.log(`[DEBUG - PAYLOAD EXTRACT] Teacher ID  : ${teacher_id || 'Chưa cung cấp'}`);
        console.log(`[DEBUG - PAYLOAD EXTRACT] Style ID    : ${style_id || 'Mặc định'}`);
        
        // 2. Validate dữ liệu
        if (!text || text.trim() === '') {
            console.log(`[DEBUG - VALIDATION] THẤT BẠI! Text bị rỗng. Trả về mã lỗi 400.`);
            return res.status(400).json({ error: "Vui lòng nhập kịch bản bài giảng!" });
        }

        // 3. Giám sát tài nguyên máy chủ
        const memUsage = process.memoryUsage();
        console.log(`[DEBUG - MEMORY] Hệ thống Node.js đang dùng : ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB RAM`);

        // 4. Gọi sang Python FastAPI Engine thực sự
        console.log(`\n[DEBUG - AI FORWARDING] Đang gửi yêu cầu sang Python Engine tại http://127.0.0.1:8000/generate...`);
        
        try {
            // Sử dụng fetch API có sẵn trong Node.js > 18
            const aiResponse = await fetch('http://127.0.0.1:8000/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    teacher_id: teacher_id,
                    style_id: style_id || 'normal'
                })
            });
            
            if (!aiResponse.ok) {
                const errorData = await aiResponse.json();
                throw new Error(errorData.detail || 'Lỗi từ AI Engine');
            }
            
            const aiResult = await aiResponse.json();
            console.log(`[DEBUG - AI RESPONSE] AI đã xử lý xong và trả về kết quả!`);

            // 5. Lưu lịch sử nếu người dùng đã đăng nhập (lỗi lưu không ảnh hưởng kết quả)
            if (req.user) {
                GeneratedLecture.create({
                    user_id: req.user._id,
                    text: text,
                    teacher_id: teacher_id || '',
                    style_id: style_id || 'normal',
                    audio_url: aiResult.audio_url
                }).catch(err => console.error(`[DEBUG - HISTORY] Không lưu được lịch sử:`, err.message));
            }

            // 6. Trả kết quả về cho Vue
            const totalTime = (Date.now() - startTime) / 1000;
            console.log(`\n[DEBUG - API COMPLETION] Trả response HTTP 200 về cho Client Vue.js.`);
            console.log(`[DEBUG - PERFORMANCE] Tổng thời gian phản hồi: ${totalTime.toFixed(3)} giây`);
            console.log("=".repeat(100) + "\n");

            res.json({
                status: "success",
                message: "Đã tạo bài giảng thành công!",
                audio_url: aiResult.audio_url // Lấy URL trả về từ Python
            });
            
        } catch (aiError) {
            console.error(`[DEBUG - AI ERROR] Không thể gọi tới Python Engine. Có thể Python chưa chạy hoặc lỗi nội bộ:`, aiError.message);
            return res.status(500).json({ error: `Lỗi AI Engine: ${aiError.message}` });
        }

    } catch (error) {
        console.log(`\n[CRITICAL ERROR - BACKEND] CÓ LỖI XẢY RA TRONG LUỒNG XỬ LÝ!`);
        console.log(`[CRITICAL ERROR - TRACE] ${error.message}`);
        console.log(`[CRITICAL ERROR - STACK]`, error.stack);
        console.log("=".repeat(100) + "\n");
        res.status(500).json({ error: "Lỗi máy chủ nội bộ." });
    }
});

const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();
const Voice = require('./app/models/voice.model');

const READING_STYLES = "story (chậm rãi, truyền cảm - phù hợp tiểu thuyết, kỹ năng sống), news (nhanh, dứt khoát - phù hợp chuyên môn, bản tin), normal (bình thường)";

// Gọi Gemini với thử lại + tự động đổi mô hình khi gặp lỗi tạm thời (503 quá tải, 429 rate limit...)
async function generateWithRetry(prompt) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelNames = [
        process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
        'gemini-3.5-flash-lite',  // Nhanh nhe nhat, it qua tai
        'gemini-3.8-flash',        // Fallback 1
        'gemini-3.5-flash',        // Fallback 2
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    let lastError;
    for (const modelName of modelNames) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const llmResponse = await model.generateContent(prompt);
                console.log(`[LLM] Da dung mo hinh: ${modelName} (lan ${attempt})`);
                return llmResponse.response.text();
            } catch (err) {
                lastError = err;
                const is404 = err.message?.includes('404') || err.message?.includes('no longer available');
                console.warn(`[LLM] Loi voi mo hinh ${modelName} (lan ${attempt}): ${err.message?.substring(0, 100)}`);
                if (is404) break;
                if (attempt < 3) {
                    const waitMs = attempt * 5000;
                    console.log(`[LLM] Cho ${waitMs/1000}s roi thu lai...`);
                    await new Promise(r => setTimeout(r, waitMs));
                }
            }
        }
    }
    throw lastError;
}

// Luồng Sách Nói AI — Bước 1: Gemini tóm tắt sách và chọn giọng đọc phù hợp
// (Bước 2 sinh audio do frontend gọi tiếp /api/generate-lecture với giọng đã chọn)
app.post('/api/summarize-book', optionalAuth, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ error: "Nội dung sách trống!" });
        }

        // 1. Danh sách giọng khả dụng: giọng global + giọng riêng của user (nếu đã đăng nhập)
        const voiceQuery = { is_active: true };
        if (req.user) {
            voiceQuery.$or = [{ is_global: true }, { user_id: req.user._id }];
        } else {
            voiceQuery.is_global = true;
        }
        const availableVoices = await Voice.find(voiceQuery).select('voice_id name gender');
        if (availableVoices.length === 0) {
            return res.status(400).json({ error: "Hệ thống chưa có giọng đọc mẫu nào. Vui lòng thêm giọng mẫu trước!" });
        }

        // 2. Gọi Gemini: tóm tắt + chọn giọng trong danh sách + chọn phong cách + giải thích
        console.log(`\n[LLM] Bắt đầu gọi Gemini API để tóm tắt & chọn giọng (${availableVoices.length} giọng khả dụng)...`);

        const voiceList = availableVoices
            .map(v => `- voice_id: "${v.voice_id}" | tên: ${v.name} | giới tính: ${v.gender === 'male' ? 'nam' : 'nữ'}`)
            .join('\n');

        const prompt = `Bạn là một biên tập viên làm sách nói chuyên nghiệp.
Hãy đọc nội dung sách sau đây và thực hiện các việc:
1. Tóm tắt nội dung sách một cách lôi cuốn, truyền cảm hứng nhất để làm kịch bản sách nói (khoảng 2-3 đoạn ngắn, không quá 300 chữ). ĐẶC BIỆT LƯU Ý: Phải viết các câu văn ngắn gọn, ngắt nghỉ rõ ràng bằng dấu phẩy (,) hoặc dấu chấm (.), tuyệt đối không viết câu quá dài để AI đọc không bị hụt hơi.
2. Xác định thể loại chính của sách (ví dụ: kỹ năng sống, kinh doanh, thiếu nhi, tiểu thuyết, lịch sử...).
3. Chọn MỘT giọng đọc PHÙ HỢP NHẤT với nội dung, chỉ được chọn voice_id có trong "DANH SÁCH GIỌNG ĐỌC" bên dưới.
4. Chọn phong cách đọc phù hợp trong: ${READING_STYLES}.
5. Giải thích ngắn gọn (1-2 câu) lý do chọn giọng và phong cách đó.

Định dạng trả về BẮT BUỘC phải là JSON hợp lệ với cấu trúc sau:
{
    "summary": "Nội dung tóm tắt...",
    "genre": "Thể loại sách",
    "voice_id": "một voice_id trong danh sách",
    "style": "story hoặc news hoặc normal",
    "reason": "Lý do chọn giọng..."
}

DANH SÁCH GIỌNG ĐỌC:
${voiceList}

Nội dung sách:
${text}`;

        let llmText = await generateWithRetry(prompt);

        // Dọn dẹp kết quả trả về để parse JSON
        llmText = llmText.replace(/```json/g, '').replace(/```/g, '').trim();
        const aiResult = JSON.parse(llmText);

        // 3. Kiểm tra giọng Gemini chọn có tồn tại không, nếu không thì lấy giọng đầu tiên
        let chosenVoice = availableVoices.find(v => v.voice_id === aiResult.voice_id);
        if (!chosenVoice) {
            console.warn(`[LLM] Gemini chọn giọng không hợp lệ (${aiResult.voice_id}), dùng giọng mặc định đầu tiên.`);
            chosenVoice = availableVoices[0];
        }
        const style = ['story', 'news', 'normal'].includes(aiResult.style) ? aiResult.style : 'story';

        console.log(`[LLM] Gemini đã tóm tắt xong! Thể loại: ${aiResult.genre} | Giọng chọn: ${chosenVoice.voice_id} | Style: ${style}`);

        res.json({
            status: "success",
            summary: aiResult.summary,
            genre: aiResult.genre || 'Không rõ',
            voice: {
                voice_id: chosenVoice.voice_id,
                name: chosenVoice.name,
                gender: chosenVoice.gender
            },
            style: style,
            reason: aiResult.reason || ''
        });

    } catch (error) {
        console.error("[ERROR] Lỗi trong quá trình tóm tắt sách:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[DEBUG - SERVER START] Backend Node.js đang chạy tại: http://localhost:${PORT}`);
});