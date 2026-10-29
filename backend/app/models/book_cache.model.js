const { repository } = require('../db/repository');
module.exports = { BookCache: repository('book_caches'), ReadingProfile: repository('reading_profiles'), WorkerLease: repository('worker_leases') };
