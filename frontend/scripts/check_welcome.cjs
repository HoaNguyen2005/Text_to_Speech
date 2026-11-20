// Run with playwright-core on NODE_PATH and a local Chromium installation.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function check(page, address, startWithRegister) {
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const intro = page.locator('.studio-intro:visible');
  await intro.waitFor({ timeout: 90000 });
  const welcomeUrl = page.url();
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
