// Only these three SDK-supported cues are exposed by the experimental UI.
const pattern = () => /\[(cười|thở dài|hắng giọng)\]/giu;
const strip = text => text.replace(pattern(), ' ').replace(/[ \t]+/gu, ' ').replace(/ +([.,!?;:])/gu, '$1').trim();
const count = text => [...text.matchAll(pattern())].length;
function canonical(text) {
    for (const match of text.matchAll(pattern())) {
        const before = text[match.index-1] || '', after = text[match.index+match[0].length] || '';
        if (/[\p{L}\p{M}\p{N}]/u.test(before) || /[\p{L}\p{M}\p{N}]/u.test(after)) {
            throw Object.assign(new Error('Hãy chèn thẻ biểu cảm giữa các từ hoặc sau dấu câu.'), {status:400,code:'SPEECH_VALIDATION'});
        }
    }
    return text.replace(pattern(), (_, cue) => `[${cue.toLocaleLowerCase('vi')}]`);
}
function spoken(text, transform) {
    return text.split(/(\[(?:cười|thở dài|hắng giọng)\])/giu)
        .map(part => /^\[(?:cười|thở dài|hắng giọng)\]$/iu.test(part) ? part : transform(part)).join('');
}
function clip(text, limit) {
    if (!count(text)) return text.split(/\s+/u).filter(Boolean).slice(0,limit).join(' ');
    const tokens = text.match(/\[(?:cười|thở dài|hắng giọng)\]|\S+/giu) || [];
    const kept=[];let words=0;
    for (const token of tokens) {
        const cue=/^\[(?:cười|thở dài|hắng giọng)\]$/iu.test(token);
        if (!cue && words>=limit) break;
        kept.push(token);if(!cue)words++;
    }
    return kept.join(' ').replace(/ +([.,!?;:])/gu,'$1');
}
module.exports={pattern,strip,count,canonical,spoken,clip};
