const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadLocaleRouting() {
  return import(pathToFileURL(path.join(__dirname, '..', 'js/shared/locale-routing.mjs')).href);
}

async function seedCookieConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'bitbi_cookie_consent',
      JSON.stringify({
        v: '1',
        ts: Date.now(),
        necessary: true,
        analytics: false,
        marketing: false,
      }),
    );
  });
}

function repoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function visibleHtmlText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function uiHtmlText(html) {
  const attrText = [...html.matchAll(/\b(?:placeholder|aria-label|title|alt|value)="([^"]*)"/g)]
    .map((match) => match[1])
    .join(' ');
  return `${visibleHtmlText(html)} ${attrText}`.replace(/\s+/g, ' ');
}

function listHtmlFiles(dir) {
  const root = path.join(__dirname, '..', dir);
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtmlFiles(relative));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(relative.replace(/\\/g, '/'));
  }
  return out;
}

function criticalAttributes(html) {
  const attributes = [
    'id',
    'for',
    'aria-controls',
    'aria-labelledby',
    'aria-describedby',
    'data-action',
    'data-category-link',
    'data-auth-entry',
    'data-auth-message-key',
    'data-auth-message-target',
    'data-field',
    'data-mode',
    'data-models-link',
    'data-nav',
    'data-section',
    'data-tab',
    'data-target',
    'name',
  ];
  const pattern = new RegExp(`\\b(${attributes.join('|')})="([^"]*)"`, 'g');
  return [...html.matchAll(pattern)].map((match) => `${match[1]}=${match[2]}`).sort();
}

