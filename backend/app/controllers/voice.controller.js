const Voice = require('../models/voice.model');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const storage = require('../services/storage.service');
const access = require('../services/voice_access');
const {isValidId}=require('../db/postgres');

// Lấy danh sách giọng mẫu
// - Chưa đăng nhập (req.user = null): chỉ thấy giọng global
// - Đã đăng nhập là user: thấy giọng global + giọng riêng của mình
// - Đã đăng nhập là admin: thấy tất cả
exports.getAllVoices = async (req, res) => {
    try {
        const query={is_active:true,...access.filter(req.user)};
        const voices = await Voice.find(query).sort({ createdAt: -1 });
        res.json(voices.map(voice=>access.present(voice,req.user)));
    } catch (error) {
        res.status(500).json({ error: "Lỗi khi tải danh sách giọng mẫu" });
    }
};

// Thêm giọng mẫu mới
exports.createVoice = async (req, res) => {
    let pendingFile;
    let saved = false;
    try {
        const input = req.body || {};
        const voice_id = typeof input.voice_id === 'string' ? input.voice_id.trim() : '';
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        const gender = input.gender === undefined ? 'male' : input.gender;
        const voiceClass=req.user.role==='admin'?(input.class||'free'):'free';
        const description=typeof input.description==='string'?input.description.trim():'';
        if(!['free','gold','diamond'].includes(voiceClass) || description.length>500 || (input.class && req.user.role!=='admin' && input.class!=='free'))return res.status(400).json({error:'Phân hạng hoặc mô tả giọng không hợp lệ.'});

        if (!voice_id || !name || !req.file) {
            return res.status(400).json({ error: "Vui lòng nhập đủ thông tin và upload file âm thanh" });
        }
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(voice_id)) {
            return res.status(400).json({ error: "Mã giọng chỉ được chứa chữ, số, dấu gạch ngang và gạch dưới" });
        }
        if (name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name) || !['male', 'female'].includes(gender)) {
            return res.status(400).json({ error: 'Tên giọng tối đa 200 ký tự; giới tính giọng phải là Nam hoặc Nữ.' });
        }
        // Include hidden voices: their codes remain reserved by the UNIQUE constraint.
        if (await Voice.exists({ voice_id })) {
            return res.status(409).json({ error: 'Mã giọng này đã được sử dụng, kể cả giọng đã ẩn. Hãy chọn mã khác, ví dụ male_hn_2.' });
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const contentTypes = {
            '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
            '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.webm': 'audio/webm'
        };
        if (!contentTypes[ext]) return res.status(400).json({ error: 'Định dạng audio không được hỗ trợ.' });
        const fileName = `${voice_id}.${crypto.randomUUID()}${ext}`;
        let file_path;

        if (storage.isR2Enabled()) {
            file_path = `samples/${fileName}`;
            pendingFile = { key: file_path };
            await storage.uploadBuffer(req.file.buffer, file_path, contentTypes[ext]);
        } else {
            // Chế độ local (dev chưa cấu hình R2): ghi ra đĩa như cũ
            const localDir = path.join(__dirname, '../../public/audio/samples');
            fs.mkdirSync(localDir, { recursive: true });
            file_path = `public/audio/samples/${fileName}`;
            pendingFile = { localPath: path.join(localDir, fileName), key: file_path };
            fs.writeFileSync(pendingFile.localPath, req.file.buffer, { flag: 'wx' });
        }

        const newVoice = new Voice({
            voice_id,
            name,
            gender,
            class:voiceClass,description,
            file_path,
            user_id: req.user._id,
            is_global: req.user.role === 'admin'
        });
        await newVoice.save();
        saved = true;
        
        res.status(201).json({ message: "Thêm giọng mẫu thành công", data: access.present(newVoice,req.user) });
    } catch (error) {
        if (error.code === 'EEXIST' && pendingFile?.localPath) pendingFile = undefined;
        if (pendingFile && !saved) {
            try {
                // A lost DB response may follow a successful INSERT. Keep any referenced file.
                if (!await Voice.exists({ file_path: pendingFile.key })) {
                    if (pendingFile.localPath) await fs.promises.rm(pendingFile.localPath, { force: true });
                    else await storage.deleteVoiceSample(pendingFile.key);
                }
            } catch (cleanupError) {
                // If DB/storage is unavailable, preserve the file for reconciliation.
                console.warn('[VOICE UPLOAD] Chưa dọn được file của yêu cầu lỗi:', cleanupError.code || cleanupError.name);
            }
        }
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Mã giọng này đã được sử dụng. Hãy chọn mã khác rồi lưu lại.' });
        }
        console.error('[VOICE UPLOAD]', error.code || error.name);
        res.status(500).json({ error: 'Không thể lưu giọng mẫu vào thư viện. Vui lòng thử lại.' });
    }
};

