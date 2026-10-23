const fs = require('node:fs/promises');
const { mockPublicAppearance } = require('./appearance.js');

async function setup(page, { signedIn = false, configFailure = false } = {}) {
    const { validateConsumerDeclaration, declarationReceipt } = await import('../../workers/auth/src/lib/consumer-declarations.js');
    const unexpected = [], calls = [], stored = new Map();
    let lost = false, invalid = false;
    await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
    await page.route('**/api/**', route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (request.method() === 'GET') return route.fulfill({ json: { ok: true } });
        unexpected.push(`${request.method()} ${path}`);
        return route.fulfill({ status: 400, json: { error: 'unexpected_test_mutation' } });
    });
    await mockPublicAppearance(page, { walletEnabled: false });
    await page.route('**/api/me', route => route.fulfill({ json: { loggedIn: signedIn, user: signedIn ? { id: 'consumer-fixture-user', role: 'member', email: 'signed-in@example.test', displayName: 'Signed In' } : null } }));
    await page.route('**/api/consumer/declarations/config', route => route.fulfill({ status: configFailure ? 503 : 200, json: configFailure ? { error: 'unavailable' } : { requireTurnstile: false } }));
    await page.route('**/api/consumer/declarations', async route => {
        const request = route.request();
        if (request.method() !== 'POST') { unexpected.push(request.method()); return route.abort(); }
        const body = request.postDataJSON(); calls.push(body);
        let value;
        try { value = validateConsumerDeclaration(body); } catch (error) { return route.fulfill({ status: 400, json: { code: error.code } }); }
        if (!stored.has(body.requestId)) {
            const id = 'declaration-fixture-123', receivedAt = '2026-10-23T10:30:15.123Z';
            stored.set(body.requestId, { id, status: 'received', receivedAt, acknowledgement: { state: 'review_required' }, receipt: { ...value, id, receivedAt, text: declarationReceipt(value, id, receivedAt) } });
        }
        if (lost) { lost = false; return route.abort('connectionreset'); }
        if (invalid) { invalid = false; return route.fulfill({ json: { status: 'received' } }); }
        return route.fulfill({ status: 201, json: stored.get(body.requestId) });
    });
    return { unexpected, calls, stored, loseNext: () => { lost = true; }, invalidateNext: () => { invalid = true; } };
}
function url(locale, kind) { return locale === 'de' ? `/de/legal/${kind === 'withdrawal' ? 'widerruf' : 'kuendigung'}.html` : `/legal/${kind}.html`; }
async function fill(page) {
    await page.locator('input[name=name]').fill('Ada Example');
    await page.locator('input[name=email]').fill('ada@example.test');
    await page.locator('textarea[name=contractReference]').fill('Creator purchase on 1 October; no order number available.');
}
async function withdrawal({ page, expect, locale, testInfo }) {
    const state = await setup(page, { signedIn: locale === 'de' });
    await page.goto(url(locale, 'withdrawal'));
    await expect(page.locator('form button[type=submit]')).toBeEnabled();
    await expect(page.locator('[data-receipt]')).toBeHidden();
    await fill(page);
    await page.locator('textarea[name=scope]').fill('<img src=x onerror=alert(1)> selected contract part');
    await page.locator('form button[type=submit]').click();
    await expect(page.locator('[data-review]')).toBeVisible();
    await expect(page.locator('[data-review] h2')).toBeFocused();
    await expect(page.locator('[data-review] dd').last()).toHaveText('<img src=x onerror=alert(1)> selected contract part');
    expect(await page.locator('[data-review] img').count()).toBe(0);
    expect(state.calls).toHaveLength(0);
    await page.locator('[data-edit]').click();
    await expect(page.locator('input[name=name]')).toBeFocused();
    await page.locator('textarea[name=scope]').fill('The selected additional credit pack.');
    await page.locator('form button[type=submit]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-confirm]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-receipt]')).toBeVisible();
    await expect(page.locator('[data-receipt] h2')).toBeFocused();
    await expect(page.locator('[data-mail-state]')).toContainText(locale === 'de' ? 'E-Mail-Versand benötigt Aufmerksamkeit' : 'email acknowledgement needs attention');
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ kind: 'withdrawal', locale, name: 'Ada Example', email: 'ada@example.test' });
    expect(state.calls[0]).not.toHaveProperty('reason');
    expect(state.calls[0]).not.toHaveProperty('cancellationType');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('[data-save-receipt]').click();
    const download = await downloadEvent;
    const document = await fs.readFile(await download.path(), 'utf8');
    expect(document).toEqual(state.stored.get(state.calls[0].requestId).receipt.text);
    expect(document).toContain('2026-10-23T10:30:15.123Z');
    expect(document).toContain('declaration-fixture-123');
    expect(document).toContain('Creator purchase on 1 October');
    expect(document).toContain(locale === 'de' ? 'weder eine Erstattung' : 'does not confirm a refund');
    await page.reload();
    await expect(page.locator('[data-receipt]')).toBeVisible();
    expect(state.calls).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`consumer-withdrawal-${locale}.png`), fullPage: true });
}
async function lostReceipt({ page, expect, locale }) {
    const state = await setup(page);
    state.loseNext();
    await page.goto(url(locale, 'withdrawal')); await fill(page);
    await expect(page.locator('form button[type=submit]')).toBeEnabled();
    await page.locator('form button[type=submit]').click(); await page.locator('[data-confirm]').click();
    await expect(page.locator('[data-notice]')).toContainText(locale === 'de' ? 'nicht bestätigt' : 'could not confirm');
    await expect(page.locator('[data-receipt]')).toBeHidden();
    await expect(page.locator('[data-edit]')).toBeHidden();
    expect(state.stored.size).toBe(1);
    await page.reload();
    await expect(page.locator('[data-review]')).toBeVisible();
    await expect(page.locator('[data-confirm]')).toBeEnabled();
    state.invalidateNext();
    await page.locator('[data-confirm]').click();
    await expect(page.locator('[data-notice]')).toContainText(locale === 'de' ? 'nicht bestätigt' : 'could not confirm');
    await expect(page.locator('[data-receipt]')).toBeHidden();
    await page.locator('[data-confirm]').click();
    await expect(page.locator('[data-receipt]')).toBeVisible();
    expect(state.calls).toHaveLength(3);
    expect(state.calls[1]).toEqual(state.calls[0]); expect(state.calls[2]).toEqual(state.calls[0]);
    expect(state.stored.size).toBe(1); expect(state.unexpected).toEqual([]);
}
async function cancellation({ page, expect, locale, testInfo }) {
    const state = await setup(page);
    await page.goto(url(locale, 'cancellation'));
    const submit = page.locator('form button[type=submit]');
    await expect(submit).toHaveText(locale === 'de' ? 'jetzt kündigen' : 'Cancel now');
    await expect(submit).toBeVisible(); await expect(submit).toBeEnabled();
    await submit.click(); expect(state.calls).toHaveLength(0);
    await fill(page);
    await page.locator('select[name=cancellationType]').selectOption('extraordinary');
    await expect(page.locator('textarea[name=reason]')).toBeVisible();
    expect(await page.locator('textarea[name=reason]').getAttribute('required')).toBeNull();
    await page.locator('select[name=endRequest]').selectOption('date');
    await page.locator('input[name=requestedEndDate]').fill('2026-10-30');
    await submit.click();
    await expect(page.locator('[data-receipt]')).toBeVisible();
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ kind: 'cancellation', cancellationType: 'extraordinary', endRequest: 'date', requestedEndDate: '2026-10-30' });
    expect(state.calls[0]).not.toHaveProperty('reason');
    expect(state.unexpected).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`consumer-cancellation-${locale}.png`), fullPage: true });
}
async function unavailable({ page, expect, locale }) {
    const state = await setup(page, { configFailure: true });
    await page.goto(url(locale, 'withdrawal'));
    await expect(page.locator('[data-notice]')).toContainText(locale === 'de' ? 'vorübergehend nicht verfügbar' : 'temporarily unavailable');
    await expect(page.locator('form button[type=submit]')).toBeDisabled();
    await expect(page.locator('a[href="mailto:bit@bitbi.ai"]').first()).toBeVisible();
    expect(state.calls).toEqual([]); expect(state.unexpected).toEqual([]);
    await page.goto(locale === 'de' ? '/de/pricing.html' : '/pricing.html');
    await expect(page.locator(`footer a[href="${url(locale, 'withdrawal')}"]`)).toBeVisible();
    await expect(page.locator(`footer a[href="${url(locale, 'cancellation')}"]`)).toBeVisible();
    const entry=page.locator('.consumer-contract-entry');
    await expect(entry.getByRole('link')).toHaveCount(2);
    for(const pagePath of [locale==='de'?'/de/':'/',locale==='de'?'/de/account/profile.html':'/account/profile.html']) {
        await page.goto(pagePath);
        await expect(page.locator(`.consumer-contract-entry a[href="${url(locale,'withdrawal')}"]`)).toBeVisible();
        await expect(page.locator(`.consumer-contract-entry a[href="${url(locale,'cancellation')}"]`)).toBeVisible();
    }
}
module.exports = { withdrawal, lostReceipt, cancellation, unavailable };

