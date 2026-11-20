<template id="studio-welcome">
    <header class="studio-top">
        <strong class="studio-brand"><img src="${url.resourcesPath}/img/favicon.svg" alt="" width="38" height="38">Text2Speech<span>.</span></strong>
        <div class="studio-tools"><span>${msg("studioCaption")}</span></div>
    </header>
    <div class="studio-columns">
        <section class="studio-story" aria-labelledby="studio-title">
            <p class="studio-eyebrow">${msg("studioEyebrow")}</p>
            <h1 id="studio-title">${msg("studioTitle")}<br><em>${msg("studioTitleAccent")}</em></h1>
            <p class="studio-description">${msg("studioDescription")}</p>
            <div class="studio-sound" aria-hidden="true">
                <div class="studio-wave-heading"><b>${msg("studioWaveTitle")}</b><small>${msg("studioVietnameseVoices")}</small></div>
                <div class="studio-wave">
                    <#list [14,24,18,36,52,32,68,84,54,40,70,96,78,48,62,90,100,74,44,64,84,56,38,70,92,66,48,80,60,36,50,72,42,28,46,30,18,24] as bar>
                        <i style="height:${bar}%"></i>
                    </#list>
                </div>
                <small>${msg("studioWaveStart")} <span></span> ${msg("studioWaveEnd")}</small>
            </div>
            <ul class="studio-features">
                <li>${msg("studioLectures")}<small>${msg("studioSources")}</small></li>
                <li>${msg("studioVoices")}<small>${msg("studioTimbre")}</small></li>
                <li>${msg("studioHistory")}<small>${msg("studioListen")}</small></li>
            </ul>
        </section>
        <section class="studio-account" aria-label="${msg('studioSpace')}">
            <div class="studio-intro">
                <p class="studio-signed-out" role="status" hidden>${msg("studioSignedOut")}</p>
                <svg class="studio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></svg>
                <p class="studio-eyebrow">${msg("studioSpace")}</p>
                <h2>${msg("studioStart")}</h2>
                <p>${msg("studioSignInHint")}</p>
                <button type="button" class="studio-primary" data-open-login>${msg("doLogIn")} &rarr;</button>
                <#if realm.registrationAllowed>
                    <small>${msg("noAccount")}</small>
                    <button type="button" data-open-register>${msg("doRegister")}</button>
                </#if>
                <footer>${msg("studioOneAccount")}</footer>
            </div>
            <div class="studio-form"></div>
        </section>
    </div>
    <footer class="studio-bottom"><span>${msg("studioBrandFooter")}</span><span>${msg("studioLanguageFooter")}</span></footer>
</template>
