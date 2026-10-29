// Detect long Vietnamese passages that lost their diacritics, including a bad
// passage surrounded by correctly accented text. NFC alone cannot restore them.
const plainWords = new Set('va cua trong nhung khong nguoi duoc mot voi nhan cuoc song chinh nhieu cung nhu khi tung hanh trinh hien than cuong ban than thay doi rang ve su co'.split(' '));
const normalize = (text) => text.normalize('NFC').trim();

function diacriticsIssue(text) {
    const paragraphs = normalize(text).split(/\n+/u);
    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
        const paragraph = paragraphs[paragraphIndex];
        const words = paragraph.match(/[\p{L}\p{M}]+/gu) || [];
        // Overlapping windows also catch a bad span inside one long paragraph.
        for (let start = 0; start < words.length; start += 40) {
            const window = words.slice(start, start + 80);
            if (window.length < 35) continue;
            const letters = window.join('').toLowerCase();
            const marked = [...letters].filter((letter) => letter === 'đ' || /\p{M}/u.test(letter.normalize('NFD'))).length;
            const common = window.filter((word) => plainWords.has(word.toLowerCase())).length;
            if (letters.length >= 100 && marked / letters.length < 0.015 && common >= 7) {
                return { paragraph: paragraphIndex + 1, word_offset: start, words: window.length, marked_letters: marked, letters: letters.length, plain_words: common };
            }
        }
    }
    return null;
}

const missingDiacritics = (text) => Boolean(diacriticsIssue(text));
// Headings are too short for the paragraph detector's 35-word threshold.
// Use conservative Vietnamese signals; foreign names and English headings
// must not be rejected merely because they contain no marked letters.
const unmarkedHeadingPhrases = /\b(?:khoi dau|khung hoang|be tac|khong gian|cuon sach|nuoi tiec|trai nghiem|nga re|thach thuc|bang gia|dinh cao|su nghiep|tan vo|ao tuong|hanh phuc|gia dinh|sup do|dau tranh|sinh tu|thuc tinh|ben do|binh yen|y nghia|tron ven|muc tieu|ket luan|gioi thieu|tong ket|phat trien|nhan vat|luan diem|kien thuc|nguyen nhan|he qua)\b/iu;
function headingDiacriticsIssue(text) {
    if (typeof text !== 'string') return null;
    const words = normalize(text).match(/[\p{L}\p{M}]+/gu) || [];
    const phrase = unmarkedHeadingPhrases.exec(words.join(' '));
    if (phrase) return { kind: 'heading', reason: 'unmarked_vietnamese_phrase' };
    const letters = words.join('').toLowerCase();
    const marked = [...letters].some(letter => letter === 'đ' || /\p{M}/u.test(letter.normalize('NFD')));
    const common = words.filter(word => plainWords.has(word.toLowerCase())).length;
    return !marked && words.length >= 3 && common >= 2
        ? { kind: 'heading', reason: 'unmarked_vietnamese_heading' } : null;
}
module.exports = { normalize, missingDiacritics, diacriticsIssue, headingDiacriticsIssue };
