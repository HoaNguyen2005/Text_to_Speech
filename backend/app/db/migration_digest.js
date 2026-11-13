const { createHash } = require('node:crypto');
const digest = (source) => createHash('sha256').update(source).digest('hex');
function matches(source, expected) {
    // Older migrations were hashed on both Windows (CRLF) and Linux (LF).
    const lf = source.replace(/\r\n/g, '\n');
    return [source, lf, lf.replace(/\n/g, '\r\n')].some(value => digest(value) === expected);
}
module.exports = { digest, matches };
