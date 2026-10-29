require('./legacy-mongo-tool');
const mongoose = require('mongoose');
const { assertLocalMongoUri, createAdminClient } = require('./keycloak-local');

const value = (user, name) => user.attributes?.[name]?.[0];

async function migrateUsers(config, { execute = false, sendResetEmail = false, resendResetEmail = false, log = console.log } = {}) {
    if (execute !== sendResetEmail || (resendResetEmail && !execute)) {
        throw new Error('Writing requires --execute --send-reset-email; resending also requires both flags.');
    }
    const uri = assertLocalMongoUri(config.KEYCLOAK_MIGRATION_MONGODB_URI);
    // Dry-run must not create indexes or modify source documents.
    const connection = await mongoose.createConnection(uri, { autoIndex: false, serverSelectionTimeoutMS: 10000 }).asPromise();
    try {
        const collection = connection.db.collection('users');
        const users = await collection.find({}, {
            projection: { _id: 1, email: 1, fullName: 1, gender: 1, role: 1, status: 1, keycloakId: 1 }
        }).sort({ _id: 1 }).toArray();
        const emails = new Set();
        const links = new Set();
        for (const user of users) {
            const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
            if (!email || email !== user.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new Error(`Invalid or unnormalized email for MongoDB user ${user._id}`);
            }
            if (!user.fullName?.trim() || !['user', 'admin'].includes(user.role) || !['active', 'inactive', 'banned'].includes(user.status)) {
                throw new Error(`Invalid name, role or status for MongoDB user ${user._id}`);
            }
            if (emails.has(email)) throw new Error('Duplicate source email; no migration was started.');
            if (user.keycloakId && links.has(user.keycloakId)) throw new Error('Duplicate source keycloakId; no migration was started.');
            emails.add(email);
            if (user.keycloakId) links.add(user.keycloakId);
        }
        const summary = {
            total: users.length,
            active: users.filter((user) => user.status === 'active').length,
            disabled: users.filter((user) => user.status !== 'active').length,
            admins: users.filter((user) => user.role === 'admin').length,
            alreadyLinked: users.filter((user) => user.keycloakId).length
        };
        log(JSON.stringify(summary));
        if (!execute) {
            log('DRY RUN: no Keycloak calls, no database writes.');
            return { ...summary, created: 0, reused: 0, emailsSent: 0 };
        }

        const admin = createAdminClient(config);
        const { body: realmConfig } = await admin.request('');
        if (realmConfig.smtpServer?.host !== 'mailpit' || realmConfig.smtpServer.port !== '1025') {
            throw new Error('Local migration requires Mailpit SMTP at mailpit:1025. External email delivery is not enabled by this tool.');
        }
        const { body: profile } = await admin.request('/users/profile');
        for (const name of ['mongoUserId', 'legacyStatus', 'migrationResetEmailSent']) {
            const definition = profile.attributes?.find((entry) => entry.name === name);
            if (!definition || definition.permissions?.edit?.includes('user')) {
                throw new Error('Run configure_keycloak_local.js before migration.');
            }
        }
        const roles = {};
        for (const name of ['user', 'admin']) roles[name] = (await admin.request(`/roles/${name}`)).body;
        // Detect every identity collision before creating or updating accounts.
        const targets = [];
        for (const user of users) {
            let target;
            if (user.keycloakId) {
                target = (await admin.request(`/users/${encodeURIComponent(user.keycloakId)}`)).body;
            } else {
                const query = new URLSearchParams({ username: user.email, exact: 'true' });
                const matches = (await admin.request(`/users?${query}`)).body;
                if (matches.length > 1) throw new Error('Multiple Keycloak matches; migration stopped.');
                target = matches[0];
            }
            const emailQuery = new URLSearchParams({ email: user.email, exact: 'true' });
            const emailMatches = (await admin.request(`/users?${emailQuery}`)).body;
            if (emailMatches.some((match) => match.id !== target?.id)) {
                throw new Error(`Keycloak email collision for MongoDB user ${user._id}; no accounts were changed.`);
            }
            if (target && (value(target, 'mongoUserId') !== String(user._id)
                || target.username !== user.email || (target.email && target.email !== user.email))) {
                throw new Error(`Keycloak identity collision for MongoDB user ${user._id}; mapping was not changed.`);
            }
            targets.push(target);
        }

        await collection.createIndex({ keycloakId: 1 }, { unique: true, sparse: true });
        const result = { ...summary, created: 0, reused: 0, emailsSent: 0 };
        for (let index = 0; index < users.length; index++) {
            const user = users[index];
            let target = targets[index];
            const representation = {
                username: user.email, email: user.email, firstName: user.fullName.trim(),
                enabled: user.status === 'active',
                attributes: {
                    ...(target?.attributes || {}),
                    mongoUserId: [String(user._id)], legacyStatus: [user.status],
                    gender: [user.gender || 'other'], fullName: [user.fullName.trim()]
                }
            };
            if (!target) {
                const { response } = await admin.request('/users', {
                    method: 'POST', body: JSON.stringify({ ...representation, emailVerified: false, requiredActions: ['UPDATE_PASSWORD'] })
                });
                const id = response.headers.get('location')?.split('/').pop();
                if (!id) throw new Error('Keycloak did not return a created user ID.');
                target = (await admin.request(`/users/${encodeURIComponent(id)}`)).body;
                result.created++;
            } else {
                await admin.request(`/users/${encodeURIComponent(target.id)}`, { method: 'PUT', body: JSON.stringify(representation) });
                result.reused++;
            }
            if (value(target, 'mongoUserId') !== String(user._id)) throw new Error('Keycloak did not preserve mongoUserId.');
            const userPath = `/users/${encodeURIComponent(target.id)}`;
            const currentRoles = (await admin.request(`${userPath}/role-mappings/realm`)).body;
            const otherAppRoles = currentRoles.filter((role) => ['user', 'admin'].includes(role.name) && role.name !== user.role);
            if (otherAppRoles.length) await admin.request(`${userPath}/role-mappings/realm`, { method: 'DELETE', body: JSON.stringify(otherAppRoles) });
            await admin.request(`${userPath}/role-mappings/realm`, { method: 'POST', body: JSON.stringify([roles[user.role]]) });
            const mapping = await collection.updateOne({
                _id: user._id,
                $or: [{ keycloakId: { $exists: false } }, { keycloakId: target.id }]
            }, { $set: { keycloakId: target.id } });
            if (mapping.matchedCount !== 1) throw new Error('Source mapping changed while migrating.');

            if (user.status === 'active' && (value(target, 'migrationResetEmailSent') !== 'true' || resendResetEmail)) {
                const query = new URLSearchParams({
                    client_id: config.KEYCLOAK_RESET_EMAIL_CLIENT_ID || 'tts-frontend',
                    redirect_uri: config.KEYCLOAK_RESET_EMAIL_REDIRECT_URI || 'http://localhost:5173/', lifespan: '43200'
                });
                await admin.request(`${userPath}/execute-actions-email?${query}`, { method: 'PUT', body: JSON.stringify(['UPDATE_PASSWORD']) });
                const latest = (await admin.request(userPath)).body;
                await admin.request(userPath, { method: 'PUT', body: JSON.stringify({
                    ...latest,
                    attributes: { ...latest.attributes, migrationResetEmailSent: ['true'] }
                }) });
                result.emailsSent++;
            }
            log(`Linked ${index + 1}/${users.length} local accounts.`);
        }
        return result;
    } finally {
        await connection.close();
    }
}

module.exports = { migrateUsers };
