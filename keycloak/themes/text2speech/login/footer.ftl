<#macro content>
    <span id="tts-notification-labels" hidden data-title="${msg('ttsNotice')}" data-error="${msg('ttsNoticeError')}" data-success="${msg('ttsNoticeSuccess')}" data-close="${msg('ttsNoticeClose')}"></span>
    <div class="tts-auth-tools">
        <button id="tts-theme-toggle" type="button" class="tts-theme-toggle" hidden
            aria-label="${msg('ttsDarkMode')}" aria-pressed="false"
            data-light-label="${msg('ttsLight')}" data-dark-label="${msg('ttsDark')}"
            data-switch-light="${msg('ttsSwitchLight')}" data-switch-dark="${msg('ttsSwitchDark')}">
            <svg class="tts-theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></svg>
            <svg class="tts-theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13.1A9 9 0 0 1 10.9 3a9 9 0 1 0 10 10.1Z" /></svg>
            <span data-theme-label aria-hidden="true">${msg('ttsLight')}</span>
            <span class="tts-theme-track" aria-hidden="true"><span></span></span>
        </button>
    </div>
    <div class="tts-footer">
        <p>${msg("ttsTagline")}</p>
    </div>
</#macro>
