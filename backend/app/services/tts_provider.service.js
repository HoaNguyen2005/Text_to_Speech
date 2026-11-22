const db = require('../db/postgres');
const TtsProvider = require('../models/tts_provider.model');
const revision = 'vieneu-3.8.3-v3turbo-61b85e3d937fbbacb387714180e8182823512523';
const defaultProvider = process.env.TTS_PROVIDER || 'edge';
const problem = (message, status = 400, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

function validate(value = defaultProvider) {
    if (!['edge','vieneu'].includes(value)) throw Object.assign(new Error('Bản main chỉ hỗ trợ Edge-TTS + OpenVoice V2 và VieNeu-TTS. Hãy chọn lại bộ tạo giọng.'), {status:400});
    return value;
}
function settings(provider = 'edge', preset, savedRevision) {
    validate(provider);
    if (provider === 'vieneu' && savedRevision && savedRevision !== revision) throw new Error('Giọng VieNeu thuộc phiên bản khác. Hãy dùng đúng model đã lưu hoặc tạo yêu cầu mới.');
    return {provider, ...(provider === 'vieneu' ? {model_revision:revision, ...(preset ? {preset} : {})} : {})};
}
const voices = [
    {voice_id:'vieneu-hai-dang',name:'Hải Đăng',gender:'male',preset:'Hải Đăng'},
    {voice_id:'vieneu-truc-ly',name:'Trúc Ly',gender:'female',preset:'Trúc Ly'},
    {voice_id:'vieneu-thien-minh',name:'Thiện Minh · Kể chuyện',gender:'male',preset:'Thiện Minh'},
    {voice_id:'vieneu-mai-anh',name:'Mai Anh · Bản tin',gender:'female',preset:'Mai Anh'},
].map(voice=>({...voice,file_path:'',provider:'vieneu',model_revision:revision}));

const defaultRecords = [
    {
        _id: '00000000000000000000ed6e',
        provider_id: 'edge',
        name: 'Edge-TTS + OpenVoice',
        description: 'Tổng hợp giọng đọc tiếng Việt tốc độ cao kết hợp chuyển đổi âm sắc OpenVoice V2.',
        engine_label: 'Microsoft Neural + OpenVoice V2',
        model_revision: 'openvoice-v2',
        is_active: true,
        sort_order: 1,
    },
    {
        _id: '00000000000000000071e9e0',
        provider_id: 'vieneu',
        name: 'VieNeu-TTS',
        description: 'Mô hình tổng hợp và nhân bản giọng đọc tiếng Việt tự nhiên VieNeu v3 Turbo.',
        engine_label: 'VieNeu v3 Turbo',
        model_revision: revision,
        is_active: true,
        sort_order: 2,
    },
];

let providerState = structuredClone(defaultRecords);
let syncedAt = 0;
const CACHE_TTL_MS = 3000;

async function syncFromDb(force = false) {
    if (!db.isConnected()) return providerState;
    if (!force && syncedAt && Date.now() - syncedAt < CACHE_TTL_MS) return providerState;
    try {
        const rows = await TtsProvider.find({}).sort({ sort_order: 1 }).lean();
        if (Array.isArray(rows) && rows.length) {
            providerState = rows;
            syncedAt = Date.now();
        }
    } catch (error) {
        console.warn('[TTS PROVIDERS] Không thể đồng bộ từ DB:', error.code || error.message);
    }
    return providerState;
}

function decorate(item) {
    const { standardVoices } = require('../config/book');
    const standard_voice_count = standardVoices.filter((voice) => (voice.provider || 'edge') === item.provider_id).length;
    return {
        _id: item._id,
        provider_id: item.provider_id,
        name: item.name,
        description: item.description || '',
        engine_label: item.engine_label || '',
        model_revision: item.model_revision || '',
        is_active: Boolean(item.is_active),
        sort_order: Number(item.sort_order) || 0,
        standard_voice_count,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
}

async function list({ includeLocked = false, refresh = false } = {}) {
    await syncFromDb(refresh);
    const sorted = [...providerState].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const filtered = includeLocked ? sorted : sorted.filter((item) => item.is_active !== false);
    return filtered.map(decorate);
}

async function ensureActive(providerId) {
    const provider = validate(providerId);
    await syncFromDb();
    const record = providerState.find((item) => item.provider_id === provider);
    if (record && record.is_active === false) {
        throw problem('Bộ tạo giọng này đang tạm khóa bởi quản trị viên. Hãy chọn bộ tạo giọng khác.', 403, 'TTS_PROVIDER_LOCKED');
    }
    return provider;
}

async function updateStatus(idOrProviderId, { is_active, description } = {}) {
    if (typeof is_active !== 'boolean') {
        throw problem('Trạng thái bộ tạo giọng không hợp lệ.', 400);
    }
    if (description !== undefined && (typeof description !== 'string' || description.trim().length > 500)) {
        throw problem('Mô tả bộ tạo giọng tối đa 500 ký tự.', 400);
    }
    await syncFromDb(true);
    const existing = providerState.find(
        (item) => item._id === idOrProviderId || item.provider_id === idOrProviderId
    );
    if (!existing) {
        throw problem('Không tìm thấy bộ tạo giọng.', 404);
    }
    const patch = {
        is_active,
        ...(description !== undefined ? { description: description.trim() } : {}),
    };
    if (db.isConnected()) {
        const updated = await TtsProvider.findOneAndUpdate(
            { provider_id: existing.provider_id },
            { $set: patch },
            { returnDocument: 'after' }
        ).lean();
        if (updated) {
            providerState = providerState.map((item) => (item.provider_id === updated.provider_id ? updated : item));
            syncedAt = Date.now();
            return decorate(updated);
        }
    }
    const merged = { ...existing, ...patch, updatedAt: new Date() };
    providerState = providerState.map((item) => (item.provider_id === merged.provider_id ? merged : item));
    return decorate(merged);
}

module.exports = { validate, settings, voices, defaultProvider, revision, list, ensureActive, updateStatus };
