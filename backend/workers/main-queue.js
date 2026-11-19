// A separate entry point also keeps the old Windows launcher from matching
// this process when it searches the command line for book.worker.js.
process.env.BOOK_QUEUE = 'main';
require('./book.worker').run();
