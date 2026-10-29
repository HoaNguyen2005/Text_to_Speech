const { getKeycloakConfig } = require('../config/keycloak');
const { resolveIdentity } = require('../services/identity.service');
const { problem } = require('../services/keycloak.service');

let verifierPromise;
async function verifyAccessToken(token) {
    if (!verifierPromise) verifierPromise = import('jose').then(({ createRemoteJWKSet, jwtVerify }) => {
        const config = getKeycloakConfig();
        const keys = createRemoteJWKSet(new URL(config.jwksUri), {
            timeoutDuration: 10000, cooldownDuration: 1000, cacheMaxAge: 600000
        });
        return async (accessToken) => {
            const { payload } = await jwtVerify(accessToken, keys, {
                issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], clockTolerance: 5,
                requiredClaims: ['sub', 'exp', 'iat']
            });
            if (payload.typ !== 'Bearer' || typeof payload.sub !== 'string') throw problem(401, 'Cần access token Keycloak hợp lệ.', 'INVALID_TOKEN');
            return payload;
        };
    });
    try { return await (await verifierPromise)(token); }
    catch (error) {
        if (error.status) throw error;
        if (['ERR_JWKS_TIMEOUT'].includes(error.code) || error.name === 'TypeError') {
            throw problem(503, 'Không đọc được khóa xác thực Keycloak. Hãy kiểm tra Docker Desktop.', 'KEYCLOAK_UNAVAILABLE');
        }
        throw problem(401, 'Token không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.', 'INVALID_TOKEN');
    }
}
function authFailure(res, error) {
    const status = error.status || (error.code === 11000 ? 409 : 503);
    return res.status(status).json({
        error: error.status ? error.message : 'Không thể tải hồ sơ tài khoản. Vui lòng thử lại.',
        code: error.code === 11000 ? 'IDENTITY_CONFLICT' : error.code || 'AUTH_UNAVAILABLE'
    });
}
async function verifyToken(req, res, next) {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) {
        return res.status(401).json({ error: 'Bạn cần đăng nhập để sử dụng chức năng này.', code: 'AUTH_REQUIRED' });
    }
    try {
        req.auth = await verifyAccessToken(header.replace(/^Bearer\s+/i, ''));
        req.user = await resolveIdentity(req.auth, { onAccountCreated: () => { req.identityCreated = true; } });
        next();
    } catch (error) { authFailure(res, error); }
}
function adminOnly(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Bạn không có quyền quản trị.', code: 'INSUFFICIENT_ROLE' });
    next();
}
function optionalAuth(req, res, next) {
    if (req.headers.authorization === undefined) return next();
    return verifyToken(req, res, next);
}
module.exports = { verifyToken, verifyAccessToken, adminOnly, optionalAuth };
