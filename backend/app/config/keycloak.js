function getKeycloakConfig() {
    const base = (process.env.KEYCLOAK_URL || 'http://localhost:8080').replace(/\/$/, '');
    const realm = process.env.KEYCLOAK_REALM || 'tts-local';
    return { base, realm, issuer: `${base}/realms/${encodeURIComponent(realm)}`,
        audience: process.env.KEYCLOAK_AUDIENCE || 'tts-backend',
        clientId: process.env.KEYCLOAK_SERVICE_CLIENT_ID || 'tts-admin-service',
        clientSecret: process.env.KEYCLOAK_SERVICE_CLIENT_SECRET };
}
module.exports = { getKeycloakConfig };
