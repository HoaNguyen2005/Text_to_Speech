const assert = require('node:assert/strict');
const providers = require('../app/services/tts_provider.service');
const voices = require('../app/services/book_voice.service');

async function main() {
    const user = { _id: '0123456789abcdef01234567', role: 'user' };
    for (const provider of ['edge', 'vieneu']) {
        assert.equal(providers.validate(provider), provider);
        assert.equal(providers.settings(provider).provider, provider);
    }
    for (const provider of ['omnivoice', 'unknown', '', null]) {
        assert.throws(() => providers.validate(provider), { status: 400 });
        assert.throws(() => providers.settings(provider), { status: 400 });
        for (const mode of ['standard', 'clone']) {
            await assert.rejects(voices.resolve(mode, 'old-voice', user, provider), { status: 400 });
        }
    }
    const standard = await voices.resolve('standard', 'standard-female', user, 'edge');
    assert.equal(standard.provider, 'edge');
    const preset = await voices.resolve('standard', 'vieneu-truc-ly', user, 'vieneu');
    assert.equal(preset.provider, 'vieneu');
    assert.equal(preset.model_revision, providers.revision);
    assert.ok(providers.voices.every(voice => voice.provider === 'vieneu'));
    assert.throws(() => providers.settings('vieneu', undefined, 'wrong-revision'));
    console.log('PASS: two providers, valid presets, rejected unsupported providers and stale revisions.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