async function operatorQueue({page,expect,mockAdminControlPlane,seedCookieConsent,mockAdminAiLab}) {
  await seedCookieConsent(page);await mockAdminAiLab(page);
  await mockAdminControlPlane(page);
  const mutations=[],id='cd_00000000000000000000000000000009';let revision=0,state='received';
  await page.route('**/api/admin/billing/consumer-declarations**',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{ok:true,summary:{openCount:1,overdueCount:1},items:[{id,kind:'cancellation',name:'Synthetic consumer',email:'consumer@example.invalid',
      contract_reference:'Synthetic BITBI Pro',receipt_text:'Original receipt at 2026-10-23T10:30:00Z',received_at:'2026-10-23T10:30:00.000Z',review_due_at:'2026-10-24T10:30:00.000Z',
      user_id:'synthetic-member',state,revision,provider_state:'not_requested',acknowledgement_state:'review_required',acknowledgement_error:'mail_config_unavailable'}],nextCursor:null,mailFailures:[{kind:'cancellation_acknowledgement',source_id:id,state:'review_required',error_code:'mail_config_unavailable'}]}});
    const body=route.request().postDataJSON();mutations.push({path:new URL(route.request().url()).pathname,body});
    if(route.request().url().endsWith('/subscription'))return route.fulfill({status:409,json:{ok:false,code:'consumer_cancellation_subscription_changed'}});
    revision++;state=body.state;return route.fulfill({json:{ok:true,reused:false}});
  });
  await page.goto('/admin/index.html');await expect(page.getByRole('link',{name:'Review billing events',exact:true})).toBeVisible();await expect(page.locator('#adminAttention .admin-attention-row').filter({has:page.getByRole('link',{name:'Review billing events',exact:true})})).toContainText('1 open');await page.getByRole('link',{name:'Review billing events',exact:true}).click();await expect(page.locator('#consumerDeclarationsList article')).toHaveCount(1);
  const item=page.locator('#consumerDeclarationsList article');await expect(item).toContainText('mail_config_unavailable');
  await item.getByText('Verified subscription cancellation / original-outcome reconciliation',{exact:true}).click();
  await item.getByLabel('Review / identity-verification note').fill('Verified by an existing secure account workflow.');
  await item.getByLabel('Exact Stripe subscription ID').fill('sub_synthetic_contract');
  await item.getByRole('button',{name:'Apply verified cancellation'}).click();
  await expect(item).toContainText('Identity and contract verification are required.');expect(mutations).toEqual([]);
  await item.getByLabel('I verified identity, contract association and the requested ending').check();
  await item.getByRole('button',{name:'Apply verified cancellation'}).click();
  await expect(item).toContainText('consumer_cancellation_subscription_changed');
  expect(mutations).toHaveLength(1);expect(mutations[0].body).toMatchObject({expectedRevision:0,userId:'synthetic-member',providerSubscriptionId:'sub_synthetic_contract',identityVerified:true});
  await item.getByRole('button',{name:'Mark in review'}).focus();await page.keyboard.press('Enter');
  await expect(item).toContainText('in_review');expect(mutations).toHaveLength(2);expect(mutations[1].path).toBe(`/api/admin/billing/consumer-declarations/${id}/review`);
  await expect(page.locator('#consumerMailFailures')).toContainText('mail_config_unavailable');

}
module.exports.operatorQueue=operatorQueue;

