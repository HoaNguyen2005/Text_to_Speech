const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../../.env.keycloak.local'), quiet: true });
dotenv.config({ path: path.join(__dirname, '../../.env.books.local'), quiet: true });
dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });
const runtime = require('./runtime').getRuntimeConfig();

module.exports = {
    version: 'book-v2-paraphrase-attribution',
    languageVersion: 'vi-full-diacritics-2',
    editorialVersion: 'grounded-review-1',
    narrationVersion: 'paragraph-rhythm-1',
    maxChars: 1000000,
    minMinutes: 1,
    maxMinutes: 59,
    maxAudioSeconds: 3600,
    analysisChunkChars: Math.min(16000, Math.max(6000, Number.parseInt(process.env.BOOK_ANALYSIS_CHUNK_CHARS, 10) || 12000)),
    // Bound upstream pressure; set to 1 for accounts with a small Gemini quota.
    analysisConcurrency: Math.min(2, Math.max(1, Number.parseInt(process.env.BOOK_ANALYSIS_CONCURRENCY, 10) || 1)),
    edgePrefetchConcurrency: Math.min(3, Math.max(1, Number.parseInt(process.env.EDGE_TTS_PREFETCH_CONCURRENCY, 10) || 3)),
    geminiMinIntervalMs: Math.min(60000, Math.max(1000, Number.parseInt(process.env.GEMINI_MIN_INTERVAL_MS, 10) || 4000)),
    geminiMaxAutoRetries: Math.min(12, Math.max(1, Number.parseInt(process.env.GEMINI_MAX_AUTO_RETRIES, 10) || 8)),
    geminiRetryWindowMs: Math.min(120, Math.max(5, Number.parseInt(process.env.GEMINI_RETRY_WINDOW_MINUTES, 10) || 30)) * 60000,
    geminiMaxTotalRetries: 20,
    standardVoices: [
        ...require('../services/tts_provider.service').voices,
        { voice_id: 'standard-female', name: 'Hoài My', gender: 'female', file_path: '' },
        { voice_id: 'standard-male', name: 'Nam Minh', gender: 'male', file_path: '' },
    ],
    engineUrl: runtime.engineUrl,
    engineSecret: process.env.BOOK_ENGINE_SECRET || '',
    engineTimeout: 20 * 60 * 1000,
    leaseMs: 90000,
    artifactRoot: runtime.artifactRoot,
};
