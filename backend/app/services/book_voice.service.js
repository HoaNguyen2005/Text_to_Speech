const Voice = require('../models/voice.model');
const config = require('../config/book');
const providers = require('./tts_provider.service');
const access = require('./voice_access');
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const snapshot = ({ voice_id, name, gender, nation = 'vi', file_path, provider = 'edge', preset, origin, class:voiceClass='free' }) => ({
    voice_id, name, gender, nation, file_path, origin, class:voiceClass, ...providers.settings(provider, preset),
});

async function choices(user, requested) {
    const allProviders = await providers.list({ includeLocked: true });
    const activeProviders = allProviders.filter((item) => item.is_active !== false);
    const requestedId = requested === undefined ? (activeProviders[0]?.provider_id || providers.defaultProvider) : requested;
    const provider = providers.validate(requestedId);
    const isProviderActive = activeProviders.some((item) => item.provider_id === provider);
    if (!isProviderActive) {
        return { provider, provider_locked: true, providers: activeProviders, standard: [], clone: [], voices: [] };
    }
    const voices = await Voice.find({ is_active: true, ...access.filter(user) }).sort({ name: 1 }).lean();
    const standard = config.standardVoices
        .filter(voice => (voice.provider || 'edge') === provider)
        .map(({ voice_id, name, gender, nation = 'vi' }) => ({
            voice_id, name, gender, nation, class: 'free', required_class:'free', usable:true, provider, preset_voice: true,
            voice_mode: 'standard', origin: 'system', choice_id: `preset:${provider}:${voice_id}`,
        }));
    const clone = voices.map(voice => ({
        ...access.present(voice, user, provider),
        provider,
        voice_mode: 'clone',
        origin: voice.is_global ? 'system' : 'user',
        choice_id: `sample:${voice._id}`,
    }));
    // Keep the old groups for existing clients; the unified catalogue drives the UI.
    return { provider, provider_locked: false, providers: activeProviders, standard, clone, voices: [...standard, ...clone] };
}
async function resolve(mode, id, user, requested) {
    const provider = await providers.ensureActive(requested);
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw problem('Vui lòng chọn giọng đọc cụ thể trước khi tạo sách nói.');
    if (mode === 'standard') {
        const voice = config.standardVoices.find(entry => entry.voice_id === id && (entry.provider || 'edge') === provider);
        if (!voice) throw problem('Giọng tiêu chuẩn không hợp lệ. Hãy tải lại danh sách giọng.');
        return snapshot({ ...voice, origin: 'system' });
    }
    if (mode !== 'clone') throw problem('Loại giọng đọc không hợp lệ.');
    const voice = await Voice.findOne({ voice_id: id, is_active: true }).lean();
    if (!access.visible(voice, user)) {
        throw problem('Giọng mẫu không còn khả dụng hoặc bạn không có quyền sử dụng. Hãy tải lại danh sách và chọn giọng khác.', 403);
    }
    require('./account_tier.service').assertVoiceAccessAllowed(user,voice,provider,mode);
    return snapshot({ ...voice, class:voice.class, provider, origin: voice.is_global ? 'system' : 'user' });
}
module.exports = { choices, resolve };
