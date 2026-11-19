require('../config/env');
const queue = process.env.BOOK_QUEUE || 'legacy';
if (!['main', 'legacy'].includes(queue)) throw new Error('BOOK_QUEUE must be main or legacy');
const main = queue === 'main';
module.exports = {
    jobs: main ? 'main_book_jobs' : 'book_jobs',
    previews: main ? 'main_book_previews' : 'book_previews',
    leases: main ? 'main_worker_leases' : 'worker_leases',
    requestId: id => main ? 'main/' + id : id,
};
