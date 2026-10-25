const fs = require('node:fs/promises');
const { mockPublicAppearance } = require('./appearance.js');

async function setup(page, { signedIn = false, configFailure = false } = {}) {
    const { validateConsumerDeclaration, declarationReceipt } = await import('../../workers/auth/src/lib/consumer-declarations.js');
    const unexpected = [], calls = [], stored = new Map(), inputs = new Map();
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
        if (inputs.has(body.requestId) && inputs.get(body.requestId) !== JSON.stringify(value)) return route.fulfill({ status: 409, json: { code: 'consumer_request_conflict' } });
        if (!stored.has(body.requestId)) {
            const id = `declaration-fixture-${stored.size + 1}`, receivedAt = new Date(Date.parse('2026-10-23T10:30:15.123Z') + stored.size * 1000).toISOString();
            inputs.set(body.requestId, JSON.stringify(value));
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
async function anotherDeclaration({ page, expect, locale, kind, state }) {
    const original = structuredClone(state.stored.get(state.calls[0].requestId));
    const button = page.getByRole('button', { name: locale === 'de' ? 'Weitere Erklärung einreichen' : 'Submit another declaration', exact: true });
    await expect(button).toBeVisible();
    await button.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('input[name=name]')).toBeFocused();
    await expect(page.locator('input[name=name]')).toHaveValue('');
    await expect(page.locator('input[name=email]')).toHaveValue('');
    await expect(page.locator('textarea[name=contractReference]')).toHaveValue('');
    await expect(page.locator('[data-new-declaration]')).toBeHidden();
    expect(await page.evaluate(key => sessionStorage.getItem(key), `bitbi:consumer-declaration:${kind}:v1`)).toBeNull();
    expect(state.calls).toHaveLength(1);
    await page.reload();
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('[data-receipt]')).toBeHidden();
    await expect(page.locator('form button[type=submit]')).toBeEnabled();
    await fill(page);
    await page.locator('textarea[name=contractReference]').fill('A second, distinct contract.');
    if (kind === 'cancellation') {
        await expect(page.locator('select[name=cancellationType]')).toHaveValue('ordinary');
        await expect(page.locator('select[name=endRequest]')).toHaveValue('earliest');
        await expect(page.locator('input[name=requestedEndDate]')).toBeDisabled();
    }
    await page.locator('form button[type=submit]').click();
    if (kind === 'withdrawal') {
        expect(state.calls).toHaveLength(1);
        await expect(page.locator('[data-review]')).toBeVisible();
        await page.locator('[data-confirm]').click();
    }
    await expect(page.locator('[data-receipt]')).toBeVisible();
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1].requestId).not.toBe(state.calls[0].requestId);
    expect(state.calls[1].contractReference).toBe('A second, distinct contract.');
    expect(state.stored.size).toBe(2);
    expect(state.stored.get(state.calls[0].requestId)).toEqual(original);
    const second = state.stored.get(state.calls[1].requestId);
    expect(second.id).not.toBe(original.id);
    await expect(page.locator('[data-receipt] dl')).toContainText(second.id);
    await expect(page.locator('[data-receipt] dl')).not.toContainText(original.id);
    await page.reload();
    await expect(page.locator('[data-receipt] dl')).toContainText(second.id);
    expect(state.calls).toHaveLength(2); expect(state.unexpected).toEqual([]);
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
    expect(document).toContain(state.stored.get(state.calls[0].requestId).id);
    expect(document).toContain('Creator purchase on 1 October');
    expect(document).toContain(locale === 'de' ? 'weder eine Erstattung' : 'does not confirm a refund');
    await page.reload();
    await expect(page.locator('[data-receipt]')).toBeVisible();
    expect(state.calls).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`consumer-withdrawal-${locale}.png`), fullPage: true });
    await anotherDeclaration({ page, expect, locale, kind: 'withdrawal', state });
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
    await expect(page.locator('[data-new-declaration]')).toBeHidden();
    // A hidden control cannot discard the unknown request even if invoked directly.
    await page.locator('[data-new-declaration]').evaluate(button => button.click());
    await expect(page.locator('form')).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bitbi:consumer-declaration:withdrawal:v1')).pending.requestId)).toBe(state.calls[0].requestId);
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
    await anotherDeclaration({ page, expect, locale, kind: 'cancellation', state });
}
async function unavailable({ page, expect, locale }) {
    const state = await setup(page, { configFailure: true });
    await page.goto(url(locale, 'withdrawal'));
    await expect(page.locator('[data-notice]')).toContainText(locale === 'de' ? 'vorübergehend nicht verfügbar' : 'temporarily unavailable');
    await expect(page.locator('form button[type=submit]')).toBeDisabled();
    await expect(page.locator('a[href="mailto:bit@bitbi.ai"]').first()).toBeVisible();
    expect(state.calls).toEqual([]); expect(state.unexpected).toEqual([]);
    for(const pagePath of [locale==='de'?'/de/':'/',locale==='de'?'/de/pricing.html':'/pricing.html',locale==='de'?'/de/account/profile.html':'/account/profile.html']) {
        await page.goto(pagePath);
        await expect(page.locator(`a[href="${url(locale,'withdrawal')}"], a[href="${url(locale,'cancellation')}"]`)).toHaveCount(0);
    }
    await page.goto(locale==='de'?'/de/account/credits.html':'/account/credits.html');
    await expect(page.locator('#creditsDenied')).toBeVisible();
    for(const kind of ['withdrawal','cancellation'])await expect(page.locator(`#creditsContractActions a[href="${url(locale,kind)}"]`)).toBeVisible();
    expect(state.calls).toEqual([]);expect(state.unexpected).toEqual([]);
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
      await expect(page.locator('[data-pricing-free-account] .pricing-card__tax-note')).toHaveCount(0);
      await expect(page.locator('.pricing-card__tax-note').first()).toHaveText(locale==='de'
        ? 'Alle Preise sind Endpreise. Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'
        : 'All prices are final prices. Pursuant to § 19 UStG, no VAT is charged.');
      await page.locator('[data-pricing-pack="live_credits_5000"]').click();
      await expect(page.locator('.pricing-legal')).toContainText(locale==='de'
        ? 'Mir ist bekannt, dass ich mit dieser Zustimmung mein Widerrufsrecht mit Beginn der Vertragsausführung verliere.'
        : 'add the credits to my account immediately');
      await expect(page.locator('.pricing-legal__check input').nth(1)).not.toBeChecked();
      await page.locator('[data-subscription-checkout]').click();
      const checks=page.locator('.pricing-legal__check input');
      await expect(checks).toHaveCount(2); await expect(checks.nth(0)).not.toBeChecked(); await expect(checks.nth(1)).not.toBeChecked();
      await expect(page.locator('.pricing-legal')).toContainText(locale==='de'?'verzichte ich nicht pauschal':'does not constitute a blanket waiver');
      await checks.nth(0).check(); await checks.nth(1).check();
      const stale = route => route.fulfill({status:409,json:{ok:false,code:'terms_version_outdated',error:'Reload the checkout to review the current terms before purchasing.'}});
      await page.route('**/api/account/billing/checkout/subscription', stale);
      await page.locator('.pricing-legal__checkout').click();
      await expect(page.locator('.pricing-legal')).toContainText(locale==='de'?'Bitte laden Sie die Seite neu':'Please reload the page');
      expect(checkoutRequests).toHaveLength(0);
      await page.unroute('**/api/account/billing/checkout/subscription', stale);
      await page.locator('.pricing-legal__checkout').click();
      await expect.poll(()=>checkoutRequests.length).toBe(1);
      expect(checkoutRequests[0].body).toMatchObject({terms_version:'2026-10-25',consentVersion:'consumer-v1',locale,earlyStartRequested:true,withdrawalKnowledgeAccepted:false});
}
module.exports.checkoutConsent=checkoutConsent;

