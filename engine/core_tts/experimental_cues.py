"""Whitelist the three non-verbal cues exposed by our opt-in VieNeu UI."""
import re
import unicodedata

CUES = re.compile(r'\[(cười|thở dài|hắng giọng)\]', re.I)
UNSUPPORTED = re.compile(r'<\|emotion_|\[(?:laugh|sigh|throat|whisper|thì thầm|chuckle|clear throat|khóc)\]', re.I)


def validate(text, enabled):
    text = unicodedata.normalize('NFC', text)
    matches = list(CUES.finditer(text))
    if UNSUPPORTED.search(text) or (matches and not enabled):
        raise ValueError('Cần bật biểu cảm thử nghiệm và chỉ dùng [cười], [thở dài], [hắng giọng].')
    if len(matches) > 20:
        raise ValueError('Đoạn đọc có quá nhiều thẻ biểu cảm.')
    for match in matches:
        before = text[match.start()-1] if match.start() else ''
        after = text[match.end()] if match.end() < len(text) else ''
        if before.isalnum() or after.isalnum():
            raise ValueError('Hãy chèn thẻ biểu cảm giữa các từ hoặc sau dấu câu.')
    return CUES.sub(lambda match: '[' + match.group(1).lower() + ']', text)
