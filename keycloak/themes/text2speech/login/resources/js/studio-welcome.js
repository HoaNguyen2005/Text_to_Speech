// Keep the browser's OIDC flow and the original Keycloak forms on one origin.
document.addEventListener('DOMContentLoaded', () => {
  const template = document.querySelector('#studio-welcome');
  if (!template || window !== window.top) return;
  const nativeCard = document.querySelector('main.pf-v5-c-login__main');
  if (!nativeCard) return;

  const signedOut = location.hash === '#tts-signed-out';
  const fresh = Boolean(nativeCard.querySelector('#kc-form-login')) &&
    (signedOut || location.hash === '#tts-welcome');

  const shell = document.createElement('div');
  shell.className = 'studio-welcome';
  shell.append(template.content.cloneNode(true));
  const host = document.querySelector('.pf-v5-c-login');
  const intro = shell.querySelector('.studio-intro');
  const slot = shell.querySelector('.studio-form');
  const tools = shell.querySelector('.studio-tools');
  const locale = nativeCard.querySelector('.pf-v5-c-login__main-header-utilities');
  const toggle = nativeCard.querySelector('.tts-auth-tools');
  if (locale) tools.append(locale);
  if (toggle) tools.append(toggle);
  const register = nativeCard.querySelector('#kc-registration a');
  const registerButton = intro.querySelector('[data-open-register]');
  host.append(shell);
  slot.append(nativeCard);
  host.classList.add('studio-host');
  const backdrop = shell.querySelector('.studio-backdrop');
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  function loadLines() {
    if (!motion.matches) return;
    motion.removeEventListener('change', loadLines);
    import(backdrop.dataset.module).then(module => module.mountLines(backdrop))
      .catch(() => { /* The theme keeps its CSS background while WebGL is unavailable. */ });
  }
  motion.addEventListener('change', loadLines);
  loadLines();
  const followPointer = matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)');
  const resetPointer = () => {
    host.style.removeProperty('--studio-x');
    host.style.removeProperty('--studio-y');
    host.style.removeProperty('--studio-tilt');
  };
  host.addEventListener('pointermove', event => {
    if (!followPointer.matches || event.pointerType === 'touch') return;
    host.style.setProperty('--studio-x', (event.clientX / innerWidth - .5) * 36 + 'px');
    host.style.setProperty('--studio-y', (event.clientY / innerHeight - .5) * 24 + 'px');
    host.style.setProperty('--studio-tilt', (event.clientY / innerHeight - .5) * 2 + 'deg');
  }, { passive: true });
  host.addEventListener('pointerleave', resetPointer);
  followPointer.addEventListener('change', resetPointer);
  slot.hidden = fresh;
  intro.hidden = !fresh;
  intro.querySelector('.studio-signed-out').hidden = !signedOut;
  function openLogin() {
    intro.hidden = true;
    slot.hidden = false;
    nativeCard.querySelector('input:not([type=hidden])')?.focus();
  }

  function openLinkedForm(link) {
    // Only Keycloak's own browser-action links may be shown in this card.
    const url = new URL(link.href);
    if (url.origin !== location.origin) return;
    intro.hidden = true;
    slot.hidden = false;
    nativeCard.hidden = true;
    const frame = document.createElement('iframe');
    frame.title = link.textContent.trim() || registerButton?.textContent || 'Text2Speech';
    let observer;
    frame.addEventListener('load', () => {
      observer?.disconnect();
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.documentElement.classList.add('studio-framed');
      doc.documentElement.dataset.theme = document.documentElement.dataset.theme;
      const languages = doc.querySelector('#login-select-toggle');
      const outerLanguages = tools.querySelector('#login-select-toggle');
      if (languages && outerLanguages) outerLanguages.replaceChildren(...languages.cloneNode(true).children);
      // Finish the authorization redirect in the app's top-level browsing context.
      for (const fieldForm of doc.forms) fieldForm.target = '_top';
      const card = doc.querySelector('.pf-v5-c-login__main') || doc.body;
      const resize = () => { frame.style.height = Math.ceil(card.getBoundingClientRect().height + 4) + 'px'; };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(card);
      frame.title = doc.querySelector('#kc-page-title')?.textContent.trim() || frame.title;
      doc.querySelector('input:not([type=hidden])')?.focus({ preventScroll: true });
    });
    frame.src = url.href;
    slot.append(frame);
    new MutationObserver(() => {
      if (frame.contentDocument) frame.contentDocument.documentElement.dataset.theme = document.documentElement.dataset.theme;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  intro.querySelector('[data-open-login]').addEventListener('click', openLogin);
  if (register && registerButton) registerButton.addEventListener('click', () => openLinkedForm(register));
  else registerButton?.remove();
  // Native pages keep their security checks, field validation and translations.
  nativeCard.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href);
    if (url.origin === location.origin && /\/login-actions\/(registration|authenticate|reset-credentials)$/.test(url.pathname)) {
      event.preventDefault();
      openLinkedForm(link);
    }
  });
});