async function checkoutAccountConsent({page,expect,locale,mockPricingAccount}) {
  const {checkoutRequests}=await mockPricingAccount(page,{role:'user',organizations:[]});
  const member=id=>({loggedIn:true,user:{id,role:'user',email:'synthetic@example.invalid'}});
  let response=member('pricing-owner-a'),status=200;
  await page.route('**/api/me',route=>route.fulfill({status,json:response}));
  await page.route('https://checkout.stripe.com/**',route=>route.fulfill({body:'Synthetic checkout'}));
  await page.goto(locale==='de'?'/de/pricing.html':'/pricing.html');
  const refresh=()=>page.evaluate(async()=>{await (await import('/js/shared/auth-state.js')).initAuth();});
  await expect.poll(()=>page.evaluate(async()=>(await import('/js/shared/auth-state.js')).getAuthState().user?.id)).toBe('pricing-owner-a');
  const checks=page.locator('.pricing-legal__check input');
  const pack=page.locator('[data-pricing-pack="live_credits_5000"]');
  const pro=page.locator('[data-subscription-checkout]');
  const setConsents=async()=>{await checks.nth(0).check();await checks.nth(1).check();};
  const checkConsents=async checked=>{for(const check of await checks.all())await expect(check).toBeChecked({checked});};
  await checkConsents(false);
  await setConsents(); // Remember Pro's distinct early-performance choice too.
  await pack.click();await expect(pack).toHaveAttribute('aria-pressed','true');
  await checks.nth(1).check();
  await refresh();await checkConsents(true); // The same confirmed actor keeps the draft.
  status=503;response={ok:false,error:'Synthetic connection loss'};await refresh();
  status=200;response=member('pricing-owner-a');await refresh();await checkConsents(true);
  response=member('pricing-owner-b');await refresh();
  await expect(pack).toHaveAttribute('aria-pressed','true');await checkConsents(false);
  await page.locator('.pricing-legal__checkout').click();expect(checkoutRequests).toHaveLength(0);
  await pro.click();await checkConsents(false); // A hidden Pro consent cannot cross accounts.
  await setConsents();
  response={loggedIn:false,user:null};await refresh();await checkConsents(false);
  response=member('pricing-owner-b');await refresh();await checkConsents(false);
  await pack.click();await expect(pack).toHaveAttribute('aria-pressed','true');await checkConsents(false);
  expect(checkoutRequests).toHaveLength(0);
}
module.exports.checkoutAccountConsent=checkoutAccountConsent;

