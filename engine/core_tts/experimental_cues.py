"""Remove obsolete expression tags from requests from older workers."""
import re
import unicodedata

CUES = re.compile(
    r'\[(?:cười|thở dài|hắng giọng|laugh(?:ter)?|sigh|throat|whisper|thì thầm|chuckle|clear throat|khóc|'
    r'confirmation-en|question-(?:en|ah|oh|ei|yi)|surprise-(?:ah|oh|wa|yo)|dissatisfaction-hnn)\]'
    r'|<\|emotion_[\w-]+\|>', re.I)


def strip_cues(text):
    text = unicodedata.normalize('NFC', text)
    cleaned = CUES.sub(' ', text)
    if cleaned == text:
        return text
    return re.sub(r' +([.,!?;:])', r'\1', re.sub(r'[ \t]+', ' ', cleaned)).strip()
