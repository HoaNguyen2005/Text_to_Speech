export function stripCues(text) {
  const cleaned = text.replace(/\[(?:cười|thở dài|hắng giọng|laugh(?:ter)?|sigh|throat|whisper|thì thầm|chuckle|clear throat|khóc|confirmation-en|question-(?:en|ah|oh|ei|yi)|surprise-(?:ah|oh|wa|yo)|dissatisfaction-hnn)\]|<\|emotion_[\w-]+\|>/giu, ' ');
  return cleaned === text ? text : cleaned.replace(/[ \t]+/gu, ' ').replace(/ +([.,!?;:])/gu, '$1').trim();
}
