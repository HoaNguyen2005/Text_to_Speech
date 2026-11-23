const assert = require('node:assert/strict');
const providers = require('../app/services/tts_provider.service');
const voices = require('../app/services/book_voice.service');
const speech = require('../app/services/speech.service');
const content = require('../app/services/book_content.service');

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

    // Preserve the audiobook plan and its existing pause durations.
    const longText = [
        'Chương mở đầu\nĐây là câu giới thiệu đầu tiên.',
        'Tuy nhiên ' + 'Nội dung phân tích chi tiết giúp người nghe dễ theo dõi từng ý chính một cách tự nhiên nhất. '.repeat(8) + 'Bạn thấy sao?',
    ].join('\n\n');
    const bookPlan = speech.plan({ sections: [{ text: longText }], speech: { profile: 'auto' }, style: 'normal' });
    const bookNarration = content.narration('', [{ text: longText }], 'normal');
    assert.deepEqual(
        bookPlan.parts.map(({ text, rate_percent, pitch_hz, pause_ms }) => ({ text, rate_percent, pitch_hz, pause_ms })),
        bookNarration
    );
    assert.ok(bookPlan.parts[0].text.startsWith('Chương mở đầu. Đây là câu giới thiệu đầu tiên.'));
    assert.equal(bookPlan.parts[0].pause_ms, 420);
    assert.ok(bookPlan.parts.length >= 3);
    // Split chunks at sentence boundaries get 120ms, never bloated 180ms, and last question chunk gets 700ms.
    assert.equal(bookPlan.parts[1].pause_ms, 120);
    assert.equal(bookPlan.parts.at(-1).pause_ms, 700);

    // Mid-sentence fallback split must set pause_ms: 0 so there is no awkward silence mid-clause.
    const singleLongSentence = 'Từ ngữ rất dài không có dấu chấm câu ' + 'nối tiếp liên tục '.repeat(35) + 'kết thúc.';
    const splitParts = speech.splitChunks(singleLongSentence, 200);
    assert.ok(splitParts.length >= 2);
    assert.equal(splitParts[0].sentenceEnd, false);
    const forcedPlan = speech.plan({ sections: [{ text: singleLongSentence }], speech: { profile: 'auto' } });
    assert.equal(forcedPlan.parts[0].pause_ms, 0);

    const lecturePlan = text => speech.plan({ lecture: true, sections: [{ text }] });
    const source = 'Tôi gặp TS. Nguyễn\r\nVăn An và tiếp tục câu\nchuyện. 🥀 Chờ tôi [nghỉ 0.5s] nhé!';
    const lecture = lecturePlan(source);
    assert.deepEqual(lecture.parts.map(({ text, pause_ms }) => [text, pause_ms]), [
        ['Tôi gặp TS. Nguyễn Văn An và tiếp tục câu chuyện. Chờ tôi', 500],
        ['nhé!', 700],
    ]);
    assert.ok(lecture.sections[0].text.includes('🥀'));
    assert.equal(lecturePlan('Em ơi 🥀, anh vẫn chờ. 👩‍👩‍👧 🇻🇳').parts[0].text, 'Em ơi, anh vẫn chờ.');
    assert.equal(lecturePlan('Xin🥀chào, © 2026').parts[0].text, 'Xin chào, © 2026');
    assert.throws(() => lecturePlan('🥀!\n\n❤️'), { status: 400 });
    assert.equal(lecturePlan('Câu đầu.\n\nCâu tiếp.').parts[0].pause_ms, 420);
    assert.equal(lecturePlan(singleLongSentence).parts.length, 1);

    const prefix = 'một câu kể để giữ liền mạch cảm xúc '.repeat(40).slice(0, 1187).trim();
    const withName = lecturePlan(`${prefix} TS. Nguyễn Văn An cùng tiếp tục kể chuyện ${prefix}`);
    assert.ok(withName.parts.some(part => part.text.includes('TS. Nguyễn Văn An')));
    assert.ok(withName.parts.slice(0, -1).every(part => part.pause_ms === 0));
    const withClause = lecturePlan(`${prefix}, nhưng câu chuyện tiếp tục ${prefix}`);
    assert.ok(withClause.parts[0].text.endsWith(','));
    assert.ok(withClause.parts[1].text.startsWith('nhưng câu chuyện'));

    // Verify admin locking / unlocking a TTS provider and filtering user choices.
    const initialList = await providers.list();
    assert.equal(initialList.length, 2);
    await providers.updateStatus('vieneu', { is_active: false });
    const publicAfterLock = await providers.list();
    assert.deepEqual(publicAfterLock.map(p => p.provider_id), ['edge']);
    const adminAfterLock = await providers.list({ includeLocked: true });
    assert.equal(adminAfterLock.find(p => p.provider_id === 'vieneu').is_active, false);
    const lockedChoices = await voices.choices(user, 'vieneu');
    assert.equal(lockedChoices.provider_locked, true);
    assert.deepEqual(lockedChoices.voices, []);
    await assert.rejects(voices.resolve('standard', 'vieneu-truc-ly', user, 'vieneu'), { status: 403, code: 'TTS_PROVIDER_LOCKED' });
    await providers.updateStatus('vieneu', { is_active: true });
    const unlockedPreset = await voices.resolve('standard', 'vieneu-truc-ly', user, 'vieneu');
    assert.equal(unlockedPreset.provider, 'vieneu');

    console.log('PASS: lecture and audiobook chunking, emoji handling, provider locking/unlocking, presets and validation.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
