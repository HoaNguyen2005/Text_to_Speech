export const VOICE_NATIONS = [
  { code: 'vi', label: 'Tiếng Việt', flag: 'vi' },
  { code: 'en', label: 'Tiếng Anh', flag: 'en' },
  { code: 'ja', label: 'Tiếng Nhật', flag: 'ja' },
  { code: 'ko', label: 'Tiếng Hàn', flag: 'ko' },
  { code: 'zh', label: 'Tiếng Trung', flag: 'zh' },
  { code: 'fr', label: 'Tiếng Pháp', flag: 'fr' },
  { code: 'de', label: 'Tiếng Đức', flag: 'de' },
  { code: 'es', label: 'Tiếng Tây Ban Nha', flag: 'es' },
];

const BY_CODE = Object.fromEntries(VOICE_NATIONS.map(item => [item.code, item]));

export function getVoiceNation(code) {
  const key = typeof code === 'string' && code.trim() ? code.trim() : 'vi';
  return BY_CODE[key] || { code: key, label: key, flag: 'globe' };
}
