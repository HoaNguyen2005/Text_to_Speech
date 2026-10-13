const { loadLocalConfig, createAdminClient } = require('./lib/keycloak-local');

async function configure(config = loadLocalConfig()) {
    const admin = createAdminClient(config);
    const { body: profile } = await admin.request('/users/profile');
    const attributes = profile.attributes || [];
    const managed = ['mongoUserId', 'legacyStatus', 'migrationResetEmailSent'];
    for (const name of [...managed, 'gender', 'fullName']) {
        const attribute = {
            name, displayName: name, multivalued: false,
            permissions: { view: ['admin'], edit: ['admin'] },
            validations: { length: { max: 255 } }
        };
        const index = attributes.findIndex((entry) => entry.name === name);
        if (index === -1) attributes.push(attribute);
        else attributes[index] = attribute;
    }
    // The application requires a full name, not a separate last name.
    const lastName = attributes.find((entry) => entry.name === 'lastName');
    if (lastName) delete lastName.required;
    const firstName = attributes.find((entry) => entry.name === 'firstName');
    if (firstName) firstName.displayName = 'Họ tên';
    await admin.request('/users/profile', {
        // Omitting the policy uses Keycloak's default (unmanaged attributes disabled).
        method: 'PUT', body: JSON.stringify({ ...profile, attributes, unmanagedAttributePolicy: null })
    });
    const { body: saved } = await admin.request('/users/profile');
    for (const name of managed) {
        const definition = saved.attributes.find((entry) => entry.name === name);
        if (!definition || definition.permissions.edit.includes('user')) {
            throw new Error(`User profile protection missing for ${name}`);
        }
    }
    console.log(`Realm ${admin.realm}: migration attributes configured with administrator-only editing.`);
}

if (require.main === module) {
    configure().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { configure };
