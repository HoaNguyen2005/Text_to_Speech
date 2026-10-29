// Share only the rendered interface language, never form data or identity data.
(() => {
  const valid = value => value === 'vi' || value === 'en';
  function persist(value) {
    if (!valid(value)) return;
    try { document.cookie = `tts_locale=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
    try { localStorage.setItem('text2speech.locale', value); } catch {}
  }
  persist(document.documentElement.lang.split('-')[0]);
  function mount() {
    const selector = document.getElementById('login-select-toggle');
    if (!selector) return;
    // Capture before the inherited onchange handler navigates to its own URL.
    selector.addEventListener('change', event => {
      try { persist(new URL(event.target.value, location.href).searchParams.get('kc_locale')); } catch {}
    }, { capture: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
