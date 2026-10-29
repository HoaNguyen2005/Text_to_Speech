import { computed, readonly, ref } from 'vue';
import english from '@/locales/en.json';

const key = 'text2speech.locale';
const valid = value => value === 'vi' || value === 'en';
const normalize = value => value.replace(/\s+/g, ' ').trim();
function sharedLocale() {
  try { const value = document.cookie.split(';').map(item => item.trim()).find(item => item.startsWith('tts_locale='))?.slice(11); return valid(value) ? value : null; }
  catch { return null; }
}
function storedLocale() {
  try { const value = localStorage.getItem(key); return valid(value) ? value : null; } catch { return null; }
}
export const locale = ref(sharedLocale() || storedLocale() || 'vi');
export const getLocaleTag = () => locale.value === 'en' ? 'en-US' : 'vi-VN';
let initialized = false;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Legacy UI feedback contains formatted filenames/counts. Match only known UI
// messages; never process documents, user names, generated scripts or audio.
const patterns = Object.entries(english).filter(([source]) => /\{\d+\}/.test(source)).map(([source, target]) => {
  const parts = source.split(/(\{\d+\})/);
  const indexes = parts.filter(part => /^\{\d+\}$/.test(part)).map(part => Number(part.slice(1,-1)));
  return { source, target, indexes, regex: new RegExp('^' + parts.map(part => /^\{\d+\}$/.test(part) ? '(.*?)' : escapeRegex(part)).join('') + '$') };
});
function interpolate(text, params) {
  return text.replace(/\{(\d+)\}/g, (match, index) => {
    const value = params?.[Number(index)];
    if (value == null) return match;
    if (typeof value === 'object' && typeof value.key === 'string') return translate(value.key, value.params);
    return typeof value === 'number' ? new Intl.NumberFormat(getLocaleTag()).format(value) : String(value);
  });
}
export function translate(value, params, depth = 0) {
  if (value == null) return '';
  if (typeof value === 'object' && typeof value.key === 'string') return translate(value.key, value.params, depth);
  const text = String(value);
  const source = normalize(text);
  if (locale.value !== 'en') return interpolate(text, params);
  if (Object.hasOwn(english, source)) {
    const leading = text.match(/^\s*/)[0];
    const trailing = text.match(/\s*$/)[0];
    return leading + interpolate(english[source], params) + trailing;
  }
  for (const pattern of patterns) {
    const match = pattern.regex.exec(source);
    if (!match) continue;
    const values = [];
    pattern.indexes.forEach((index, position) => { values[index] = depth < 2 ? translate(match[position + 1], undefined, depth + 1) : match[position + 1]; });
    return interpolate(pattern.target, values);
  }
  return interpolate(text, params);
}
function saveCookie(value) {
  try { document.cookie = `tts_locale=${value || ''}; Path=/; Max-Age=${value ? 31536000 : 0}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
}
function apply(value, persist = true) {
  locale.value = valid(value) ? value : 'vi';
  document.documentElement.lang = locale.value;
  document.title = locale.value === 'en' ? 'Text2Speech — AI Lectures' : 'Text2Speech — Bài giảng AI';
  if (persist) {
    saveCookie(locale.value);
    try { localStorage.setItem(key, locale.value); } catch {}
  }
}
export function initializeLocale() {
  if (initialized) return;
  initialized = true;
  apply(sharedLocale() || storedLocale() || 'vi');
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    apply(valid(event.newValue) ? event.newValue : 'vi', false);
    saveCookie(locale.value);
  });
  window.addEventListener('focus', () => {
    const shared = sharedLocale();
    if (shared && shared !== locale.value) apply(shared);
  });
}
export function useLocale() {
  return { locale: readonly(locale), localeTag: computed(getLocaleTag), setLocale: value => { if (valid(value)) apply(value); } };
}
