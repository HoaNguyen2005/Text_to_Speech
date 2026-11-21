<#macro studioIcon name>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <#switch name>
            <#case "book"><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5ZM4 17h14M8 7h6M8 11h4"/><#break>
            <#case "headphones"><path d="M4 13v-1a8 8 0 0 1 16 0v1M3 14a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0v-4ZM17 14a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0v-4Z"/><#break>
            <#case "file"><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h4M9 12h5M9 16h6"/><#break>
            <#case "mic"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/><#break>
            <#case "history"><path d="M3 11a9 9 0 1 1 3 8M3 5v6h6M12 7v5l3 2"/><#break>
        </#switch>
    </svg>
</#macro>
<template id="studio-welcome">
    <div class="studio-backdrop" aria-hidden="true" data-module="${url.resourcesPath}/studio-lines/scene.js"></div>
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
                <span class="studio-float studio-book"><@studioIcon name="book"/></span>
                <span class="studio-float studio-headphones"><@studioIcon name="headphones"/></span>
                <div class="studio-wave-heading"><b><@studioIcon name="file"/>${msg("studioWaveTitle")}</b><small>${msg("studioVietnameseVoices")}</small></div>
                <div class="studio-wave">
                    <#list [14,24,18,36,52,32,68,84,54,40,70,96,78,48,62,90,100,74,44,64,84,56,38,70,92,66,48,80,60,36,50,72,42,28,46,30,18,24] as bar>
                        <i style="height:${bar}%; --bar-index:${bar?index}"></i>
                    </#list>
                </div>
                <small>${msg("studioWaveStart")} <span></span> ${msg("studioWaveEnd")}</small>
            </div>
            <ul class="studio-features">
                <li><@studioIcon name="book"/>${msg("studioLectures")}<small>${msg("studioSources")}</small></li>
                <li><@studioIcon name="mic"/>${msg("studioVoices")}<small>${msg("studioTimbre")}</small></li>
                <li><@studioIcon name="history"/>${msg("studioHistory")}<small>${msg("studioListen")}</small></li>
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
