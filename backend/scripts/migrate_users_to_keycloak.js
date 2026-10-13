const { loadLocalConfig } = require('./lib/keycloak-local');
const { migrateUsers } = require('./lib/migrate-keycloak-users');

const args = new Set(process.argv.slice(2));
const allowed = new Set(['--execute', '--send-reset-email', '--resend-reset-email', '--help']);
if ([...args].some((argument) => !allowed.has(argument))) {
    console.error('Unknown option. Use --help.');
    process.exitCode = 1;
} else if (args.has('--help')) {
    console.log('Default: read-only summary of isolated local MongoDB accounts.');
    console.log('Import: --execute --send-reset-email');
    console.log('Optional: --resend-reset-email (otherwise successful emails are not resent).');
} else {
    migrateUsers(loadLocalConfig(), {
        execute: args.has('--execute'), sendResetEmail: args.has('--send-reset-email'),
        resendResetEmail: args.has('--resend-reset-email')
    }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
        console.error('[MIGRATION ERROR]', error.message);
        process.exitCode = 1;
    });
}
