const fs = require('fs');
const path = require('path');
require('../app/config/env');
const { root, dockerCommand, dockerClientCommand } = require('./lib/postgres-local');
const directory = path.join(root,'keycloak/backups');
fs.mkdirSync(directory,{recursive:true});
const filename = path.join(directory,`app-postgres-${Date.now()}.dump`);
const output = fs.openSync(filename,'wx',0o600);
let completed = false;
try {
    const url = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
    if (/\.supabase\.(co|com)$/i.test(url.hostname) || /pooler\.supabase\.com$/i.test(url.hostname)) {
        const credentials = { PGHOST: url.hostname, PGPORT: url.port || '5432',
            PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
            PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'require' };
        dockerClientCommand(['run','--rm', ...Object.keys(credentials).flatMap(key => ['-e', key]),
            'postgres:17-alpine','pg_dump','-Fc','--no-owner','--no-acl'],
        { env: { ...process.env, ...credentials }, stdio:['ignore',output,'pipe'] });
    } else {
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/tts_app') throw new Error('Unsupported local database.');
        dockerCommand(['exec','-T','postgres','pg_dump','-U','keycloak','-d','tts_app','-Fc','--no-owner'], { stdio:['ignore',output,'pipe'] });
    }
    completed = true;
    console.log(JSON.stringify({ backup:path.relative(root,filename), format:'pg_dump-custom' }));
} catch (error) {
    const detail = error.stderr || '';
    const versions = [...detail.matchAll(/(?:server version|pg_dump version):\s*([0-9.]+)/gi)].map(match => match[1]);
    const reason = versions.length ? `pg_dump/server versions: ${versions.join(' / ')}`
        : /root certificate|certificate verify|certificate file/i.test(detail) ? 'TLS_CA'
        : /password|authentication/i.test(detail) ? 'AUTHENTICATION'
        : /resolve|connect|timeout/i.test(detail) ? 'CONNECTION' : error.code || error.name;
    console.error('Không sao lưu được PostgreSQL ứng dụng:', reason);
    process.exitCode=1;
}
finally { fs.closeSync(output); if (!completed) fs.unlinkSync(filename); }