async function contractDocuments({page,expect,locale,mockCreditsAccount}) {
      await mockCreditsAccount(page,{organizations:[]});
      const mutations=[];let pages=0;
      page.on('request',request=>{if(request.method()!=='GET'&&/\/api\/(?:account\/(?:billing|checkout)|orgs\/[^/]+\/billing|consumer\/declarations)/.test(new URL(request.url()).pathname))mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);});
      await page.route('**/api/consumer/declarations/config',route=>route.fulfill({json:{requireTurnstile:false}}));
      await page.route('**/api/account/billing/contracts**',route=>{
        if(route.request().method()!=='GET'){mutations.push(route.request().method());return route.abort();}
        const url=new URL(route.request().url());
        if(url.pathname.endsWith('/checkout_document_1'))return route.fulfill({json:{ok:true,document:{text:'Original terms 2026-10-23\nSynthetic purchased offer, EUR 9.99\nExplicit early-start; no automatic extinction.'}}});
        pages++;return route.fulfill({json:{ok:true,items:[{checkoutId:'checkout_document_1',offerName:'Creator <script>',createdAt:'2026-10-23T11:00:00.000Z'}],nextCursor:pages===1?'older-page':null}});
      });
      const creditsPath=locale==='de'?'/de/account/credits.html':'/account/credits.html',memberPath=creditsPath+'?scope=member';
      const nav=page.locator('#creditsContractActions');
      const actions=async host=>{
        await expect(nav).toHaveCount(1);await expect(page.locator(host).locator('#creditsContractActions')).toBeVisible();
        await expect(nav.getByRole('link')).toHaveCount(2);
        for(const kind of ['withdrawal','cancellation']){
          const link=nav.locator(`a[href="${url(locale,kind)}"]`);
          await expect(link).toBeVisible();await expect(link).toHaveClass(/\bbtn-secondary\b/);
        }
      };
      const membership=async state=>{
        await actions('.credits-subscription-actions');
        expect(await page.locator('.credits-subscription-actions').evaluate(node=>getComputedStyle(node).justifyContent)).toBe('flex-start');
        for(const width of [1440,390,320]){
          await page.setViewportSize({width,height:900});await nav.scrollIntoViewIfNeeded();
          for(const link of await nav.getByRole('link').all())await expect(link).toBeInViewport();
          expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
          if(width!==320)await page.screenshot({path:require('@playwright/test').test.info().outputPath(`credits-contract-${locale}-${state}-${width}.png`)});
        }
      };
      await page.goto(memberPath);
      const mount=page.locator('#creditsContractDocuments');await expect(mount).toBeVisible();
      const buttons=mount.locator('[data-contract-list] button');await expect(buttons).toHaveCount(1);await expect(buttons.first()).toContainText('Creator <script>');
      expect(await mount.locator('script').count()).toBe(0);
      await mount.locator('[data-contract-more]').click();await expect(mount.locator('[data-contract-more]')).toBeHidden();await expect(buttons).toHaveCount(1);
      const saved=page.waitForEvent('download');await buttons.first().click();const doc=await saved;
      expect(await fs.readFile(await doc.path(),'utf8')).toContain('Original terms 2026-10-23');
      await membership('no-subscription');await expect(page.locator('.credits-subscription-actions').getByRole('link',{name:locale==='de'?'Pläne ansehen':'View plans',exact:true})).toBeVisible();
      for(const kind of ['withdrawal','cancellation']){
        const link=nav.locator(`a[href="${url(locale,kind)}"]`);await link.focus();await expect(link).toBeFocused();await link.press('Enter');
        const destination=new URL(url(locale,kind),page.url());
        // The existing local serve handler canonicalizes .html to clean URLs.
        await expect(page).toHaveURL(value=>value.origin===destination.origin&&[destination.pathname,destination.pathname.replace(/\.html$/,'')].includes(value.pathname)&&!value.search&&!value.hash);
        await expect(page.locator(`[data-consumer-declaration="${kind}"]`)).toBeVisible();
        await page.goto(memberPath);await actions('.credits-subscription-actions');
      }
      await page.evaluate(()=>{window.consumerNavBeforeAccountChange=document.getElementById('creditsContractActions');});
      await page.evaluate(()=>document.dispatchEvent(new CustomEvent('bitbi:auth-change',{detail:{loggedIn:true,user:{id:'different-owner'}}})));
      await expect(mount).toBeHidden();await expect(buttons).toHaveCount(0);await actions('#creditsDenied');
      expect(await page.evaluate(()=>window.consumerNavBeforeAccountChange===document.getElementById('creditsContractActions'))).toBe(true);
      const expired=route=>route.fulfill({status:401,json:{ok:false,error:'Session expired.'}});
      await page.route('**/api/account/credits-dashboard*',expired);await page.goto(memberPath);await actions('#creditsDenied');await page.unroute('**/api/account/credits-dashboard*',expired);
      const anonymous=route=>route.fulfill({json:{loggedIn:false,user:null}});
      await page.route('**/api/me',anonymous);await page.reload();await actions('#creditsDenied');await page.unroute('**/api/me',anonymous);
      await mockCreditsAccount(page,{organizations:[],memberDashboard:{account:{userId:'user-credits-user',role:'user',status:'active'},balance:{totalCredits:6000,subscriptionCredits:6000,purchasedCredits:0},hasActiveSubscription:true,subscriptionStatus:'active',planName:'BITBI Pro',storageLimitBytes:5*1024**3,subscriptionPeriodEnd:'2026-11-23T00:00:00Z',liveCheckout:{enabled:true,configured:true},packs:[],purchaseHistory:[],transactions:[]}});
      await page.goto(memberPath);await membership('active');await expect(page.locator('[data-subscription-action="cancel"]')).toBeVisible();
      const unavailable=route=>route.fulfill({status:503,json:{ok:false,error:'Synthetic credits outage.'}});
      await page.route('**/api/account/credits-dashboard*',unavailable);await page.reload();await actions('#creditsError');await expect(mount).toBeHidden();await page.unroute('**/api/account/credits-dashboard*',unavailable);
      await mockCreditsAccount(page);await page.goto(creditsPath);await actions('#creditsPacksSection');await expect(page.locator('#creditsSubscriptionSection')).toBeHidden();
      expect(mutations).toEqual([]);
}
module.exports.contractDocuments=contractDocuments;

