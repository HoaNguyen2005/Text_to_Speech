const path = require('path');
const dotenv = require('dotenv');

// Injected deployment variables win. Read repo-root .env.local/.env before
// the older backend-only PostgreSQL configuration.
const backend = path.resolve(__dirname, '../..');
const root = path.resolve(backend, '..');
for (const file of [
    path.join(root, '.env.local'),
    path.join(root, '.env'),
    path.join(backend, '.env.local'),
    ...['.env.postgres.local', '.env.keycloak.local', '.env.books.local', '.env'].map(name => path.join(backend, name)),
]) {
    dotenv.config({ path: file, quiet: true });
}
