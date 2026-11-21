const assert = require('node:assert/strict');
const db = require('../app/db/postgres');
const { getHistory } = require('../app/controllers/history.controller');

const user = { _id: 'a'.repeat(24) };
const items = [
    { teacher_id: 'standard-female', speech_config: { voice_mode: 'standard' } },
    { teacher_id: 'vieneu-truc-ly', voice_mode: 'standard' },
    { teacher_id: 'shared', speech_config: { voice_mode: 'clone', voice_origin: 'system' } },
    { teacher_id: 'mine', voice_mode: 'clone' },
    { teacher_id: 'unavailable', voice_mode: 'clone' },
    { teacher_id: 'deleted', speech_config: { voice_name: 'Tên đã lưu', voice_class: 'diamond' } },
];
let lookupCount = 0;
db.query = async (sql, params) => {
    if (sql.includes('FROM "generated_lectures"')) {
        assert.deepEqual(params, [user._id]);
        return { rows: items };
    }
    lookupCount++;
    assert.match(sql, /"voice_id" IN .*"is_global" = .*OR "user_id" = /);
    assert.deepEqual(params, ['shared', 'mine', 'unavailable', true, user._id]);
    return { rows: [
        { voice_id: 'shared', name: 'Giọng mẫu', class: 'gold', is_global: true },
        { voice_id: 'mine', name: 'Giọng riêng', class: 'diamond', is_global: false },
    ] };
};

async function check() {
    let result;
    await getHistory({ user }, {
        json(rows) { result = rows; },
        status(code) { assert.fail(`Unexpected HTTP ${code}`); },
    });
    assert.equal(lookupCount, 1);
    assert.deepEqual(result.map(row => [row.voice_name, row.voice_class]), [
        ['Hoài My', 'free'], ['Trúc Ly', 'free'], ['Giọng mẫu', 'gold'],
        ['Giọng riêng', 'diamond'], [undefined, undefined], ['Tên đã lưu', 'diamond'],
    ]);
    console.log('PASS: history voice snapshots, presets, scoped lookup and unavailable voices');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
