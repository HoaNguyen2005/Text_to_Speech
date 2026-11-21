// Run with playwright-core on NODE_PATH and a local Chromium installation.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function check(page, address, startWithRegister) {
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const intro = page.locator('.studio-intro:visible');
  await intro.waitFor({ timeout: 90000 });
  const welcomeUrl = page.url();
  const bar = page.locator('.studio-wave i').first();
  const animation = () => bar.evaluate(el => getComputedStyle(el).animationName);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await animation(), 'studio-wave-pulse');
  const supportsLines = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true, powerPreference: 'low-power' });
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  });
  if (supportsLines) {
    const canvas = page.locator('.studio-backdrop.lines-ready canvas');
    await canvas.waitFor();
    const { opacity, dark } = await canvas.evaluate(el => ({
      opacity: getComputedStyle(el.parentElement).opacity, dark: document.documentElement.dataset.theme === 'dark'
    }));
    assert.equal(opacity, dark ? '0.24' : '0.27');
  }
  assert.equal(await page.locator('.studio-sound .studio-float svg').count(), 2);
  if (!startWithRegister) {
    for (const action of ['login', 'register']) {
      const button = intro.locator(`[data-open-${action}]`);
      const background = () => button.evaluate(el => getComputedStyle(el).backgroundColor);
      const before = await background();
      await button.hover();
      await button.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
      assert.notEqual(await background(), before);
      assert.equal(await button.evaluate(el => getComputedStyle(el).translate), '0px -2px');
    }
    const account = page.locator('.studio-account');
    const bounds = await account.boundingBox();
    await page.mouse.move(80, 200);
    await page.waitForFunction(() => parseFloat(document.querySelector('.studio-host').style.getPropertyValue('--studio-x')) < -3);
    assert.deepEqual(await account.boundingBox(), bounds);
    await page.locator('.studio-host').dispatchEvent('pointerleave');
    await page.waitForFunction(() => !document.querySelector('.studio-host').style.getPropertyValue('--studio-x'));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await animation(), 'none');
  await page.locator('.studio-backdrop canvas').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.studio-backdrop.lines-ready').count(), 0);
  if (!startWithRegister) {
    const button = intro.locator('[data-open-login]');
    await button.hover();
    assert.equal(await button.evaluate(el => getComputedStyle(el).translate), 'none');
  }
  await page.evaluate(() => { window.welcomeDocument = document; });
  assert.equal(new URL(welcomeUrl).searchParams.get('code_challenge_method'), 'S256');
  if (startWithRegister) {
    await intro.locator('[data-open-register]').click();
  } else {
    await intro.locator('[data-open-login]').click();
    await page.locator('.studio-account #kc-form-login:visible').waitFor();
    assert.equal(page.url(), welcomeUrl);
    await page.locator('.studio-account #kc-registration a:visible').click();
  }
  const frame = page.frameLocator('.studio-account iframe');
  const registration = frame.locator('#kc-register-form[target="_top"]');
  await registration.waitFor();
  assert.ok(await registration.locator('input[type=password]').count() > 0);
  assert.equal(page.url(), welcomeUrl);
  await registration.locator('a[href*="/login-actions/authenticate"]').click();
  await frame.locator('#kc-form-login[target="_top"]').waitFor();
  assert.equal(page.url(), welcomeUrl);
  assert.ok(await page.evaluate(() => window.welcomeDocument === document));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  try {
    for (const startWithRegister of [false, true]) {
      const context = await browser.newContext({ viewport: startWithRegister ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
      await check(await context.newPage(), process.argv[2] || 'http://localhost:5173', startWithRegister);
      await context.close();
    }
    console.log('PASS desktop and mobile welcome, native sign-in and registration, stable top-level URL');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