async function checkoutConsent({page,expect,locale,mockPricingAccount}) {
      const {checkoutRequests} = await mockPricingAccount(page, {role:'user',organizations:[]});
      await page.route('https://checkout.stripe.com/**',route=>route.fulfill({body:'Synthetic checkout'}));
      await page.goto(locale==='de'?'/de/pricing.html':'/pricing.html');
      const checks=page.locator('.pricing-legal__check input');
      await expect(checks).toHaveCount(2); await expect(checks.nth(0)).not.toBeChecked(); await expect(checks.nth(1)).not.toBeChecked();
      await expect(page.locator('.pricing-legal')).toContainText(locale==='de'?'verzichte ich nicht pauschal':'does not constitute a blanket waiver');
      await checks.nth(0).check(); await checks.nth(1).check();
      await page.locator('.pricing-legal__checkout').click();
      await expect.poll(()=>checkoutRequests.length).toBe(1);
      expect(checkoutRequests[0].body).toMatchObject({terms_version:'2026-10-23',consentVersion:'consumer-v1',locale,earlyStartRequested:true,withdrawalKnowledgeAccepted:false});
}
module.exports.checkoutConsent=checkoutConsent;

async function contractDocuments({page,expect,locale,mockCreditsAccount}) {
      await mockCreditsAccount(page,{organizations:[]});
      const mutations=[];let pages=0;
      await page.route('**/api/account/billing/contracts**',route=>{
        if(route.request().method()!=='GET'){mutations.push(route.request().method());return route.abort();}
        const url=new URL(route.request().url());
        if(url.pathname.endsWith('/checkout_document_1'))return route.fulfill({json:{ok:true,document:{text:'Original terms 2026-10-23\nSynthetic purchased offer, EUR 9.99\nExplicit early-start; no automatic extinction.'}}});
        pages++;return route.fulfill({json:{ok:true,items:[{checkoutId:'checkout_document_1',offerName:'Creator <script>',createdAt:'2026-10-23T11:00:00.000Z'}],nextCursor:pages===1?'older-page':null}});
      });
      await page.goto(locale==='de'?'/de/account/credits.html?scope=member':'/account/credits.html?scope=member');
      const mount=page.locator('#creditsContractDocuments');await expect(mount).toBeVisible();
      const buttons=mount.locator('[data-contract-list] button');await expect(buttons).toHaveCount(1);await expect(buttons.first()).toContainText('Creator <script>');
      expect(await mount.locator('script').count()).toBe(0);
      await mount.locator('[data-contract-more]').click();await expect(mount.locator('[data-contract-more]')).toBeHidden();await expect(buttons).toHaveCount(1);
      const saved=page.waitForEvent('download');await buttons.first().click();const doc=await saved;
      expect(await fs.readFile(await doc.path(),'utf8')).toContain('Original terms 2026-10-23');
      await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{loggedIn:true,user:{id:'different-owner'}}})));
      await expect(mount).toBeHidden();await expect(buttons).toHaveCount(0);expect(mutations).toEqual([]);
}
module.exports.contractDocuments=contractDocuments;