// Cập nhật giọng mẫu (Sửa)
exports.updateVoice = async (req, res) => {
    try {
        const { id } = req.params;
        const allowedFields = new Set(['name', 'gender', 'is_active','description','class']);
        const updates = req.body || {};

        if (!Object.keys(updates).length || Object.keys(updates).some((key) => !allowedFields.has(key))) {
            return res.status(400).json({ error: 'Chỉ được cập nhật tên, giới tính hoặc trạng thái giọng' });
        }
        if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.trim().length>200 || /[\u0000-\u001f\u007f]/u.test(updates.name))) {
            return res.status(400).json({ error: 'Tên giọng không hợp lệ' });
        }
        if (updates.gender !== undefined && !['male', 'female'].includes(updates.gender)) {
            return res.status(400).json({ error: 'Giới tính không hợp lệ' });
        }
        if (updates.is_active !== undefined && typeof updates.is_active !== 'boolean') {
            return res.status(400).json({ error: 'Trạng thái giọng không hợp lệ' });
        }
        if(updates.description!==undefined && (typeof updates.description!=='string'||updates.description.trim().length>500))return res.status(400).json({error:'Mô tả giọng tối đa 500 ký tự.'});
        if(updates.class!==undefined && (req.user.role!=='admin'||!['free','gold','diamond'].includes(updates.class)))return res.status(400).json({error:'Bạn không có quyền thay đổi phân hạng giọng.'});
        if(!isValidId(id))return res.status(404).json({error:'Không tìm thấy giọng mẫu'});

        const voice = await Voice.findById(id);
        if (!voice) {
            return res.status(404).json({ error: "Không tìm thấy giọng mẫu" });
        }
        if (!access.editable(voice,req.user)) {
            return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa giọng này' });
        }

        if (updates.name !== undefined) voice.name = updates.name.trim();
        if (updates.gender !== undefined) voice.gender = updates.gender;
        if (updates.is_active !== undefined) voice.is_active = updates.is_active;
        if(updates.description!==undefined)voice.description=updates.description.trim();
        if(updates.class!==undefined)voice.class=updates.class;
        await voice.save();

        res.json({ message: "Cập nhật thành công", data: access.present(voice,req.user) });
    } catch (error) {
        console.error('[ERROR] Cập nhật giọng mẫu:', error.message);
        res.status(500).json({ error: "Lỗi khi cập nhật giọng mẫu" });
    }
};

// Xóa giọng mẫu (Ẩn đi chứ không xóa data cứng - Soft Delete)
exports.deleteVoice = async (req, res) => {
    try {
        const { id } = req.params;
        if(!isValidId(id))return res.status(404).json({error:'Không tìm thấy giọng mẫu'});
        
        const voice = await Voice.findById(id);
        if (!voice) {
            return res.status(404).json({ error: "Không tìm thấy giọng mẫu" });
        }
        if (!access.editable(voice,req.user)) {
            return res.status(403).json({ error: 'Bạn không có quyền xóa giọng này' });
        }

        voice.is_active = false;
        await voice.save();

        res.json({ message: "Đã xóa giọng mẫu thành công" });
    } catch (error) {
        console.error('[ERROR] Xóa giọng mẫu:', error.message);
        res.status(500).json({ error: "Lỗi khi xóa giọng mẫu" });
    }
};

exports.preview=async(req,res)=>{
    try {
        if(!isValidId(req.params.id))return res.status(404).json({error:'Không tìm thấy giọng mẫu'});
        const voice=await Voice.findOne({_id:req.params.id,is_active:true});
        if(!access.visible(voice,req.user))return res.status(404).json({error:'Không tìm thấy giọng mẫu'});
        res.setHeader('Cache-Control','private, no-store');
        if(storage.isStorageKey(voice.file_path)) {
            const response=await fetch(await storage.resolveUrl(voice.file_path),{signal:AbortSignal.timeout(120000)});
            if(!response.ok)return res.status(response.status===404?404:503).json({error:response.status===404?'Không tìm thấy file giọng mẫu.':'Không tải được giọng nghe mẫu. Hãy thử lại.'});
            if(Number(response.headers.get('content-length'))>50*1024*1024)return res.status(413).json({error:'File giọng mẫu vượt 50 MB.'});
            res.type(response.headers.get('content-type')||'audio/mpeg');
            const {Readable,Transform}=require('stream');let bytes=0;
            await require('stream/promises').pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>50*1024*1024?new Error('Voice sample too large'):null,chunk);}}),res);
            return;
        }
        const directory=path.resolve(__dirname,'../../public/audio/samples'),file=path.resolve(directory,path.basename(voice.file_path));
        if(path.dirname(file)!==directory || !fs.existsSync(file))return res.status(404).json({error:'Không tìm thấy file giọng mẫu.'});
        res.sendFile(file);
    }catch(error){if(!res.headersSent&&!res.destroyed)res.status(503).json({error:'Không tải được giọng nghe mẫu. Hãy thử lại.'});else res.destroy();}
};
