function getKeycloakConfig() {
    const base = (process.env.KEYCLOAK_URL || 'http://localhost:8080').replace(/\/$/, '');
    const internalBase = (process.env.KEYCLOAK_INTERNAL_URL || base).replace(/\/$/, '');
    const realm = process.env.KEYCLOAK_REALM || 'tts-local';
    const internalIssuer = `${internalBase}/realms/${encodeURIComponent(realm)}`;
    return { base, internalBase, realm, issuer: `${base}/realms/${encodeURIComponent(realm)}`,
        tokenUrl: `${internalIssuer}/protocol/openid-connect/token`,
        jwksUri: `${internalIssuer}/protocol/openid-connect/certs`,
        audience: process.env.KEYCLOAK_AUDIENCE || 'tts-backend',
        clientId: process.env.KEYCLOAK_SERVICE_CLIENT_ID || 'tts-admin-service',
        clientSecret: process.env.KEYCLOAK_SERVICE_CLIENT_SECRET };
}
module.exports = { getKeycloakConfig };
