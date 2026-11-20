const assert = require('node:assert/strict');
const Voice = require('../app/models/voice.model');
const tiers = require('../app/services/account_tier.service');
const controller = require('../app/controllers/voice.controller');
const bookVoices = require('../app/services/book_voice.service');

const admin = { _id: 'a'.repeat(24), role: 'admin' };
const user = { _id: 'b'.repeat(24), role: 'user' };
const sample = { _id: 'c'.repeat(24), voice_id: 'shared_voice', name: 'Shared', is_global: true, is_active: true, user_id: admin._id };
const personal = { _id: 'd'.repeat(24), voice_id: 'personal_voice', name: 'Private', is_global: false, is_active: false, user_id: user._id };
const matches = (row, query) => Object.entries(query).every(([key, value]) =>
    key === '$or' ? value.some(item => matches(row, item)) : row[key] === value);
const fixture = data => Object.assign(new Voice(data), { save: async function () {
    Object.assign(data, this.toObject());
} });
Voice.find = query => ({ sort: () => {
    const rows = [sample, personal].filter(row => matches(row, query)).map(fixture);
    return Object.assign(Promise.resolve(rows), { lean: async () => rows.map(row => row.toObject()) });
} });
Voice.findOne = query => {
    const row = [sample, personal].find(row => matches(row, query));
    return Object.assign(Promise.resolve(row ? fixture(row) : null), { lean: async () => row });
};
Voice.findById = id => Voice.findOne({ _id: id });
tiers.withUserLock = (actor, work) => work(actor);

async function call(handler, options = {}) {
    const response = {
        statusCode: 200,
        setHeader() {},
        status(code) { this.statusCode = code; return this; },
        json(data) { this.data = data; return this; },
    };
    await handler({ query: {}, params: { id: sample._id }, ...options }, response);
    return response;
}

async function check() {
    const update = (user, body) => call(controller.updateVoice, { user, body });
    const list = (user, query = {}) => call(controller.getAllVoices, { user, query });
    const includeLocked = { include_locked: 'true' };
    assert.equal((await update(user, { is_active: false })).statusCode, 403);
    assert.equal((await update(admin, { voice_id: 'changed' })).statusCode, 400);
    assert.equal((await update(admin, { is_active: false })).data.data.usable, false);
    assert.deepEqual((await list(admin)).data, []);
    const adminRows = (await list(admin, includeLocked)).data;
    assert.deepEqual(adminRows.map(row => [row.voice_id, row.is_active, row.can_edit]), [[sample.voice_id, false, true]]);
    assert.equal((await list(user, includeLocked)).statusCode, 403);
    assert.equal((await list(undefined, includeLocked)).statusCode, 403);
    assert.deepEqual((await list(user)).data, []);
    assert.equal((await call(controller.preview, { user })).statusCode, 404);
    assert.equal((await bookVoices.choices(user, 'edge')).clone.length, 0);
    await assert.rejects(bookVoices.resolve('clone', sample.voice_id, user, 'edge'), { status: 403 });
    assert.equal((await update(admin, { is_active: true })).data.data.is_active, true);
    assert.equal((await list(user)).data[0].voice_id, sample.voice_id);
    assert.equal((await bookVoices.resolve('clone', sample.voice_id, user, 'edge')).voice_id, sample.voice_id);
    console.log('PASS: admin can lock and unlock a voice; locked samples stay private and cannot be selected, played or used');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