module.exports.cachedCreditsTerms = async function cachedCreditsTerms({ page, expect, checkoutRequests }) {
    await page.locator('#creditsTermsAccepted').check();
    await page.locator('#creditsImmediateDeliveryAccepted').check();
    const pattern = '**/api/orgs/*/billing/checkout/live-credit-pack';
    const outdated = route => route.fulfill({status:409,json:{ok:false,code:'terms_version_outdated'}});
    await page.route(pattern, outdated);
    try {
        await page.locator('[data-checkout-pack="live_credits_5000"]').click();
        await expect(page.locator('.credits-legal__error')).toBeVisible();
        await expect(page.locator('.credits-legal__error')).toContainText('Please reload the page and review the current terms');
        await expect(page.locator('#creditsDashboard')).toBeVisible();
        expect(checkoutRequests).toHaveLength(0);
    } finally {
        await page.unroute(pattern, outdated);
    }
};

module.exports.legalDocuments = async function legalDocuments({ page, expect, locale }) {
    const state = await setup(page);
    const privacy = locale === 'de' ? '/de/legal/datenschutz.html' : '/legal/privacy.html';
    const terms = locale === 'de' ? '/de/legal/terms.html' : '/legal/terms.html';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${privacy}#website-assistant`);
    await expect(page.locator('#website-assistant h2')).toContainText('5a.');
    await expect(page.locator('#website-assistant')).toBeInViewport();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('main')).not.toContainText(/\[(?:P|V)\d|ARBEITSENTWURF|WORKING DRAFT|EFFECTIVE_DATE/);
    const region = page.locator('.policy-table-wrap').nth(1);
    await expect(region).toHaveAttribute('role', 'region');
    await expect(region).toHaveAttribute('aria-label', /\S/);
    await region.focus();
    await expect(region).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBe(64);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBe(0);
    await page.keyboard.press('End');
    const end = await region.evaluate(element => ({ left: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth }));
    expect(Math.abs(end.left - end.maximum)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Home');
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Independent detached-region control proves listener cleanup and that only
    // the region itself (never descendants, modifiers or unrelated keys) handles input.
    const control = await page.evaluate(async () => {
        const source = [...document.scripts].map(script => script.textContent).join('\n').match(/from '(\/js\/pages\/legal\/tables\.js\?v=[^']+)'/)[1];
        const { initLegalTables } = await import(source);
        const root = document.createElement('div'), table = document.createElement('div');
        table.className = 'policy-table-wrap'; table.tabIndex = 0;
        table.style.cssText = 'width:100px;overflow:auto';
        const wide = document.createElement('input'); wide.style.width = '500px';
        table.append(wide); root.append(table); document.body.append(root);
        const send = (target, key, extra = {}) => {
            const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
            target.dispatchEvent(event); return event.defaultPrevented;
        };
        const before = send(table, 'ArrowRight');
        const clean = initLegalTables(root);
        const handled = send(table, 'ArrowRight'), moved = table.scrollLeft;
        const input = send(wide, 'ArrowLeft'), modifier = send(table, 'ArrowLeft', { ctrlKey: true });
        const other = send(table, 'ArrowDown');
        clean(); const removed = send(table, 'ArrowRight'), after = table.scrollLeft;
        root.remove(); return { before, handled, moved, input, modifier, other, removed, after };
    });
    expect(control).toEqual({ before: false, handled: true, moved: 64, input: false, modifier: false, other: false, removed: false, after: 64 });
    await page.goto(terms);
    await expect(page.locator('main')).not.toContainText(/\[(?:P|V)\d|ARBEITSENTWURF|WORKING DRAFT|EFFECTIVE_DATE/);
    await expect(page.locator(`main a[href="${url(locale, 'withdrawal')}"]`).first()).toBeVisible();
    await expect(page.locator(`main a[href="${url(locale, 'cancellation')}"]`).first()).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (locale === 'de') {
        await page.context().addCookies([{ name: 'bitbi_locale', value: 'en', url: 'http://localhost:3000' }]);
        await page.goto('/legal/datenschutz.html');
        expect(await page.evaluate(async () => (await import('/js/shared/locale.js')).getCurrentLocale())).toBe('de');
        await expect(page.locator('header #navbar')).toHaveAttribute('aria-label', 'Hauptnavigation');
        await expect(page.locator('header .site-nav__logo')).toHaveAttribute('href', '/de/');
        await expect(page.locator('.site-footer__link[href="/de/legal/terms.html"]')).toHaveText('AGB');
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://bitbi.ai/legal/datenschutz.html');
        const english = page.locator('.locale-switcher__link[hreflang="en"]').first();
        await expect(english).toHaveAttribute('href', '/legal/privacy.html');
        await english.click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.locator('header #navbar')).toHaveAttribute('aria-label', 'Main navigation');
    }
    expect(state.unexpected).toEqual([]);
    expect(state.calls).toEqual([]);
};
