// Preference only: no form fields or tokens; only the tts_theme cookie is used.
(() => {
  const key = 'text2speech.theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => value === 'light' || value === 'dark';
  let preference = null;
  let button;
  function sharedPreference() {
    try {
      const value = document.cookie.split(';').map(item => item.trim()).find(item => item.startsWith('tts_theme='))?.slice(10);
      return valid(value) ? value : null;
    } catch { return null; }
  }
  function saveCookie(value) {
    try { document.cookie = `tts_theme=${value || ''}; Path=/; Max-Age=${value ? 31536000 : 0}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
  }
  function persist() {
    saveCookie(preference);
    try { if (preference) localStorage.setItem(key, preference); else localStorage.removeItem(key); } catch {}
  }
  function apply() {
    const value = preference || (system.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
    if (button) {
      const dark = value === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? button.dataset.switchLight : button.dataset.switchDark;
      button.querySelector('[data-theme-label]').textContent = dark ? button.dataset.darkLabel : button.dataset.lightLabel;
    }
  }
  try { const saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch {}
  preference = sharedPreference() || preference;
  if (preference) persist();
  apply(); // Loaded in the inherited template's head, before body is painted.
  system.addEventListener('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    saveCookie(preference);
    apply();
  });
  window.addEventListener('focus', () => {
    const shared = sharedPreference();
    if (shared && shared !== preference) { preference = shared; persist(); apply(); }
  });
  function mount() {
    button = document.getElementById('tts-theme-toggle');
    if (!button) return;
    button.hidden = false;
    apply();
    button.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      persist();
      apply();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
