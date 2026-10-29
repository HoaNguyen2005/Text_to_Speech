// Present only server-rendered feedback; never read credentials, tokens or form values.
(() => {
  function mount() {
    const labels = document.getElementById('tts-notification-labels')?.dataset;
    if (!labels) return;
    const alerts = Array.from(document.querySelectorAll('.pf-v5-c-alert'));
    const fieldErrors = Array.from(document.querySelectorAll('[id^="input-error"]'));
    const messages = [...new Set([...alerts, ...fieldErrors].map(node => node.textContent.trim()).filter(Boolean))];
    if (!messages.length) return;
    const error = fieldErrors.some(node => node.textContent.trim()) || alerts.some(node => node.classList.contains('pf-m-danger'));
    const success = !error && alerts.some(node => node.classList.contains('pf-m-success'));
    const card = document.createElement('aside');
    card.className = `tts-notification ${error ? 'error' : success ? 'success' : 'info'}`;
    card.setAttribute('role', error ? 'alert' : 'status');
    card.setAttribute('aria-atomic', 'true');
    const symbol = document.createElement('span');
    symbol.className = 'tts-notification-symbol'; symbol.textContent = error ? '!' : success ? '✓' : 'i';
    symbol.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = error ? labels.error : success ? labels.success : labels.title;
    const text = document.createElement('p'); text.textContent = messages.join('\n');
    content.append(title, text);
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', labels.close);
    close.addEventListener('click', () => card.remove());
    card.append(symbol, content, close);
    document.body.append(card);
    // Keep field hints linked to inputs; global feedback is now presented by the popup.
    alerts.forEach(node => { node.hidden = true; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
