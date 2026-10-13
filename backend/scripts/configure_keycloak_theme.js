const fs = require('node:fs');
const path = require('node:path');
const { root, loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');

async function configureTheme(config = loadLocalConfig()) {
    const admin = createAdminClient(config);
    if (admin.realm !== 'tts-local') throw new Error('This theme setup is limited to the local application realm tts-local.');
    const { body: realm } = await admin.request('');
    const settings = {
        displayName: 'Text2Speech', displayNameHtml: 'Text2Speech', loginTheme: 'text2speech',
        internationalizationEnabled: true, supportedLocales: ['vi', 'en'], defaultLocale: 'vi'
    };
    if (realm.loginTheme !== settings.loginTheme) {
        const directory = path.join(root, 'keycloak/backups');
        fs.mkdirSync(directory, { recursive: true });
        const previous = Object.fromEntries(Object.keys(settings).map((key) => [key, realm[key] ?? null]));
        fs.writeFileSync(path.join(directory, `theme-settings-before-${Date.now()}.json`),
            JSON.stringify({ realm: admin.realm, ...previous }, null, 2) + '\n');
    }
    await admin.request('', { method: 'PUT', body: JSON.stringify(settings) });

    // Only annotate presentation; retain profile validators and access permissions.
    const { body: profile } = await admin.request('/users/profile');
    const firstName = profile.attributes?.find((entry) => entry.name === 'firstName');
    if (firstName) firstName.displayName = '${firstName}';
    const gender = profile.attributes?.find((entry) => entry.name === 'gender');
    if (gender) {
        gender.displayName = '${ttsGender}';
        gender.annotations = { ...gender.annotations, inputType: 'select', inputOptionLabelsI18nPrefix: 'ttsGender' };
    }
    await admin.request('/users/profile', { method: 'PUT', body: JSON.stringify(profile) });
    console.log('Applied Text2Speech login theme and Vietnamese default language to realm tts-local.');
}

if (require.main === module) configureTheme().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { configureTheme };
