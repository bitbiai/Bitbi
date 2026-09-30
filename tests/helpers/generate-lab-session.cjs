// Cold entry and verified-session expiry share the existing real sign-in caller.
module.exports = async ({page, expect, mockGenerateLabMemberSession, locale, initiallyAuthenticated}) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  const requests = [];
  let unauthorized = !initiallyAuthenticated;
  await page.route('**/api/**', route => {
    if (route.request().method() === 'GET') return route.fallback();
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 400, json: { ok: false, error: 'Unexpected mutation' } });
  });
  await mockGenerateLabMemberSession(page);
  await page.route('**/api/me', route => unauthorized
    ? route.fulfill({ status: 401, json: { ok: false, error: 'raw generate session detail' } })
    : route.fallback());
  await page.route('**/api/login', route => {
    requests.push(new URL(route.request().url()).pathname);
    expect(route.request().method()).toBe('POST');
    unauthorized = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/${locale === 'de' ? 'de/' : ''}generate-lab/`);
  const expired = locale === 'de' ? 'Sitzung abgelaufen. Melden Sie sich erneut an.' : 'Session expired. Sign in again.';
  const recovery = locale === 'de' ? 'Ihr Prompt bleibt auf dieser Seite.' : 'Your prompt stays on this page.';
  if (initiallyAuthenticated) await expect(page.locator('#labAccountStatus')).toContainText('lab@bitbi.ai');
  else await expect(page.locator('#labAccountStatus')).toHaveText(expired);
  await expect(page.locator('#labMessage')).toBeEmpty();
  const draft = `${locale} retained creative draft`;
  await page.locator('#labPrompt').fill(draft);
  const selectedModel = await page.locator('#labImageModel option').evaluateAll(options =>
    options.find(option => !option.selected && !option.disabled)?.value);
  expect(selectedModel, 'A non-default draft model exercises settings preservation').toBeTruthy();
  await page.locator('#labImageModel').selectOption(selectedModel);
  if (initiallyAuthenticated) {
    // Expire a real verified session at the next user-triggered preflight.
    unauthorized = true;
    await page.locator('#labGenerate').click();
    await expect(page.locator('#labMessage')).toContainText(locale === 'de'
      ? 'Es wurde keine Generierungsanfrage gesendet.' : 'No generation request was sent.');
    await expect(page.locator('#labMessage')).toContainText(locale === 'de'
      ? 'Ihr Prompt und Ihre Einstellungen bleiben erhalten.' : 'Your prompt and settings are preserved.');
    await expect(page.locator('.auth-modal__overlay.active')).toHaveCount(0);
  }
  await expect(page.locator('#labAccountStatus')).toHaveText(expired);
  await expect(page.locator('#labCreditStatus')).toContainText(recovery);
  await expect(page.locator('#labCostInsight')).toBeHidden();
  await expect(page.locator('#labWorkflowGuide')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('raw generate');
  await expect(page.locator('#labPrompt')).toHaveValue(draft);
  await expect(page.locator('#labImageModel')).toHaveValue(selectedModel);
  expect(requests).toEqual([]);
  await page.locator('#labGenerate').click();
  await expect(page.locator('.auth-modal__overlay.active')).toBeVisible();
  await expect(page.locator('.auth-modal__tab.active')).toHaveText(locale === 'de' ? 'Anmelden' : 'Sign In');
  await expect(page.locator('#authLoginMsg')).toContainText(recovery);
  await page.locator('#authLoginForm input[name="email"]').fill('lab@bitbi.ai');
  await page.locator('#authLoginForm input[name="password"]').fill('Synthetic-password-123');
  await page.locator('#authLoginForm button[type="submit"]').click();
  await expect(page.locator('.auth-modal__overlay.active')).toHaveCount(0);
  await expect(page.locator('#labAccountStatus')).toContainText('lab@bitbi.ai');
  await expect(page.locator('#labPrompt')).toHaveValue(draft);
  await expect(page.locator('#labImageModel')).toHaveValue(selectedModel);
  await expect(page.locator('#labMessage')).toBeEmpty();
  expect(requests).toEqual(['/api/login']);
};
