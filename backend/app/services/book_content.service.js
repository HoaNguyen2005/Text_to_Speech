const crypto = require('crypto');
const language = require('./book_language');
const speech = require('./speech.service');
const units = text => text.trim().split(/\s+/u).filter(Boolean).length;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const textHash = sections => hash(JSON.stringify(sections.map(section => section.text)));
const badRequest = message => Object.assign(new Error(message), { status: 400 });

function checkedText(text, limit = 14000) {
    if (typeof text !== 'string' || !text.trim() || text.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) {
        throw badRequest('Nội dung mỗi mục phải có từ 1 đến 14.000 ký tự hợp lệ.');
    }
    const normalized = language.normalize(text);
    if (language.missingDiacritics(normalized)) throw badRequest('Nội dung còn đoạn thiếu dấu tiếng Việt. Hãy viết đầy đủ dấu trước khi lưu.');
    return normalized;
}
function editedDraft(previous, texts, preferences) {
    if (!preferences && previous.speech) preferences = { speech: previous.speech, deliveries: previous.sections.map(section=>section.delivery||{}) };
    if (!Array.isArray(texts) || texts.length !== previous.sections.length) throw badRequest('Số mục không khớp bản tóm tắt. Hãy tải lại yêu cầu.');
    const planned = preferences ? speech.plan({ introduction: previous.introduction || '', style: previous.style,
        speech: preferences.speech, sections: previous.sections.map((section,i)=>({ ...section, text: texts[i], delivery: { ...(preferences.deliveries?.[i] || {}), markup: texts[i] } })) }) : null;
    const sections = previous.sections.map((section, i) => ({ ...section, ...(planned?.sections[i] || {}), text: checkedText(planned ? planned.sections[i].text : texts[i]) }));
    if (sections.reduce((sum, section) => sum + section.text.length, 0) > 250000) throw badRequest('Bản tóm tắt vượt 250.000 ký tự.');
    const textChanged = textHash(sections) !== textHash(previous.sections);
    const speechChanged = planned && JSON.stringify([planned.speech,sections.map(s=>s.delivery)]) !== JSON.stringify([previous.speech,previous.sections.map(s=>s.delivery)]);
    if (!textChanged && !speechChanged) return previous;
    return { ...previous, sections, ...(planned ? { speech: planned.speech } : {}),
        ...(textChanged ? { verified_hash: null, user_edited: true, verification_method:'pending', user_approval:null, verification_notes: [] } : {}), preview: null };
}
function estimate(draft) {
    if (draft.speech) return speech.plan({ introduction: draft.introduction || '', sections: draft.sections, style: draft.style, speech: draft.speech,
        units_per_minute: draft.reading_rate?.units_per_minute || 300 }).estimated_seconds;
    const rate = draft.units_per_minute || 300;
    const paragraphs = draft.sections.reduce((sum, section) => sum + section.text.split(/\n\s*\n/u).filter(Boolean).length, 0);
    return Math.round(units(draft.introduction || '') * 60 / rate
        + draft.sections.reduce((sum, section) => sum + units(section.text), 0) * 60 / rate + paragraphs * 0.45);
}

// Bounded retrieval: notes identify facts, original excerpts remain the evidence.
// Source IDs are internal provenance, never invented page numbers.
function evidence(section, chunks, notes, query = '', expanded = false) {
    const ids = [...new Set(section.source_ids)].filter(i => Number.isInteger(i) && i >= 0 && i < chunks.length);
    const words = new Set((`${section.title} ${section.focus} ${query}`.toLocaleLowerCase('vi').match(/[\p{L}\p{M}]{3,}/gu) || []));
    const score = text => (text.toLocaleLowerCase('vi').match(/[\p{L}\p{M}]{3,}/gu) || []).reduce((sum, word) => sum + (words.has(word) ? 1 : 0), 0);
    const ranked = ids.map(id => ({ id, score: score(notes[id] || '') })).sort((a, b) => b.score - a.score || a.id - b.id);
    const selected = ranked.slice(0, expanded ? 12 : 8).map(item => item.id).sort((a, b) => a - b);
    const noteBudget = Math.max(120, Math.floor(4500 / Math.max(1, selected.length)));
    const originalBudget = Math.floor((expanded ? 16000 : 11000) / Math.max(1, selected.length));
    return selected.map(id => {
        const blocks = chunks[id].match(/[^.!?\n]+[.!?]?/gu) || [chunks[id]];
        let remaining = originalBudget;
        const chosen = blocks.map((text, index) => ({ text, index, score: score(text) }))
            .sort((a, b) => b.score - a.score || a.index - b.index).filter(block => {
                if (remaining <= 0) return false;
                block.text = block.text.slice(0, remaining);
                remaining -= block.text.length;
                return Boolean(block.text.trim());
            }).sort((a, b) => a.index - b.index);
        return `[Phần ${id}] GHI CHÚ (cần đối chiếu với nguyên văn): ${(notes[id] || '').slice(0, noteBudget)}\nĐOẠN NGUỒN GỐC ĐƯỢC CHỌN:\n${chosen.map(block => block.text).join('\n')}`;
    }).join('\n\n');
}

// Moderate variation by paragraph/section; keep one selected speaker throughout.
function narration(intro, sections, style) {
    const parts = [];
    const split = text => {
        const result = [];
        let remaining = text.trim();
        while (remaining.length > 1200) {
            const head = remaining.slice(0, 1200);
            let cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
            if (cut < 300) cut = head.lastIndexOf(' ');
            if (cut < 1) cut = 1200; else cut++;
            result.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
        }
        if (remaining) result.push(remaining);
        return result;
    };
    const add = (text, rate, pause) => {
        const chunks = split(text);
        chunks.forEach((text, i) => parts.push({ text, rate_percent: rate, pitch_hz: 0, pause_ms: i === chunks.length - 1 ? pause : 100 }));
    };
    add(intro, -3, 650);
    const base = style === 'news' ? 5 : style === 'story' ? -5 : 0;
    sections.forEach((section, i) => {
        const paragraphs = section.text.split(/\n\s*\n/u).map(text => text.trim()).filter(Boolean);
        paragraphs.forEach((paragraph, j) => {
            const reflective = /^(Tuy nhiên|Nhưng|Dù vậy|Thay vì|Điều quan trọng|Điểm cốt lõi|Tóm lại|Vì vậy|Do đó)(?=\s|[,:;.!?]|$)/iu.test(paragraph);
            const question = /[?？]\s*$/u.test(paragraph);
            add(paragraph, Math.max(-10, Math.min(8, base + (i === sections.length - 1 || reflective ? -2 : question ? -1 : 0))),
                j === paragraphs.length - 1 ? 650 : question ? 550 : 400);
        });
    });
    if (parts.length > 300) throw new Error('Kịch bản có quá nhiều đoạn. Hãy rút gọn nội dung.');
    return parts;
}
module.exports = { units, hash, textHash, checkedText, editedDraft, estimate, evidence, narration };
