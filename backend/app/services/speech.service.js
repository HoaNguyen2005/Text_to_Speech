const crypto = require('crypto');
const expressions = require('./speech_expressions');
const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'SPEECH_VALIDATION' }); };
const profiles = {
    natural: { rate: 0, paragraph: 400, section: 650 },
    teaching: { rate: -4, paragraph: 600, section: 850 },
    story: { rate: -5, paragraph: 550, section: 800 },
    news: { rate: 8, paragraph: 250, section: 450 },
    relaxing: { rate: -10, paragraph: 750, section: 1000 },
};
const validProfile = value => value === 'auto' || Object.hasOwn(profiles, value);
function options(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Cấu hình đọc không hợp lệ.');
    const profile = value.profile ?? 'auto';
    if (!validProfile(profile) || (value.normalize != null && typeof value.normalize !== 'boolean')) fail('Cấu hình đọc không hợp lệ.');
    if (value.rate_percent != null && (!Number.isInteger(value.rate_percent) || value.rate_percent < -25 || value.rate_percent > 50)) fail('Tốc độ đọc phải từ 0,75x đến 1,50x.');
    if (value.experimental_cues != null && typeof value.experimental_cues !== 'boolean') fail('Tùy chọn biểu cảm không hợp lệ.');
    const dictionary = value.dictionary ?? [];
    if (!Array.isArray(dictionary) || dictionary.length > 50) fail('Từ điển phát âm chỉ nhận tối đa 50 mục.');
    const seen = new Set();
    const cleaned = dictionary.map(item => {
        if (!item || typeof item.word !== 'string' || typeof item.spoken !== 'string') fail('Mục từ điển phát âm không hợp lệ.');
        const word = item.word.normalize('NFC').trim(), spoken = item.spoken.normalize('NFC').trim();
        if (!word || word.length > 80 || !spoken || spoken.length > 200 || /[\r\n<>\[\]\u0000-\u001f]/u.test(word + spoken)) fail('Mục từ điển phát âm không hợp lệ.');
        const key = word.toLocaleLowerCase('vi');
        if (seen.has(key)) fail('Từ điển phát âm có mục trùng nhau.');
        seen.add(key); return { word, spoken };
    });
    // Missing rate keeps the old preset rates and hashes for existing jobs.
    return { version: 'speech-v1', profile, normalize: value.normalize === true, dictionary: cleaned,
        ...(value.rate_percent != null ? { rate_percent: value.rate_percent } : {}),
        ...(value.experimental_cues === true ? { experimental_cues:true } : {}) };
}
function assertProvider(config, provider) {
    if (config?.experimental_cues && provider !== 'vieneu') fail('Biểu cảm thử nghiệm chỉ dùng cho VieNeu.');
}
function delivery(value = {}, paragraphs = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Phong cách từng đoạn không hợp lệ.');
    const profile = value.profile ?? 'auto', paragraph_profiles = value.paragraph_profiles ?? [];
    if (!validProfile(profile) || !Array.isArray(paragraph_profiles) || paragraph_profiles.length > Math.max(paragraphs, 1)
        || paragraph_profiles.some(item => !validProfile(item))) fail('Phong cách từng đoạn không hợp lệ.');
    return { profile, paragraph_profiles };
}
const pausePattern = () => /\[(?:nghỉ|pause)\s+(\d+(?:[.,]\d+)?)\s*(?:s|giây)\s*\]|<break\s+time=["'](\d+(?:\.\d+)?)s["']\s*\/>/giu;
function parse(markup, experimental = false) {
    if (typeof markup !== 'string' || markup.length > 300000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(markup)) fail('Văn bản đọc không hợp lệ.');
    markup = expressions.canonical(markup.normalize('NFC').replace(/\r\n/g, '\n'));
    const rendered = experimental ? markup : markup.replace(expressions.pattern(), ' ');
    const atoms = []; let start = 0, totalPause = 0, markers = 0;
    for (const match of rendered.matchAll(pausePattern())) {
        const milliseconds = Math.round(Number((match[1] || match[2]).replace(',', '.')) * 1000);
        if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2000) fail('Mỗi khoảng nghỉ phải từ 0 đến 2 giây.');
        if (++markers > 200 || (totalPause += milliseconds) > 300000) fail('Có quá nhiều khoảng nghỉ. Hãy rút gọn chỉ dẫn đọc.');
        const before = rendered[match.index - 1] || '', after = rendered[match.index + match[0].length] || '';
        if (/[\p{L}\p{M}]/u.test(before) && /[\p{L}\p{M}]/u.test(after)) fail('Hãy chèn khoảng nghỉ giữa các từ hoặc sau dấu câu.');
        atoms.push({ text: rendered.slice(start, match.index), pause_ms: milliseconds, explicit: true });
        start = match.index + match[0].length;
    }
    atoms.push({ text: rendered.slice(start), pause_ms: 0, explicit: false });
    const stripped = markup.replace(pausePattern(), ' ');
    if (/\[(?:nghỉ|pause)(?=\s|\])|<\/?(?:break|prosody|voice|speak)\b/iu.test(stripped)) fail('Chỉ dẫn nghỉ không hợp lệ. Dùng [nghỉ 0.5s] hoặc <break time="0.5s" />.');
    if (/\[(?:laugh|sigh|throat|whisper|thì thầm|chuckle|clear throat|khóc)\]|<\|emotion_/iu.test(stripped)) fail('Chỉ hỗ trợ các thẻ [cười], [thở dài], [hắng giọng].');
    const plain = expressions.strip(stripped);
    return { markup, plain, atoms, totalPause };
}
const digits = ['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín'];
function triple(number, full) {
    const hundred = Math.floor(number / 100), ten = Math.floor(number % 100 / 10), one = number % 10, words = [];
    if (hundred || full) words.push(digits[hundred], 'trăm');
    if (ten > 1) words.push(digits[ten], 'mươi'); else if (ten === 1) words.push('mười'); else if ((hundred || full) && one) words.push('lẻ');
    if (one) words.push(one === 1 && ten > 1 ? 'mốt' : one === 5 && ten > 0 ? 'lăm' : one === 4 && ten > 1 ? 'tư' : digits[one]);
    return words.join(' ');
}
function integer(raw) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0 || raw.length > 15) return raw;
    if (/^0\d/.test(raw)) return [...raw].map(d => digits[Number(d)]).join(' ');
    if (!value) return digits[0];
    const groups = []; let remaining = value;
    while (remaining) { groups.push(remaining % 1000); remaining = Math.floor(remaining / 1000); }
    const suffixes = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ'];
    return groups.map((_, i) => groups.length - 1 - i).filter(i => groups[i]).map(i => `${triple(groups[i], i < groups.length - 1)} ${suffixes[i]}`).join(' ').replace(/\s+/g, ' ').trim();
}
function numeric(raw) {
    // Vietnamese grouping (1.234,5) and simple decimal notation (1.5).
    let value = raw;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(raw)) value = raw.replace(/\./g, '');
    else if (/^\d{1,3}(?:,\d{3})+$/.test(raw)) value = raw.replace(/,/g, '');
    else if ((raw.match(/[.,]/g) || []).length > 1) return raw;
    const [whole, fraction] = value.split(/[.,]/);
    const spoken = integer(whole);
    return fraction ? `${spoken} phẩy ${[...fraction].map(d => digits[Number(d)]).join(' ')}` : spoken;
}
const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function speak(text, config) {
    let spoken = text;
    if (config.dictionary.length) {
        const words = [...config.dictionary].sort((a,b) => b.word.length-a.word.length);
        const dictionary = new Map(words.map(item => [item.word.toLocaleLowerCase('vi'), item.spoken]));
        spoken = spoken.replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${words.map(item => escape(item.word)).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'giu'), word => dictionary.get(word.toLocaleLowerCase('vi')));
    }
    if (!config.normalize) return spoken;
    const protectedValues = new Map();
    // Preserve URLs/email, invalid dates and numeric strings with several separators.
    const protect = value => {
        let index=protectedValues.size, token='';
        do { token=String.fromCharCode(65+index%26)+token; index=Math.floor(index/26)-1; } while(index>=0);
        protectedValues.set(token,value); return `\uE000${token}\uE001`;
    };
    spoken = spoken.replace(/\uE000[A-Z]+\uE001/gu, protect);
    spoken = spoken.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, protect);
    spoken = spoken.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/gu, (raw,d,m,y) => {
        const date = new Date(Date.UTC(Number(y), Number(m)-1, Number(d)));
        if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m)-1 || date.getUTCDate() !== Number(d)) return protect(raw);
        return `ngày ${integer(d.replace(/^0/, '') || '0')} tháng ${integer(m.replace(/^0/, '') || '0')} năm ${integer(y)}`;
    });
    const unitNames = { kg: 'ki lô gam', km: 'ki lô mét', cm: 'xen ti mét', mm: 'mi li mét', ml: 'mi li lít', '%': 'phần trăm', '₫': 'đồng', 'đ': 'đồng' };
    spoken = spoken.replace(/(?<![\p{L}\p{N}.,/])(\d+(?:[.,]\d+)*)(\s*)(kg|km|cm|mm|ml|%|₫|đ)(?![\p{L}\p{N}])/giu, (raw,n,space,unit) => {
        const number = numeric(n); return number === n ? protect(raw) : `${number} ${unitNames[unit.toLowerCase()]}`;
    });
    spoken = spoken.replace(/(?<![\p{L}\p{N}.,/])\d{1,15}(?:[.,]\d+)*(?![\p{L}\p{N}.,/])/gu, numeric);
    return spoken.replace(/\uE000([A-Z]+)\uE001/gu, (original, token) => protectedValues.get(token) ?? original);
}
function split(text) {
    const result = []; let remaining = text.trim();
    while (remaining.length > 1200) {
        const head = remaining.slice(0,1200);
        let cut = Math.max(head.lastIndexOf('. '),head.lastIndexOf('? '),head.lastIndexOf('! '));
        if (cut < 300) cut = head.lastIndexOf(' ');
        cut = cut < 1 ? 1200 : cut+1;
        const opening = remaining.lastIndexOf('[',cut-1), closing = remaining.indexOf(']',opening);
        if (opening>=0 && closing>=cut && expressions.count(remaining.slice(opening,closing+1))) cut=opening || closing+1;
        result.push(remaining.slice(0,cut).trim()); remaining = remaining.slice(cut).trim();
    }
    if (remaining) result.push(remaining); return result;
}
function plan({ introduction = '', sections, speech = {}, style = 'normal', units_per_minute = 300, provider }) {
    if (!Number.isFinite(units_per_minute) || units_per_minute < 80 || units_per_minute > 600) fail('Tốc độ giọng đọc đo được không hợp lệ.');
    const config = options(speech);
    if (provider !== undefined) assertProvider(config,provider);
    if (typeof introduction !== 'string' || introduction.length>2000 || !Array.isArray(sections) || !sections.length || sections.length > 100
        || sections.some(section=>!section || typeof section.text!=='string')) fail('Các đoạn đọc không hợp lệ.');
    const parts = [], changes = [], cleaned = [];
    const add = (markup, profile, defaultPause, index) => {
        const rate = config.rate_percent ?? profile.rate;
        const parsed = parse(markup,config.experimental_cues);
        parsed.atoms.forEach((atom, position) => {
            const source = atom.text.trim(), spoken = config.experimental_cues ? expressions.spoken(source,part=>speak(part,config)) : speak(source, config);
            if (source !== spoken && changes.length < 100) changes.push({ section: index, before: source, after: spoken });
            const chunks = split(spoken);
            const last = position === parsed.atoms.length-1;
            const pause = atom.explicit ? atom.pause_ms : last && source ? defaultPause : 0;
            if (!chunks.length) {
                if (pause) parts.push({ text: '', rate_percent: rate, pitch_hz: 0, pause_ms: pause, speech_version: 'speech-v1' });
            } else chunks.forEach((text,i) => parts.push({ text, rate_percent: rate, pitch_hz: 0, pause_ms: i===chunks.length-1 ? pause : 100, speech_version: 'speech-v1',
                ...(config.experimental_cues && expressions.count(text) ? {experimental_cues:true} : {}) }));
        });
        return parsed.plain;
    };
    const fallback = style === 'news' ? 'news' : style === 'story' ? 'story' : 'natural';
    const globalProfile = config.profile === 'auto' ? fallback : config.profile;
    if (introduction.trim()) add(introduction, profiles[globalProfile], 650, -1);
    sections.forEach((section,index) => {
        const markup = section.delivery?.markup ?? section.text;
        if(typeof markup!=='string')fail('Văn bản đọc không hợp lệ.');
        const paragraphs = markup.split(/\n\s*\n/u).filter(text => text.trim());
        const preferences = delivery(section.delivery, paragraphs.length);
        const sectionProfile = preferences.profile === 'auto' ? globalProfile : preferences.profile;
        const plain = [];
        paragraphs.forEach((paragraph,i) => {
            const choice = preferences.paragraph_profiles[i] || 'auto';
            const profile = profiles[choice === 'auto' ? sectionProfile : choice];
            plain.push(add(paragraph, profile, i===paragraphs.length-1 ? profile.section : profile.paragraph, index));
        });
        cleaned.push({ ...section, text: plain.join('\n\n'), delivery: { ...preferences, markup } });
    });
    if (!parts.some(part => part.text) || parts.length > 300 || cleaned.reduce((sum,section)=>sum+section.text.length,0)>250000) fail('Nội dung quá dài hoặc có quá nhiều đoạn/khoảng nghỉ.');
    const cueCount=parts.reduce((sum,part)=>sum+expressions.count(part.text),0);
    if (cueCount>20) fail('Mỗi bản đọc chỉ nhận tối đa 20 thẻ biểu cảm thử nghiệm.');
    const estimated_seconds = Math.round(parts.reduce((sum,part) => sum + (expressions.strip(part.text).split(/\s+/u).filter(Boolean).length * 60 / (units_per_minute*(1+part.rate_percent/100))) + part.pause_ms/1000 + expressions.count(part.text),0));
    const hash = crypto.createHash('sha256').update(JSON.stringify(['speech-v1',parts,config])).digest('hex');
    return { hash, speech: config, sections: cleaned, parts, changes, estimated_seconds,
        spoken_text: parts.map(part=>part.text + (part.pause_ms ? ` [nghỉ ${part.pause_ms/1000}s]` : '')).join('\n') };
}
function subtitles(parts, timings) {
    const stamp = seconds => { const ms=Math.max(0,Math.round(seconds*1000)); return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`; };
    let elapsed=0; const cues=[];
    parts.forEach((part,index) => {
        const timing=timings[index], total=Number(timing?.duration_seconds);
        if (!Number.isFinite(total) || total<=0) throw new Error('Không đủ thời lượng để tạo phụ đề.');
        const speechDuration=Math.max(0,Math.min(total,Number(timing.speech_duration_seconds ?? Math.max(0,total-part.pause_ms/1000))));
        const words=expressions.strip(part.text).split(/\s+/u).filter(Boolean), lines=[]; let line='';
        for (const word of words) { if (line && line.length+word.length+1>42) { lines.push(line); line=''; } line+=(line?' ':'')+word; }
        if (line) lines.push(line);
        const blocks=[]; for(let i=0;i<lines.length;i+=2) blocks.push(lines.slice(i,i+2).join('\n'));
        const weights=blocks.map(block=>block.replace(/\s/gu,'').length), weight=weights.reduce((a,b)=>a+b,0); let used=0;
        blocks.forEach((block,i)=>{ const start=elapsed+speechDuration*used/weight;used+=weights[i];const end=elapsed+speechDuration*used/weight;if(end>start)cues.push(`${cues.length+1}\n${stamp(start)} --> ${stamp(end)}\n${block}`); });
        elapsed+=total;
    });
    return cues.join('\n\n')+'\n';
}
module.exports = { options, delivery, parse, plan, subtitles, assertProvider, clipText:expressions.clip };
