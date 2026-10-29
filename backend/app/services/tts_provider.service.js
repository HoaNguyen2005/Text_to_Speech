const revision = 'vieneu-3.8.3-v3turbo-61b85e3d937fbbacb387714180e8182823512523';
const defaultProvider = process.env.TTS_PROVIDER || 'edge';
function validate(value = defaultProvider) {
    if (!['edge','vieneu'].includes(value)) throw Object.assign(new Error('Engine giọng đọc không hợp lệ.'), {status:400});
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
module.exports = {validate,settings,voices,defaultProvider,revision};