test.describe('Bilingual locale pages', () => {
  test('visibleHtmlText strips hidden blocks with whitespace-tolerant closing tags', () => {
    const html = [
      '<p>Visible copy</p>',
      '<!-- Hidden comment -->',
      '<script type="application/json">Hidden script copy</script >',
      '<style media="screen">Hidden style copy</style >',
      '<svg aria-hidden="true"><text>Hidden svg copy</text></svg >',
      '<p>Readable <strong>text</strong></p>',
    ].join('');
    const text = visibleHtmlText(html);

    expect(text).toContain('Visible copy');
    expect(text).toContain('Readable text');
    expect(text).not.toContain('Hidden comment');
    expect(text).not.toContain('Hidden script copy');
    expect(text).not.toContain('Hidden style copy');
    expect(text).not.toContain('Hidden svg copy');
  });

  test('English and German root pages expose the expected lang attributes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#hero')).toContainText('Start creating from the public site');
    await expect(page.locator('#hero')).toContainText('Backend credit checks');
    await expect(page.locator('#hero a[href="/pricing.html#pricingJourney"]')).toContainText('Compare credits');
    await expect(page.locator('#hero a[href="/account/profile.html?source=hero#memberControlCenter"]')).toContainText('Open workspace');
    await expect(page.locator('#publicMemberJourney')).toContainText('From first idea to saved workspace');
    await expect(page.locator('#publicMemberJourney')).toContainText('Start in Generate Lab');
    await expect(page.locator('#publicMemberJourney a[href="/pricing.html#pricingJourney"]')).toContainText('View credits and Pro');
    await expect(page.locator('#publicMemberJourney')).toContainText('Create with an account, browse without one');
    await expect(page.locator('#publicMemberJourney [data-auth-entry="login"]')).toContainText('Sign in');
    await expect(page.locator('#publicMemberJourney a[href="/account/forgot-password.html?source=landing-account"]')).toContainText('Reset password');

    await page.goto('/de/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('#hero')).toContainText('Direkt von der öffentlichen Seite starten');
    await expect(page.locator('#hero')).toContainText('Backend prüft Credits');
    await expect(page.locator('#hero a[href="/de/pricing.html#pricingJourney"]')).toContainText('Credits vergleichen');
    await expect(page.locator('#hero a[href="/de/account/profile.html?source=hero#memberControlCenter"]')).toContainText('Arbeitsbereich öffnen');
    await expect(page.locator('#publicMemberJourney')).toContainText('Von der ersten Idee zum gespeicherten Arbeitsbereich');
    await expect(page.locator('#publicMemberJourney')).toContainText('Im Generate Lab starten');
    await expect(page.locator('#publicMemberJourney a[href="/de/pricing.html#pricingJourney"]')).toContainText('Credits und Pro ansehen');
    await expect(page.locator('#publicMemberJourney')).toContainText('Mit Konto erstellen, ohne Konto stöbern');
    await expect(page.locator('#publicMemberJourney [data-auth-entry="login"]')).toContainText('Anmelden');
    await expect(page.locator('#publicMemberJourney a[href="/de/account/forgot-password.html?source=landing-account"]')).toContainText('Passwort zurücksetzen');
  });

  test('English and German homepages include the localized Live Pulse mount and reduced-motion CSS', () => {
    const enHome = repoFile('index.html');
    const deHome = repoFile('de/index.html');
    const css = repoFile('css/components/news-pulse.css');

    expect(enHome).toContain('data-news-pulse-locale="en"');
    expect(enHome).toContain('aria-label="Bitbi Live Pulse"');
    expect(enHome).toContain('css/components/news-pulse.css');
    expect(enHome).toMatch(/<section id="hero"[\s\S]*<section id="newsPulse"[\s\S]*<\/section>[\s\S]*<\/section>/);
    expect(deHome).toContain('data-news-pulse-locale="de"');
    expect(deHome).toContain('aria-label="KI-Puls"');
    expect(deHome).toContain('../css/components/news-pulse.css');
    expect(deHome).toMatch(/<section id="hero"[\s\S]*<section id="newsPulse"[\s\S]*<\/section>[\s\S]*<\/section>/);
    expect(css).toContain('position: absolute');
    expect(css).toContain('news-pulse-wheel');
    expect(css).toContain('news-pulse--mobile');
    expect(css).toContain('news-pulse-mobile-cube-turn');
    expect(css).toContain('@media (max-width: 1023px)');
    expect(css).toContain('visibility: hidden');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none');
  });

  test('pricing pages render English and German copy', async ({ page }) => {
    await page.goto('/pricing.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'BITBI Credits & Pro' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Flexible credits for image, video, music, and asset generation.');
    await expect(page.locator('main')).toContainText('Secure payment continues on pay.bitbi.ai.');
    await expect(page.locator('.pricing-hero__link[href="/generate-lab/?source=pricing-hero&step=create"]')).toContainText('Start creating');
    await expect(page.locator('.pricing-hero__link[href="#pricingOffers"]')).toContainText('Choose credits');
    await expect(page.locator('.pricing-hero__link[href="#pricingDecision"]')).toContainText('Compare options');
    await expect(page.getByRole('heading', { name: 'Pick the option that fits today' })).toBeVisible();
    await expect(page.locator('#pricingDecision')).toContainText('Create every week');
    await expect(page.getByRole('heading', { name: 'From pricing to the workspace' })).toBeVisible();
    await expect(page.locator('#pricingJourney')).toContainText('Sign in, review credits, create in Generate Lab');
    await expect(page.locator('#pricingJourney a[href="/generate-lab/?source=pricing&step=create"]')).toContainText('Open Generate Lab');
    await expect(page.locator('#pricingJourney a[href="/account/assets-manager.html?source=pricing&recent=1#generate-lab-recent"]')).toContainText('View Assets Manager');
    await expect(page.getByRole('heading', { name: 'From plan choice to the next prompt' })).toBeVisible();
    await expect(page.locator('#pricingContinuity')).toContainText('Before you generate');
    await expect(page.locator('#pricingContinuity a[href="/generate-lab/?source=pricing-continuity&step=create"]')).toContainText('Create in Generate Lab');
    await expect(page.locator('#pricingContinuity a[href="/account/credits.html?source=pricing-continuity"]')).toContainText('Review credits');
    await expect(page.locator('#pricingContinuity a[href="/account/assets-manager.html?source=pricing-continuity&recent=1#generate-lab-recent"]')).toContainText('Find saved output');
    await expect(page.getByRole('heading', { name: 'Set up the account path before checkout' })).toBeVisible();
    await expect(page.locator('#pricingAccountEntry')).toContainText('Buying credits, saving generated output, and recovering workspace access require a BITBI account');
    await expect(page.locator('#pricingAccountEntry a[href="/account/forgot-password.html?source=pricing-account"]')).toContainText('Reset password');
    await expect(page.locator('main')).toContainText('Choose how you want to create');
    await expect(page.locator('.site-footer__links')).toContainText('Privacy');

    await page.goto('/de/pricing.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { name: 'BITBI Credits & Pro' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Flexible Credits für Bild-, Video-, Musik- und Asset-Generierung.');
    await expect(page.locator('main')).toContainText('Die sichere Zahlung wird auf pay.bitbi.ai fortgesetzt.');
    await expect(page.locator('.pricing-hero__link[href="/de/generate-lab/?source=pricing-hero&step=create"]')).toContainText('Jetzt erstellen');
    await expect(page.locator('.pricing-hero__link[href="#pricingOffers"]')).toContainText('Credits wählen');
    await expect(page.locator('.pricing-hero__link[href="#pricingDecision"]')).toContainText('Optionen vergleichen');
    await expect(page.getByRole('heading', { name: 'Wählen Sie die passende Option für heute' })).toBeVisible();
    await expect(page.locator('#pricingDecision')).toContainText('Jede Woche erstellen');
    await expect(page.getByRole('heading', { name: 'Von Preisen in den Arbeitsbereich' })).toBeVisible();
    await expect(page.locator('#pricingJourney')).toContainText('Melden Sie sich an, prüfen Sie Credits');
    await expect(page.locator('#pricingJourney a[href="/de/generate-lab/?source=pricing&step=create"]')).toContainText('Generate Lab öffnen');
    await expect(page.locator('#pricingJourney a[href="/de/account/assets-manager.html?source=pricing&recent=1#generate-lab-recent"]')).toContainText('Assets Manager anzeigen');
    await expect(page.getByRole('heading', { name: 'Von der Auswahl zum nächsten Prompt' })).toBeVisible();
    await expect(page.locator('#pricingContinuity')).toContainText('Vor der Generierung');
    await expect(page.locator('#pricingContinuity a[href="/de/generate-lab/?source=pricing-continuity&step=create"]')).toContainText('Im Generate Lab erstellen');
    await expect(page.locator('#pricingContinuity a[href="/de/account/credits.html?source=pricing-continuity"]')).toContainText('Credits prüfen');
    await expect(page.locator('#pricingContinuity a[href="/de/account/assets-manager.html?source=pricing-continuity&recent=1#generate-lab-recent"]')).toContainText('Gespeicherte Ergebnisse finden');
    await expect(page.getByRole('heading', { name: 'Kontopfad vor dem Checkout klären' })).toBeVisible();
    await expect(page.locator('#pricingAccountEntry')).toContainText('Credits kaufen, generierte Ergebnisse speichern und den Arbeitsbereich wiederherstellen erfordern ein BITBI-Konto');
    await expect(page.locator('#pricingAccountEntry a[href="/de/account/forgot-password.html?source=pricing-account"]')).toContainText('Passwort zurücksetzen');
    await expect(page.locator('main')).toContainText('Wählen Sie, wie Sie erstellen möchten');
    await expect(page.locator('.site-footer__links')).toContainText('Datenschutz');
  });

  test('pricing checkout scripts avoid deprecated Stripe redirect helpers', () => {
    const pricingScript = repoFile('js/pages/pricing/main.js');
    const creditsScript = repoFile('js/pages/credits/main.js');
    expect(`${pricingScript}\n${creditsScript}`).not.toContain('redirectToCheckout');
    expect(pricingScript).toContain('https://pay.bitbi.ai');
    expect(pricingScript).not.toContain('/api/admin');
    expect(creditsScript).toContain('https://pay.bitbi.ai');
  });

  test('account credits pages expose canonical and hreflang metadata parity', () => {
    const enCredits = repoFile('account/credits.html');
    const deCredits = repoFile('de/account/credits.html');
    expect(enCredits).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(deCredits).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(enCredits).toContain('<link rel="canonical" href="https://bitbi.ai/account/credits.html">');
    expect(enCredits).toContain('<link rel="alternate" hreflang="en" href="https://bitbi.ai/account/credits.html">');
    expect(enCredits).toContain('<link rel="alternate" hreflang="de" href="https://bitbi.ai/de/account/credits.html">');
    expect(enCredits).toContain('<link rel="alternate" hreflang="x-default" href="https://bitbi.ai/account/credits.html">');
    expect(enCredits).toContain('Credits dashboard');
    expect(enCredits).toContain('Review personal credits, BITBI Pro status, one-time packs, and organization checkout access when available.');
    expect(deCredits).toContain('<link rel="canonical" href="https://bitbi.ai/de/account/credits.html">');
    expect(deCredits).toContain('<link rel="alternate" hreflang="en" href="https://bitbi.ai/account/credits.html">');
    expect(deCredits).toContain('<link rel="alternate" hreflang="de" href="https://bitbi.ai/de/account/credits.html">');
    expect(deCredits).toContain('<link rel="alternate" hreflang="x-default" href="https://bitbi.ai/account/credits.html">');
    expect(deCredits).toContain('Credits-Dashboard');
    expect(deCredits).toContain('Prüfen Sie persönliche Credits, BITBI-Pro-Status, einmalige Pakete und Organisations-Checkout-Zugriff, wenn verfügbar.');
  });

  test('member workspace navigation keeps English and German routes equivalent', () => {
    const enProfile = repoFile('account/profile.html');
    const deProfile = repoFile('de/account/profile.html');
    const enCredits = repoFile('account/credits.html');
    const deCredits = repoFile('de/account/credits.html');
    const enAssets = repoFile('account/assets-manager.html');
    const deAssets = repoFile('de/account/assets-manager.html');
    const enGenerate = repoFile('generate-lab/index.html');
    const deGenerate = repoFile('de/generate-lab/index.html');

    expect(enProfile).toContain('id="memberControlCenter"');
    expect(enProfile).toContain('Member Control Center');
    expect(enProfile).toContain('href="../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(enProfile).toContain('id="profileWorkspacePriority"');
    expect(enProfile).toContain('Workspace priority');
    expect(enProfile).toContain('Start with the next useful action');
    expect(enProfile).toContain('href="/generate-lab/?source=profile&amp;step=next"');
    expect(enProfile).toContain('href="/account/assets-manager.html?source=profile&amp;recent=1#generate-lab-recent"');
    expect(enProfile).toContain('href="/generate-lab/"');
    expect(enProfile).toContain('Suggested first-run steps');
    expect(enProfile).toContain('href="/generate-lab/?source=profile"');
    expect(enProfile).toContain('href="/account/assets-manager.html?source=profile"');
    expect(enProfile).toContain('href="/account/assets-manager.html"');
    expect(enProfile).toContain('href="/account/credits.html?scope=member"');
    expect(enProfile).toContain('href="#profileForm"');
    expect(enProfile).toContain('id="profileSecurityCard"');
    expect(enProfile).toContain('Account security');
    expect(enProfile).toContain('Your signed-in profile is the source of truth for account status.');
    expect(enProfile).toContain('id="securityEmailStatus"');
    expect(enProfile).toContain('id="securityReverifyBtn"');
    expect(enProfile).toContain('href="/account/forgot-password.html"');
    expect(enProfile).toContain('id="profileCompletionCard"');
    expect(enProfile).toContain('Account completion');
    expect(enProfile).toContain('Profile quality');
    expect(enProfile).toContain('id="completionWalletStatus"');
    expect(enProfile).toContain('Wallet linking is optional and never requires sharing private keys.');
    expect(enProfile).toContain('id="walletTrustStatus"');
    expect(enProfile).toContain('Wallet trust notes');
    expect(enProfile).toContain('not wallet custody');
    expect(enProfile).toContain('id="profileEditState"');
    expect(enProfile).toContain('Display name, bio, website, and avatar are editable.');
    expect(enProfile).toContain('Sign in to open your profile');
    expect(enProfile).toContain('data-auth-message-key="authRecovery.profileMessage"');
    expect(enProfile).toContain('href="/account/forgot-password.html"');

    expect(deProfile).toContain('id="memberControlCenter"');
    expect(deProfile).toContain('Mitglieder-Kontrollzentrum');
    expect(deProfile).toContain('href="../../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(deProfile).toContain('id="profileWorkspacePriority"');
    expect(deProfile).toContain('Arbeitsbereich-Priorität');
    expect(deProfile).toContain('Mit der sinnvollsten nächsten Aktion starten');
    expect(deProfile).toContain('href="/de/generate-lab/?source=profile&amp;step=next"');
    expect(deProfile).toContain('href="/de/account/assets-manager.html?source=profile&amp;recent=1#generate-lab-recent"');
    expect(deProfile).toContain('href="/de/generate-lab/"');
    expect(deProfile).toContain('Empfohlene erste Schritte');
    expect(deProfile).toContain('href="/de/generate-lab/?source=profile"');
    expect(deProfile).toContain('href="/de/account/assets-manager.html?source=profile"');
    expect(deProfile).toContain('href="/de/account/assets-manager.html"');
    expect(deProfile).toContain('href="/de/account/credits.html?scope=member"');
    expect(deProfile).toContain('href="#profileForm"');
    expect(deProfile).toContain('id="profileSecurityCard"');
    expect(deProfile).toContain('Kontosicherheit');
    expect(deProfile).toContain('Ihr angemeldetes Profil ist die Quelle der Wahrheit für den Kontostatus.');
    expect(deProfile).toContain('id="securityEmailStatus"');
    expect(deProfile).toContain('id="securityReverifyBtn"');
    expect(deProfile).toContain('href="/de/account/forgot-password.html"');
    expect(deProfile).toContain('id="profileCompletionCard"');
    expect(deProfile).toContain('Kontovervollständigung');
    expect(deProfile).toContain('Profilqualität');
    expect(deProfile).toContain('id="completionWalletStatus"');
    expect(deProfile).toContain('Wallet-Verknüpfung ist optional und erfordert niemals private Schlüssel.');
    expect(deProfile).toContain('id="walletTrustStatus"');
    expect(deProfile).toContain('Hinweise zum Wallet-Vertrauen');
    expect(deProfile).toContain('keine Wallet-Verwahrung');
    expect(deProfile).toContain('id="profileEditState"');
    expect(deProfile).toContain('Anzeigename, Bio, Website und Avatar sind bearbeitbar.');
    expect(deProfile).toContain('Anmelden, um Ihr Profil zu öffnen');
    expect(deProfile).toContain('data-auth-message-key="authRecovery.profileMessage"');
    expect(deProfile).toContain('href="/de/account/forgot-password.html"');

    expect(enCredits).toContain('credits-workspace-nav');
    expect(enCredits).toContain('id="creditsWorkspacePriority"');
    expect(enCredits).toContain('Use credits before the next generation');
    expect(enCredits).toContain('href="/generate-lab/?source=credits&amp;step=create"');
    expect(enCredits).toContain('href="/account/profile.html?returnContext=credits#profileSecurityCard"');
    expect(enCredits).toContain('Keep creating from your credits context');
    expect(enCredits).toContain('credits-onboarding');
    expect(enCredits).toContain('How credits fit into creation');
    expect(enCredits).toContain('href="/generate-lab/"');
    expect(enCredits).toContain('href="/generate-lab/?source=credits"');
    expect(enCredits).toContain('href="/account/assets-manager.html"');
    expect(enCredits).toContain('href="/account/assets-manager.html?source=credits"');
    expect(enCredits).toContain('href="/account/profile.html"');
    expect(enCredits).toContain('Sign in to review credits');
    expect(enCredits).toContain('data-auth-message-key="authRecovery.creditsMessage"');
    expect(enCredits).toContain('href="/account/forgot-password.html"');

    expect(deCredits).toContain('credits-workspace-nav');
    expect(deCredits).toContain('id="creditsWorkspacePriority"');
    expect(deCredits).toContain('Credits vor der nächsten Generierung nutzen');
    expect(deCredits).toContain('href="/de/generate-lab/?source=credits&amp;step=create"');
    expect(deCredits).toContain('href="/de/account/profile.html?returnContext=credits#profileSecurityCard"');
    expect(deCredits).toContain('Aus dem Credits-Kontext weiter erstellen');
    expect(deCredits).toContain('credits-onboarding');
    expect(deCredits).toContain('So passen Credits zur Erstellung');
    expect(deCredits).toContain('href="/de/generate-lab/"');
    expect(deCredits).toContain('href="/de/generate-lab/?source=credits"');
    expect(deCredits).toContain('href="/de/account/assets-manager.html"');
    expect(deCredits).toContain('href="/de/account/assets-manager.html?source=credits"');
    expect(deCredits).toContain('href="/de/account/profile.html"');
    expect(deCredits).toContain('Anmelden, um Credits zu prüfen');
    expect(deCredits).toContain('data-auth-message-key="authRecovery.creditsMessage"');
    expect(deCredits).toContain('href="/de/account/forgot-password.html"');

    expect(enAssets).toContain('assets-manager__workspace-nav');
    expect(enAssets).toContain('id="assetsWorkspacePriority"');
    expect(enAssets).toContain('Keep the library moving');
    expect(enAssets).toContain('href="#studioGalleryFilter"');
    expect(enAssets).toContain('href="/generate-lab/?source=assets-manager&amp;step=create"');
    expect(enAssets).toContain('href="/account/profile.html?returnContext=assets-manager#profileCompletionCard"');
    expect(enAssets).toContain('Move between creation, credits, and profile');
    expect(enAssets).toContain('assets-manager__first-run');
    expect(enAssets).toContain('Your library starts after you save from Generate Lab');
    expect(enAssets).toContain('href="/generate-lab/"');
    expect(enAssets).toContain('href="/generate-lab/?source=assets-manager"');
    expect(enAssets).toContain('href="/account/credits.html?scope=member"');
    expect(enAssets).toContain('href="/account/profile.html"');
    expect(enAssets).toContain('Sign in to open Assets Manager');
    expect(enAssets).toContain('data-auth-message-key="authRecovery.assetsMessage"');
    expect(enAssets).toContain('href="/account/forgot-password.html"');

    expect(deAssets).toContain('assets-manager__workspace-nav');
    expect(deAssets).toContain('id="assetsWorkspacePriority"');
    expect(deAssets).toContain('Die Bibliothek in Bewegung halten');
    expect(deAssets).toContain('href="#studioGalleryFilter"');
    expect(deAssets).toContain('href="/de/generate-lab/?source=assets-manager&amp;step=create"');
    expect(deAssets).toContain('href="/de/account/profile.html?returnContext=assets-manager#profileCompletionCard"');
    expect(deAssets).toContain('Zwischen Erstellung, Credits und Profil wechseln');
    expect(deAssets).toContain('assets-manager__first-run');
    expect(deAssets).toContain('Ihre Bibliothek beginnt nach dem Speichern aus Generate Lab');
    expect(deAssets).toContain('href="/de/generate-lab/"');
    expect(deAssets).toContain('href="/de/generate-lab/?source=assets-manager"');
    expect(deAssets).toContain('href="/de/account/credits.html?scope=member"');
    expect(deAssets).toContain('href="/de/account/profile.html"');
    expect(deAssets).toContain('Anmelden, um den Assets Manager zu öffnen');
    expect(deAssets).toContain('data-auth-message-key="authRecovery.assetsMessage"');
    expect(deAssets).toContain('href="/de/account/forgot-password.html"');

    expect(enGenerate).toContain('generate-lab__member-nav');
    expect(enGenerate).toContain('id="generateWorkspacePriority"');
    expect(enGenerate).toContain('Prepare, generate, save, manage');
    expect(enGenerate).toContain('href="#labCost"');
    expect(enGenerate).toContain('href="#labGenerate"');
    expect(enGenerate).toContain('href="/account/profile.html?returnContext=generate-lab#profileSecurityCard"');
    expect(enGenerate).toContain('generate-lab__first-run');
    expect(enGenerate).toContain('generate-lab__account-needed');
    expect(enGenerate).toContain('Create, preview, save, then manage');
    expect(enGenerate).toContain('Sign in before generation or saving');
    expect(enGenerate).toContain('data-auth-message-key="authRecovery.generateMessage"');
    expect(enGenerate).toContain('href="/account/profile.html?returnContext=generate-lab"');
    expect(enGenerate).toContain('href="/account/credits.html?scope=member"');
    expect(enGenerate).toContain('href="/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent"');
    expect(enGenerate).toContain('href="/account/forgot-password.html"');

    expect(deGenerate).toContain('generate-lab__member-nav');
    expect(deGenerate).toContain('id="generateWorkspacePriority"');
    expect(deGenerate).toContain('Vorbereiten, generieren, speichern, verwalten');
    expect(deGenerate).toContain('href="#labCost"');
    expect(deGenerate).toContain('href="#labGenerate"');
    expect(deGenerate).toContain('href="/de/account/profile.html?returnContext=generate-lab#profileSecurityCard"');
    expect(deGenerate).toContain('generate-lab__first-run');
    expect(deGenerate).toContain('generate-lab__account-needed');
    expect(deGenerate).toContain('Erstellen, prüfen, speichern, verwalten');
    expect(deGenerate).toContain('Vor Generierung oder Speichern anmelden');
    expect(deGenerate).toContain('data-auth-message-key="authRecovery.generateMessage"');
    expect(deGenerate).toContain('href="/de/account/profile.html?returnContext=generate-lab"');
    expect(deGenerate).toContain('href="/de/account/credits.html?scope=member"');
    expect(deGenerate).toContain('href="/de/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent"');
    expect(deGenerate).toContain('href="/de/account/forgot-password.html"');

    for (const html of [deProfile, deCredits, deAssets, deGenerate]) {
      expect(html).not.toContain('/de/admin');
    }
  });

  test('account recovery and verification pages provide localized trust guidance', () => {
    const enForgot = repoFile('account/forgot-password.html');
    const deForgot = repoFile('de/account/forgot-password.html');
    const enReset = repoFile('account/reset-password.html');
    const deReset = repoFile('de/account/reset-password.html');
    const enVerify = repoFile('account/verify-email.html');
    const deVerify = repoFile('de/account/verify-email.html');

    expect(enForgot).toContain('id="accountRecoveryTrust"');
    expect(enForgot).toContain('Account recovery is private');
    expect(enForgot).toContain('same success message whether or not an email exists');
    expect(deForgot).toContain('id="accountRecoveryTrust"');
    expect(deForgot).toContain('Kontowiederherstellung bleibt privat');
    expect(deForgot).toContain('dieselbe Erfolgsmeldung, unabhängig davon, ob eine E-Mail existiert');

    expect(enReset).toContain('id="resetSecurityTrust"');
    expect(enReset).toContain('Before you change it');
    expect(enReset).toContain('data-auth-entry="login"');
    expect(enReset).toContain('href="/account/profile.html"');
    expect(deReset).toContain('id="resetSecurityTrust"');
    expect(deReset).toContain('Bevor Sie es ändern');
    expect(deReset).toContain('data-auth-entry="login"');
    expect(deReset).toContain('href="/de/account/profile.html"');

    expect(enVerify).toContain('Email confirmation is checked by the backend account record');
    expect(enVerify).toContain('href="/account/forgot-password.html"');
    expect(enVerify).toContain('href="/account/profile.html"');
    expect(deVerify).toContain('Die E-Mail-Bestätigung wird im Backend-Kontodatensatz geprüft');
    expect(deVerify).toContain('href="/de/account/forgot-password.html"');
    expect(deVerify).toContain('href="/de/account/profile.html"');

    for (const html of [deForgot, deReset, deVerify]) {
      expect(html).not.toContain('/de/admin');
    }
  });

  test('language switcher maps equivalent pages, preserves query strings, and stores preference', async ({ page }) => {
    await page.goto('/generate-lab/?source=locale-test');
    const deLink = page.locator('.locale-switcher__link[hreflang="de"]').first();
    await expect(deLink).toHaveAttribute('href', '/de/generate-lab/?source=locale-test');
    await deLink.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/de/generate-lab/');
    await expect.poll(() => new URL(page.url()).search).toBe('?source=locale-test');
    await expect.poll(() => page.evaluate(() => document.cookie)).toContain('bitbi_locale=de');

    const enLink = page.locator('.locale-switcher__link[hreflang="en"]').first();
    await expect(enLink).toHaveAttribute('href', '/generate-lab/?source=locale-test');
  });

  test('Models overlay localizes desktop triggers on English and German homepages', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto('/');
    await expect(page.locator('[data-models-link="desktop"]')).toHaveAttribute('aria-label', 'Open Models');
    await page.locator('[data-models-link="desktop"]').click();
    let overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'BILDGENERIERUNG' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Close models' })).toBeVisible();
    await expect(
      overlay.locator('.models-overlay__card').filter({ hasText: 'GPT Image 2' }).locator('.models-overlay__status'),
    ).toHaveText('LIVE');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    await expect(overlay).not.toHaveClass(/is-active/);

    await page.goto('/de/');
    await expect(page.locator('[data-models-link="desktop"]')).toHaveAttribute('aria-label', 'Modelle öffnen');
    await page.locator('[data-models-link="desktop"]').click();
    overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'KI-Modelle');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'BILDGENERIERUNG',
      'MUSIKGENERIERUNG',
      'VIDEOGENERIERUNG',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'IMAGE GENERATION' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Modelle schließen' })).toBeVisible();
    await expect(
      overlay.locator('.models-overlay__card').filter({ hasText: 'FLUX.2 Klein 9B' }).locator('.models-overlay__status'),
    ).toHaveText('LIVE');
    await expect(
      overlay.locator('.models-overlay__card').filter({ hasText: 'Vidu Q3 Pro' }).locator('.models-overlay__status'),
    ).toHaveText('Demnächst');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    await expect(overlay).not.toHaveClass(/is-active/);
  });

  test('Models overlay localizes mobile menu triggers and closes the mobile panel', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/');
    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();
    let overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);
    await expect(overlay.getByRole('button', { name: 'Close models' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');

    await page.goto('/de/');
    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#mobileNav').getByRole('button', { name: 'Modelle' }).click();
    overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'KI-Modelle');
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'BILDGENERIERUNG',
      'MUSIKGENERIERUNG',
      'VIDEOGENERIERUNG',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'IMAGE GENERATION' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Modelle schließen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  });

  test('mobile navigation labels stay localized in English and German', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/');
    await page.locator('#mobileMenuBtn').click();
    let mobileNav = page.locator('#mobileNav');
    await expect(mobileNav).toHaveAttribute('aria-label', 'Navigation menu');
    await expect(mobileNav).toContainText('Models');
    await expect(mobileNav).toContainText('Gallery');
    await expect(mobileNav).toContainText('Contact');
    await expect(mobileNav).toContainText('Cookie Settings');
    await expect(mobileNav).not.toContainText('Modelle');
    await expect(mobileNav).not.toContainText('Galerie');
    await expect(mobileNav).not.toContainText('Cookie-Einstellungen');

    await page.goto('/de/');
    await page.locator('#mobileMenuBtn').click();
    mobileNav = page.locator('#mobileNav');
    await expect(mobileNav).toHaveAttribute('aria-label', 'Navigationsmenü');
    await expect(mobileNav).toContainText('Modelle');
    await expect(mobileNav).toContainText('Galerie');
    await expect(mobileNav).toContainText('Kontakt');
    await expect(mobileNav).toContainText('Cookie-Einstellungen');
    await expect(mobileNav).not.toContainText('Models');
    await expect(mobileNav).not.toContainText('Gallery');
    await expect(mobileNav).not.toContainText('Contact');
    await expect(mobileNav).not.toContainText('Cookie Settings');
  });

  test('shared subpage mobile Models entry follows the active locale', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/legal/privacy.html');
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();
    let overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);

    await page.goto('/de/legal/datenschutz.html');
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Modelle' }).click();
    overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'KI-Modelle');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'BILDGENERIERUNG',
      'MUSIKGENERIERUNG',
      'VIDEOGENERIERUNG',
    ]);
  });

  test('German static pages keep JavaScript-critical identifiers and avoid known untranslated UI copy', async () => {
    const deIndex = repoFile('de/index.html');
    for (const id of ['galleryExplore', 'videoExplore', 'soundLabExplore']) {
      expect(deIndex).toContain(`id="${id}"`);
    }
    for (const translatedId of ['galleryEntdecken', 'videoEntdecken', 'soundLabEntdecken']) {
      expect(deIndex).not.toContain(`id="${translatedId}"`);
    }
    expect(deIndex).toContain('data-models-link="desktop"');
    expect(deIndex).toContain('data-models-link="mobile"');

    const criticalPairs = [
      ['index.html', 'de/index.html'],
      ['generate-lab/index.html', 'de/generate-lab/index.html'],
      ['account/profile.html', 'de/account/profile.html'],
      ['account/assets-manager.html', 'de/account/assets-manager.html'],
      ['account/credits.html', 'de/account/credits.html'],
      ['account/forgot-password.html', 'de/account/forgot-password.html'],
      ['account/image-studio.html', 'de/account/image-studio.html'],
      ['account/organization.html', 'de/account/organization.html'],
      ['account/reset-password.html', 'de/account/reset-password.html'],
      ['account/verify-email.html', 'de/account/verify-email.html'],
      ['account/wallet.html', 'de/account/wallet.html'],
    ];
    for (const [enPath, dePath] of criticalPairs) {
      expect(criticalAttributes(repoFile(dePath)), `${dePath} critical attributes`).toEqual(criticalAttributes(repoFile(enPath)));
    }

    const denylist = [
      'My Profile',
      'View and manage your account',
      'Loading profile',
      'Sign In Required',
      'Account needed',
      'Sign in to open your profile',
      'Your profile, wallet, favorites',
      'Create account',
      'Reset password',
      'Account entry',
      'Create with an account, browse without one',
      'Sign in before generating or saving',
      'Create an account before checkout',
      'Recover access without losing the path',
      'Workspace priority',
      'How BITBI works',
      'Create, save, manage',
      'Start creating from the public site',
      'Backend credit checks',
      'Saved assets in your workspace',
      'Pricing before checkout',
      'Compare credits',
      'Open workspace',
      'From first idea to saved workspace',
      'Browse public work',
      'Start in Generate Lab',
      'View credits and Pro',
      'Open member workspace',
      'Start with the next useful action',
      'Account Info',
      'Display Name',
      'Member Since',
      'Edit Profile',
      'Save Changes',
      'Loading Assets Manager',
      'Organize, preview, publish, and manage your saved media',
      'Private library',
      'Sign in to open Assets Manager',
      'Saved assets, folders, storage usage',
      'Saved Assets',
      'Keep the library moving',
      'Show all assets',
      'Create more',
      'Complete account',
      'Storage details appear after your library loads',
      'Storage status',
      'Private first',
      'Actions stay grouped',
      'Your saved library is empty',
      'Start creating',
      'Private by default',
      'All Folders',
      'Move to Folder',
      'Delete Selected',
      'Back to Profile',
      'Organization billing',
      'Buy one-time live Stripe credit packs',
      'Loading credits dashboard',
      'Sign in to review credits',
      'Credits, BITBI Pro status',
      'Checkout availability is shown',
      'Use credits before the next generation',
      'Member journey',
      'From pricing to the workspace',
      'Set up the account path before checkout',
      'Plan credits',
      'Create with context',
      'Find saved output',
      'Keep account ready',
      'Open Generate Lab',
      'View Assets Manager',
      'Review balance',
      'Create with context',
      'Check saved assets',
      'Credit packs',
      'Recent purchases',
      'Recent credit activity',
      'Verify Email',
      'Email verification',
      'Set New Password',
      'At least 8 characters',
      'Prepare, generate, save, manage',
      'Review cost',
      'Generate preview',
      'Open Assets Manager',
      'Opening wallet workspace',
      'The BITBI wallet workspace',
      'Member Control Center',
      'Your BITBI workspace',
      'Suggested first-run steps',
      'Review credits',
      'Create in Generate Lab',
      'Find saved output',
      'Complete profile basics',
      'Continue creating',
      'Manage saved assets',
      'Account trust',
      'Account security',
      'Your signed-in profile',
      'Signed-in session',
      'Email verification',
      'Password reset is available',
      'Send verification email',
      'Account completion',
      'Profile quality',
      'Completion loads after your profile data',
      'Wallet trust notes',
      'not wallet custody',
      'seed phrases',
      'private keys',
      'Edit profile fields',
      'Display name, bio, website, and avatar are editable',
      'Profile fields load from your account',
      'Your typed values are still in the form',
      'Account recovery is private',
      'Before you change it',
      'Sign in again',
      'Open profile',
      'Email confirmation is checked',
      'Profile settings',
      'Credits and Pro status live in Credits',
      'Keep creating from your credits context',
      'First-run guide',
      'How credits fit into creation',
      'Check balance',
      'Create carefully',
      'Save and review',
      'Move between creation, credits, and profile',
      'First saved asset?',
      'Your library starts after you save from Generate Lab',
      'Create first asset',
      'First time here?',
      'Sign in before generation or saving',
      'Generate Lab can show models',
      'Mobile account actions',
      'Create, preview, save, then manage',
      'On mobile, use these shortcuts',
      'Organization context',
      'Organization dashboard is not available',
      'Selected organization',
      'Recent credit ledger',
      'Recent admin image-test debits',
      'No image run yet',
      'No preference',
      'Planned',
      'Type Description Details Amount Balance',
      'Your generated image',
      'Your generated video',
      'Your generated music',
      'Send Message',
      'Your message',
      'A luminous glass sculpture',
      'A cinematic neon city street',
      'A glossy synth-pop track',
      'Optional image-to-video reference',
      'Optional lyrics',
      'Randomize seed',
      'Saved automatically',
      'Generate Video',
      'Generate Music',
      'New name',
      'Name & Address',
      'Impressum content',
      'Desktop Workspace',
      'Add reference image',
      'One line per item',
      'Chat transcript',
      'Asset title',
      'Optional — describe what to avoid',
      'Speichernd assets browser',
      'Speichernd asset actions',
    ];
    for (const file of listHtmlFiles('de')) {
      const visibleText = uiHtmlText(repoFile(file));
      for (const phrase of denylist) {
        expect(visibleText, `${file} should not expose "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  test('English and German legal links stay in their own locale', async () => {
    for (const englishFile of ['index.html', 'pricing.html', 'legal/privacy.html', 'legal/imprint.html', 'legal/datenschutz.html']) {
      const html = repoFile(englishFile);
      expect(html, `${englishFile} terms link`).toMatch(/href="(?:\/legal\/terms\.html|(?:\.\.\/)?terms\.html|legal\/terms\.html)"/);
      expect(visibleHtmlText(html)).not.toContain('AGB');
    }

    for (const germanFile of ['de/index.html', 'de/pricing.html', 'de/legal/datenschutz.html', 'de/legal/privacy.html', 'de/legal/imprint.html', 'de/legal/terms.html']) {
      const html = repoFile(germanFile);
      expect(html).toContain('/de/legal/datenschutz.html');
      expect(html).toContain('/de/legal/terms.html');
    }

    for (const germanLegalFile of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'de/legal/imprint.html', 'de/legal/terms.html']) {
      const html = repoFile(germanLegalFile);
      expect(html, `${germanLegalFile} privacy footer`).not.toContain('href="datenschutz.html"');
      expect(html, `${germanLegalFile} terms footer`).not.toContain('href="terms.html"');
      expect(html, `${germanLegalFile} imprint footer`).not.toContain('href="imprint.html"');
    }

    const dePrivacyAlias = repoFile('de/legal/privacy.html');
    expect(dePrivacyAlias).toContain('<link rel="canonical" href="https://bitbi.ai/de/legal/datenschutz.html">');

    const deRoot = repoFile('de/index.html');
    expect(deRoot).toContain('<link rel="canonical" href="https://bitbi.ai/de/">');
    expect(deRoot).toContain('<meta property="og:url" content="https://bitbi.ai/de/">');
    expect(deRoot).toContain('"url": "https://bitbi.ai/de/"');
  });

  test('repo agent instructions document bilingual non-admin parity and Admin exception', async () => {
    const exactRule = 'All non-admin changes must be implemented and checked for both English and German routes/pages/locales. Admin remains English-only and must not be localized or recreated under /de/admin unless explicitly requested.';
    const agentInstructions = repoFile('AGENTS.md');
    const claudeInstructions = repoFile('CLAUDE.md');
    expect(agentInstructions).toContain(exactRule);
    expect(claudeInstructions).toContain(exactRule);
    expect(agentInstructions).toContain('All future non-admin changes must be checked and implemented for both English and German');
    expect(agentInstructions).toContain('Public pages, account/member pages, shared navigation, pricing, auth, legal links, overlays, labels, route policies, tests, and localized UI must stay in parity');
    expect(agentInstructions).toContain('The Admin area is the exception: Admin remains English-only');
    expect(agentInstructions).toContain('/de/admin');
  });

  test('German SEO metadata stays on German canonical URLs', async () => {
    for (const file of listHtmlFiles('de')) {
      const html = repoFile(file);
      const canonical = html.match(/<link rel="canonical" href="([^"]+)">/);
      if (canonical) {
        expect(canonical[1], `${file} canonical`).toMatch(/^https:\/\/bitbi\.ai\/de(?:\/|$)/);
      }
      const ogUrl = html.match(/<meta property="og:url" content="([^"]+)">/);
      if (ogUrl) {
        expect(ogUrl[1], `${file} og:url`).toMatch(/^https:\/\/bitbi\.ai\/de(?:\/|$)/);
      }
      expect(html, `${file} JSON-LD url should not point to English root`).not.toContain('"url": "https://bitbi.ai/"');
      expect(html, `${file} German privacy links`).not.toContain('/de/legal/privacy.html');
    }
  });

  test('Admin stays English-only and is not exposed as a German localized page', async ({ page }) => {
    expect(fs.existsSync(path.join(__dirname, '..', 'de/admin/index.html'))).toBe(false);

    const adminHtml = repoFile('admin/index.html');
    expect(adminHtml).toContain('<html lang="en">');
    expect(adminHtml).not.toContain('/de/admin');
    expect(visibleHtmlText(adminHtml)).not.toContain('Hauptnavigation');
    expect(visibleHtmlText(adminHtml)).not.toContain('Admin-Bereiche');

    await page.goto('/');
    await page.evaluate(() => {
      document.cookie = 'bitbi_locale=de; Path=/; Max-Age=31536000; SameSite=Lax';
    });

    await page.goto('/admin/index.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.locale-switcher__link')).toHaveCount(0);
    await expect(page.locator('#navbar')).toHaveAttribute('aria-label', 'Main navigation');
    await expect(page.locator('.site-nav__links')).toContainText('Gallery');
    await expect(page.locator('body')).not.toContainText('Galerie');
    await expect(page.locator('body')).not.toContainText('Hauptnavigation');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();
    const overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'BILDGENERIERUNG' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Close models' })).toBeVisible();
  });
});

test.describe('DACH locale routing helpers', () => {
  test('redirects DACH document requests to /de/ without redirecting existing German routes', async () => {
    const routing = await loadLocaleRouting();

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/?utm=test',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('https://bitbi.ai/de/?utm=test');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html?checkout=cancel',
      headers: new Headers({ 'CF-IPCountry': 'AT' }),
    })).toBe('https://bitbi.ai/de/pricing.html?checkout=cancel');

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/de/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'CH' }),
    })).toBe(false);
  });

  test('honors locale cookies and normalizes bare /de safely', async () => {
    const routing = await loadLocaleRouting();

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html?checkout=cancel',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('https://bitbi.ai/de/pricing.html?checkout=cancel');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/account/profile.html',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('https://bitbi.ai/de/account/profile.html');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'DE', Cookie: 'bitbi_locale=en' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('https://bitbi.ai/de/pricing.html');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'US' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/de',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('https://bitbi.ai/de/');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/de/',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('');

    expect(routing.toGermanPath('/de')).toBe('/de/');
    expect(routing.toGermanPath('/de/')).toBe('/de/');
    expect(routing.toGermanPath('/de')).not.toBe('/de/de');
  });

  test('keeps Admin routes out of German path mapping and geo redirects', async () => {
    const routing = await loadLocaleRouting();

    for (const pathname of [
      '/admin',
      '/admin/',
      '/admin/index.html',
      '/admin/users',
      '/de/admin',
      '/de/admin/',
      '/de/admin/index.html',
      '/de/admin/users',
    ]) {
      expect(routing.isAdminPath(pathname), `${pathname} is admin`).toBe(true);
    }

    expect(routing.toGermanPath('/admin')).toBe('/admin/');
    expect(routing.toGermanPath('/admin/')).toBe('/admin/');
    expect(routing.toGermanPath('/admin/index.html')).toBe('/admin/index.html');
    expect(routing.toGermanPath('/admin/users')).toBe('/admin/users');
    expect(routing.toGermanPath('/de/admin/')).toBe('/admin/');
    expect(routing.toEnglishPath('/de/admin/index.html')).toBe('/admin/index.html');

    expect(routing.toGermanPath('/admin')).not.toBe('/de/admin/');
    expect(routing.toGermanPath('/admin/')).not.toBe('/de/admin/');
    expect(routing.toGermanPath('/admin/index.html')).not.toBe('/de/admin/index.html');

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe(false);

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/admin/index.html',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('');
  });

  test('does not geo-redirect non-DACH users, locale-cookie users, API routes, or assets', async () => {
    const routing = await loadLocaleRouting();

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/',
      headers: new Headers({ 'CF-IPCountry': 'US' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/',
      headers: new Headers({ 'CF-IPCountry': 'DE', Cookie: 'bitbi_locale=en' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/api/session',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/css/base/base.css',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe(false);
  });
});
