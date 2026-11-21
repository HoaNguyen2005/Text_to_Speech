const GeneratedLecture = require('../models/generated_lecture.model');
const Voice = require('../models/voice.model');
const { standardVoices } = require('../config/book');
const access = require('../services/voice_access');
const storage = require('../services/storage.service');
const {isValidId}=require('../db/postgres');
exports.getSubtitles=async(req,res)=>{
    try{
        const item=isValidId(req.params.id)?await GeneratedLecture.findOne({_id:req.params.id,user_id:req.user._id}):null;
        if(!item)return res.status(404).json({error:'Không tìm thấy bản âm thanh.'});
        await require('../services/subtitle_download.service')(res,item.subtitle_url);
    }catch(error){res.status(error.status||503).json({error:error.status?error.message:'Chưa tải được phụ đề. Hãy thử lại.'});}
};

// Lấy lịch sử sinh audio của người dùng hiện tại (mới nhất lên đầu)
exports.getHistory = async (req, res) => {
    try {
        const items = await GeneratedLecture.find({ user_id: req.user._id })
            .sort({ createdAt: -1 })
            .limit(100)
            .select('text teacher_id style_id audio_url subtitle_url subtitle_timing speech_config createdAt title book_job_id target_minutes duration_seconds voice_mode book_metadata ai_assisted');

        const modeOf = item => item.voice_mode || item.speech_config?.voice_mode;
        const ids = [...new Set(items
            .filter(item => item.teacher_id && !item.speech_config?.voice_name && modeOf(item) !== 'standard')
            .map(item => item.teacher_id))];
        const voices = ids.length
            ? await Voice.find({ voice_id: { $in: ids }, ...access.filter(req.user) })
                .select('voice_id name class is_global').lean()
            : [];
        const samples = new Map(voices.map(voice => [voice.voice_id, voice]));

        // DB lưu key R2 (generated/xxx.wav) → sinh URL presigned mới mỗi lần đọc,
        // tránh link hết hạn. Giá trị URL http cũ (dữ liệu chưa migrate) giữ nguyên.
        const resolved = await Promise.all(items.map(async (item) => {
            const obj = item.toObject();
            const config = obj.speech_config;
            const mode = modeOf(obj);
            const savedVoice = config?.voice_name ? { name: config.voice_name, class: config.voice_class } : null;
            const sample = mode !== 'standard' ? samples.get(obj.teacher_id) : null;
            const preset = mode !== 'clone' ? standardVoices.find(voice => voice.voice_id === obj.teacher_id) : null;
            const sampleOrigin = sample?.is_global ? 'system' : 'user';
            const voice = savedVoice || (config?.voice_origin && config.voice_origin !== sampleOrigin ? null : sample) || preset;
            if (voice?.name) {
                obj.voice_name = voice.name;
                obj.voice_class = voice.class || 'free';
            }
            if (storage.isStorageKey(obj.audio_url)) {
                obj.audio_url = await storage.resolveUrl(obj.audio_url);
            }
            if (obj.subtitle_url) obj.subtitle_url = await storage.resolveUrl(obj.subtitle_url);
            return obj;
        }));

        res.json(resolved);
    } catch (error) {
        console.error('[ERROR] Lỗi khi tải lịch sử:', error.message);
        res.status(500).json({ error: "Lỗi khi tải lịch sử bài giảng" });
    }
};
