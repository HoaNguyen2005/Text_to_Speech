"""Validate editor cues and translate the OmniVoice subset for synthesis."""
import re
import unicodedata

CUES = re.compile(r'\[(cười|thở dài|hắng giọng)\]', re.I)
UNSUPPORTED = re.compile(r'<\|emotion_|\[(?:laugh|sigh|throat|whisper|thì thầm|chuckle|clear throat|khóc)\]', re.I)
OMNIVOICE_NATIVE = re.compile(
    r'\[(?:laughter|sigh|confirmation-en|question-(?:en|ah|oh|ei|yi)|surprise-(?:ah|oh|wa|yo)|dissatisfaction-hnn)\]', re.I)
OMNIVOICE_CUES = {'cười': 'laughter', 'thở dài': 'sigh'}


def validate(text, enabled, provider='vieneu'):
    text = unicodedata.normalize('NFC', text)
    matches = list(CUES.finditer(text))
    if provider == 'omnivoice' and (
        OMNIVOICE_NATIVE.search(text) or any(match[1].lower() not in OMNIVOICE_CUES for match in matches)
    ):
        raise ValueError('OmniVoice chỉ hỗ trợ thẻ [cười] và [thở dài] trong trình chỉnh sửa.')
    if UNSUPPORTED.search(text) or (matches and not enabled):
        raise ValueError('Cần bật biểu cảm thử nghiệm và chỉ dùng [cười], [thở dài], [hắng giọng].')
    if len(matches) > 20:
        raise ValueError('Đoạn đọc có quá nhiều thẻ biểu cảm.')
    for match in matches:
        before = text[match.start()-1] if match.start() else ''
        after = text[match.end()] if match.end() < len(text) else ''
        if before.isalnum() or after.isalnum():
            raise ValueError('Hãy chèn thẻ biểu cảm giữa các từ hoặc sau dấu câu.')
    if provider == 'omnivoice':
        return CUES.sub(lambda match: f'[{OMNIVOICE_CUES[match[1].lower()]}]', text)
    return CUES.sub(lambda match: '[' + match.group(1).lower() + ']', text)
