const fs = require('fs');
const path = require('path');
const { root, dockerCommand } = require('./lib/postgres-local');
const directory = path.join(root,'keycloak/backups');
fs.mkdirSync(directory,{recursive:true});
const filename = path.join(directory,`app-postgres-${Date.now()}.dump`);
const output = fs.openSync(filename,'wx',0o600);
try {
    dockerCommand(['exec','-T','postgres','pg_dump','-U','keycloak','-d','tts_app','-Fc','--no-owner'], { stdio:['ignore',output,'pipe'] });
    console.log(JSON.stringify({ backup:path.relative(root,filename), format:'pg_dump-custom' }));
} catch { console.error('Không sao lưu được database tts_app. Kiểm tra Docker/PostgreSQL.'); process.exitCode=1; }
finally { fs.closeSync(output); }
