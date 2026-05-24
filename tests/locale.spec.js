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

function expectCanonicalHreflang(html, { canonical, en, de, xDefault }) {
  expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
  expect(html).toContain(`<link rel="alternate" hreflang="en" href="${en}">`);
  expect(html).toContain(`<link rel="alternate" hreflang="de" href="${de}">`);
  expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${xDefault}">`);
}

function expectSocialMetadata(html, { title, description, url }) {
  expect(html).toContain(`<meta property="og:title" content="${title}">`);
  expect(html).toContain(`<meta property="og:description" content="${description}">`);
  expect(html).toContain(`<meta property="og:type" content="website">`);
  expect(html).toContain(`<meta property="og:url" content="${url}">`);
  expect(html).toContain('<meta property="og:image" content="https://bitbi.ai/assets/images/og-default.png">');
  expect(html).toContain('<meta property="og:image:width" content="1200">');
  expect(html).toContain('<meta property="og:image:height" content="630">');
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  expect(html).toContain(`<meta name="twitter:title" content="${title}">`);
  expect(html).toContain(`<meta name="twitter:description" content="${description}">`);
  expect(html).toContain('<meta name="twitter:image" content="https://bitbi.ai/assets/images/og-default.png">');
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
    'data-auth-source',
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
    await expect(page.locator('#hero')).not.toContainText('Start creating from the public site');
    await expect(page.locator('#hero')).not.toContainText('Backend credit checks');
    await expect(page.locator('#hero')).not.toContainText('Compare credits');
    await expect(page.locator('#hero')).not.toContainText('Open workspace');
    await expect(page.locator('#hero a[href="/pricing.html#pricingJourney"]')).toHaveCount(0);
    await expect(page.locator('#hero a[href="/account/profile.html?source=hero#memberControlCenter"]')).toHaveCount(0);
    await expect(page.locator('#hero .hero__actions')).toHaveClass(/hero__actions--single-cta/);
    await expect(page.locator('#hero .hero__lab-teaser-text')).toHaveText('Open Generate Lab');
    await expect(page.locator('#hero .hero__lab-teaser-icon')).toHaveText('⚗️');
    await expect(page.locator('#hero .hero__lab-teaser')).toHaveAttribute('href', '/generate-lab/');
    await expect(page.locator('#publicMemberJourney')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('From first idea to saved workspace');
    await expect(page.locator('main')).not.toContainText('Create with an account, browse without one');

    await page.goto('/de/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('#hero')).not.toContainText('Direkt von der öffentlichen Seite starten');
    await expect(page.locator('#hero')).not.toContainText('Backend prüft Credits');
    await expect(page.locator('#hero')).not.toContainText('Credits vergleichen');
    await expect(page.locator('#hero')).not.toContainText('Arbeitsbereich öffnen');
    await expect(page.locator('#hero a[href="/de/pricing.html#pricingJourney"]')).toHaveCount(0);
    await expect(page.locator('#hero a[href="/de/account/profile.html?source=hero#memberControlCenter"]')).toHaveCount(0);
    await expect(page.locator('#hero .hero__actions')).toHaveClass(/hero__actions--single-cta/);
    await expect(page.locator('#hero .hero__lab-teaser-text')).toHaveText('Open Generate Lab');
    await expect(page.locator('#hero .hero__lab-teaser-icon')).toHaveText('⚗️');
    await expect(page.locator('#hero .hero__lab-teaser')).toHaveAttribute('href', '/de/generate-lab/');
    await expect(page.locator('#publicMemberJourney')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Von der ersten Idee zum gespeicherten Arbeitsbereich');
    await expect(page.locator('main')).not.toContainText('Mit Konto erstellen, ohne Konto stöbern');
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

    const indexCss = repoFile('css/pages/index.css');
    expect(indexCss).toContain('@keyframes heroLabCtaGlow');
    expect(indexCss).toContain('@keyframes heroLabCtaSheen');
    expect(indexCss).toContain('.hero__lab-teaser:hover');
    expect(indexCss).toContain('.hero__lab-teaser:focus-visible');
    expect(indexCss).toContain('.hero__actions--single-cta');
    expect(indexCss).toContain('prefers-reduced-motion: reduce');
    expect(indexCss).toContain('.hero__lab-teaser::before');
    expect(indexCss).toContain('animation: none');
  });

  test('global Help Menu exposes localized content, motion safety, and no German Admin route', () => {
    const helpJs = repoFile('js/shared/help-menu.js');
    const componentCss = repoFile('css/components/components.css');

    expect(helpJs).toContain('HELP_MENU_SECTIONS');
    expect(helpJs).toContain("open: 'Open help menu'");
    expect(helpJs).toContain("open: 'Hilfemenü öffnen'");
    expect(helpJs).toContain('How BITBI works');
    expect(helpJs).toContain('So funktioniert BITBI');
    expect(helpJs).toContain('Sign in, create account, reset password');
    expect(helpJs).toContain('Anmelden, Konto erstellen, Passwort zurücksetzen');
    expect(helpJs).toContain("id: 'after-recovery'");
    expect(helpJs).toContain('After recovery');
    expect(helpJs).toContain('Nach der Wiederherstellung');
    expect(helpJs).toContain('Password reset only repairs access');
    expect(helpJs).toContain('Das Zurücksetzen des Passworts repariert nur den Zugriff');
    expect(helpJs).toContain("id: 'credit-generation-flow'");
    expect(helpJs).toContain('Before Generate Lab');
    expect(helpJs).toContain('Vor Generate Lab');
    expect(helpJs).toContain('Cancel or error states do not assume a credit grant.');
    expect(helpJs).toContain('Abbruch- oder Fehlerzustände setzen keine Credit-Gutschrift voraus.');
    expect((helpJs.match(/id: 'credit-generation-flow'/g) || [])).toHaveLength(1);
    expect(helpJs).toContain("id: 'admin'");
    expect(helpJs).toContain('Admin remains English-only');
    expect(helpJs).not.toContain('/de/admin');
    expect(componentCss).toContain('@keyframes helpMenuWobble');
    expect(componentCss).toContain('.help-menu__trigger:hover');
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(componentCss).not.toMatch(/\.help-menu[\s\S]{0,9000}backdrop-filter/);
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

  test('public Pricing and Generate Lab pages expose share metadata parity', () => {
    const enPricing = repoFile('pricing.html');
    const dePricing = repoFile('de/pricing.html');
    const enGenerate = repoFile('generate-lab/index.html');
    const deGenerate = repoFile('de/generate-lab/index.html');

    expectSocialMetadata(enPricing, {
      title: 'BITBI Credits & Pro | Pricing',
      description: 'Choose BITBI Pro or one-time credit packs, then continue to Generate Lab, save outputs to Assets Manager, and review account-bound credits in your workspace.',
      url: 'https://bitbi.ai/pricing.html',
    });
    expectSocialMetadata(dePricing, {
      title: 'BITBI Credits & Pro | Preise',
      description: 'Wählen Sie BITBI Pro oder einmalige Credit-Pakete, wechseln Sie ins Generate Lab, speichern Sie Ergebnisse im Assets Manager und prüfen Sie kontogebundene Credits im Arbeitsbereich.',
      url: 'https://bitbi.ai/de/pricing.html',
    });
    expectSocialMetadata(enGenerate, {
      title: 'Generate Lab | BITBI',
      description: "Generate Lab is BITBI's desktop-optimized member creation workspace for image, video, and music generation.",
      url: 'https://bitbi.ai/generate-lab/',
    });
    expectSocialMetadata(deGenerate, {
      title: 'Generate Lab | BITBI',
      description: 'Generate Lab ist BITBIs desktop-optimierter Mitglieder-Arbeitsbereich für Bild-, Video- und Musikgenerierung.',
      url: 'https://bitbi.ai/de/generate-lab/',
    });
  });

  test('account member and recovery pages expose canonical and hreflang metadata parity', () => {
    const pagePairs = [
      ['account/profile.html', 'de/account/profile.html'],
      ['account/credits.html', 'de/account/credits.html'],
      ['account/assets-manager.html', 'de/account/assets-manager.html'],
      ['account/forgot-password.html', 'de/account/forgot-password.html'],
      ['account/reset-password.html', 'de/account/reset-password.html'],
      ['account/verify-email.html', 'de/account/verify-email.html'],
    ];

    for (const [enPath, dePath] of pagePairs) {
      const enHtml = repoFile(enPath);
      const deHtml = repoFile(dePath);
      const enUrl = `https://bitbi.ai/${enPath}`;
      const deUrl = `https://bitbi.ai/${dePath}`;
      expect(enHtml, enPath).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(deHtml, dePath).toContain('<meta name="robots" content="noindex, nofollow">');
      expectCanonicalHreflang(enHtml, {
        canonical: enUrl,
        en: enUrl,
        de: deUrl,
        xDefault: enUrl,
      });
      expectCanonicalHreflang(deHtml, {
        canonical: deUrl,
        en: enUrl,
        de: deUrl,
        xDefault: enUrl,
      });
    }

    const enCredits = repoFile('account/credits.html');
    const deCredits = repoFile('de/account/credits.html');
    expect(enCredits).toContain('class="hero hero--compact credits-hero"');
    expect(enCredits).toContain('class="legal-hero__title credits-title gt-gold-cyan"');
    expect(enCredits).not.toContain('id="creditsEyebrow"');
    expect(enCredits).not.toContain('Member credits');
    expect(enCredits).toContain('Credits dashboard');
    expect(enCredits).toContain('Review personal credits, BITBI Pro status, one-time packs, and organization checkout access when available.');
    expect(enCredits).toContain('class="credits-overview-grid"');
    expect(enCredits).toContain('id="creditsWorkGrid" class="credits-work-grid"');
    expect(enCredits).toContain('class="credits-membership-grid"');
    expect(enCredits).toContain('id="creditsLedgerSection" class="credits-section credits-ledger-section"');
    expect(enCredits).toContain('Back to Profile');
    expect(enCredits).not.toContain('credits-hero__glow');
    expect(deCredits).toContain('class="hero hero--compact credits-hero"');
    expect(deCredits).toContain('class="legal-hero__title credits-title gt-gold-cyan"');
    expect(deCredits).not.toContain('id="creditsEyebrow"');
    expect(deCredits).not.toContain('Mitglieder-Credits');
    expect(deCredits).toContain('Credits-Dashboard');
    expect(deCredits).toContain('Prüfen Sie persönliche Credits, BITBI-Pro-Status, einmalige Pakete und Organisations-Checkout-Zugriff, wenn verfügbar.');
    expect(deCredits).toContain('class="credits-overview-grid"');
    expect(deCredits).toContain('id="creditsWorkGrid" class="credits-work-grid"');
    expect(deCredits).toContain('class="credits-membership-grid"');
    expect(deCredits).toContain('id="creditsLedgerSection" class="credits-section credits-ledger-section"');
    expect(deCredits).toContain('Zurück zum Profil');
    expect(deCredits).not.toContain('credits-hero__glow');
  });

  test('member workspace navigation keeps English and German routes equivalent', () => {
    const enProfile = repoFile('account/profile.html');
    const deProfile = repoFile('de/account/profile.html');
    const profileCss = repoFile('css/account/profile.css');
    const enCredits = repoFile('account/credits.html');
    const deCredits = repoFile('de/account/credits.html');
    const enAssets = repoFile('account/assets-manager.html');
    const deAssets = repoFile('de/account/assets-manager.html');
    const enGenerate = repoFile('generate-lab/index.html');
    const deGenerate = repoFile('de/generate-lab/index.html');
    const localeJs = repoFile('js/shared/locale.js');
    const helpMenu = repoFile('js/shared/help-menu.js');

    expect(enProfile).not.toContain('id="memberControlCenter"');
    expect(enProfile).not.toContain('Member Control Center');
    expect(enProfile).not.toContain('href="../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(enProfile).not.toContain('id="profileWorkspacePriority"');
    expect(enProfile).not.toContain('Workspace priority');
    expect(enProfile).not.toContain('Start with the next useful action');
    expect(enProfile).not.toContain('Suggested first-run steps');
    expect(enProfile).toContain('href="/account/assets-manager.html"');
    expect(enProfile).toContain('href="/account/credits.html?scope=member"');
    expect(enProfile).toContain('id="profileFavoritesQuickLink"');
    expect(enProfile).toContain('href="#profileFavoritesSection"');
    expect(enProfile).toContain('aria-label="Open Favorites"');
    expect(enProfile).toContain('id="profileFavoritesSection" tabindex="-1"');
    expect(enProfile).toContain('Back to Profile');
    expect(enProfile).toContain('class="section__inner profile-shell"');
    expect(enProfile).toContain('profile__overview-grid');
    expect(enProfile).not.toContain('id="profileSecurityCard"');
    expect(enProfile).not.toContain('Account security');
    expect(enProfile).not.toContain('Your signed-in profile is the source of truth for account status.');
    expect(enProfile).not.toContain('id="securityEmailStatus"');
    expect(enProfile).not.toContain('id="securityReverifyBtn"');
    expect(enProfile).toContain('After sign-in, continue here to review the profile checklist');
    expect(enProfile).toContain('data-auth-source="profile"');
    expect(enProfile).toContain('href="/account/forgot-password.html?source=profile"');
    expect(enProfile).toContain('id="profileCompletionCard"');
    expect(enProfile).toContain('Account completion');
    expect(enProfile).toContain('Checklist');
    expect(enProfile).toContain('profile__completion-title-row');
    expect(enProfile).toContain('<div id="profileCompletionStatus" class="profile__completion-status" role="status" aria-live="polite">Completion loads after your profile data.</div>');
    expect(enProfile).not.toContain('</div>\n                    <div id="profileCompletionStatus" class="profile__completion-status"');
    expect(enProfile).toContain('profile__completion-check');
    expect(enProfile).toContain('data-completion-item="signed-in"');
    expect(enProfile).toContain('data-completion-item="email"');
    expect(enProfile).toContain('data-completion-item="profile-image"');
    expect(enProfile).toContain('data-completion-item="display-name"');
    expect(enProfile).toContain('Email status');
    expect(enProfile).toContain('Profile image');
    expect(enProfile).toContain('Display name');
    expect([...enProfile.matchAll(/data-completion-item="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'signed-in',
      'email',
      'profile-image',
      'display-name',
      'wallet',
    ]);
    expect(enProfile).not.toContain('data-completion-item="profile-loaded"');
    expect(enProfile).not.toContain('id="completionProfileLoadedStatus"');
    expect(enProfile).not.toContain('Profile loaded</span>');
    expect(enProfile).not.toContain('id="profileUsageTrustCard"');
    expect(enProfile).not.toContain('Credits and Pro stay account-bound');
    expect(enProfile).not.toContain('Profile keeps recovery and account identity close, but it does not grant credits.');
    expect(enProfile).not.toContain('href="/account/credits.html?scope=member&amp;source=profile-usage"');
    expect(enProfile).not.toContain('href="/generate-lab/?source=profile-usage"');
    expect(enProfile).not.toContain('href="/account/assets-manager.html?source=profile-usage&amp;recent=1#generate-lab-recent"');
    expect(enProfile).toContain('id="completionWalletStatus"');
    expect(enProfile).toContain('id="profileAvatarAccountStack"');
    expect(enProfile).toContain('id="profileAvatarCard"');
    expect(enProfile).toContain('profile__avatar-card--compact');
    expect(enProfile).toContain('id="profileAccountCard"');
    expect(enProfile).toContain('profile__account-card--compact');
    expect(enProfile).toContain('profile__settings-row');
    expect(enProfile.indexOf('class="profile__card profile__edit-card"')).toBeGreaterThan(-1);
    expect(enProfile).not.toContain('id="walletSectionCard"');
    expect(enProfile).not.toContain('id="profileWalletContext"');
    expect(enProfile).not.toContain('profile__wallet-context');
    expect(enProfile).not.toContain('BITBI Account</p>');
    expect(enProfile).toContain('id="profileWalletCardStatus"');
    expect(enProfile).not.toContain('Wallet linking is optional and never requires sharing private keys.');
    expect(enProfile).not.toContain('id="walletTrustStatus"');
    expect(enProfile).not.toContain('Wallet trust notes');
    expect(enProfile).not.toContain('not wallet custody');
    expect(enProfile).not.toContain('id="walletStatusRefreshBtn"');
    expect(enProfile).not.toContain('Refresh wallet status');
    expect(enProfile).toContain('id="profileEditState"');
    expect(enProfile).toContain('Display name, bio, website, and avatar are editable here.');
    expect(enProfile).not.toContain('Wallet status and actions live in the compact BITBI Account context below.');
    expect(enProfile).toContain('Sign in to open your profile');
    expect(enProfile).toContain('Reset your password or complete email verification after sign-in');
    expect(enProfile).toContain('data-auth-message-key="authRecovery.profileMessage"');
    expect(enProfile).toContain('href="/account/forgot-password.html?source=profile"');

    expect(deProfile).not.toContain('id="memberControlCenter"');
    expect(deProfile).not.toContain('Mitglieder-Kontrollzentrum');
    expect(deProfile).not.toContain('href="../../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(deProfile).not.toContain('id="profileWorkspacePriority"');
    expect(deProfile).not.toContain('Arbeitsbereich-Priorität');
    expect(deProfile).not.toContain('Mit der sinnvollsten nächsten Aktion starten');
    expect(deProfile).not.toContain('Empfohlene erste Schritte');
    expect(deProfile).toContain('href="/de/account/assets-manager.html"');
    expect(deProfile).toContain('href="/de/account/credits.html?scope=member"');
    expect(deProfile).toContain('id="profileFavoritesQuickLink"');
    expect(deProfile).toContain('href="#profileFavoritesSection"');
    expect(deProfile).toContain('aria-label="Favoriten öffnen"');
    expect(deProfile).toContain('id="profileFavoritesSection" tabindex="-1"');
    expect(deProfile).toContain('Zurück zum Profil');
    expect(deProfile).toContain('class="section__inner profile-shell"');
    expect(deProfile).toContain('profile__overview-grid');
    expect(deProfile).not.toContain('id="profileSecurityCard"');
    expect(deProfile).not.toContain('Kontosicherheit');
    expect(deProfile).not.toContain('Ihr angemeldetes Profil ist die Quelle der Wahrheit für den Kontostatus.');
    expect(deProfile).not.toContain('id="securityEmailStatus"');
    expect(deProfile).not.toContain('id="securityReverifyBtn"');
    expect(deProfile).toContain('Nach der Anmeldung hier fortfahren, um Profil-Checkliste');
    expect(deProfile).toContain('data-auth-source="profile"');
    expect(deProfile).toContain('href="/de/account/forgot-password.html?source=profile"');
    expect(deProfile).toContain('id="profileCompletionCard"');
    expect(deProfile).toContain('Kontovervollständigung');
    expect(deProfile).toContain('Checkliste');
    expect(deProfile).toContain('profile__completion-title-row');
    expect(deProfile).toContain('<div id="profileCompletionStatus" class="profile__completion-status" role="status" aria-live="polite">Vervollständigung lädt nach den Profildaten.</div>');
    expect(deProfile).not.toContain('</div>\n                    <div id="profileCompletionStatus" class="profile__completion-status"');
    expect(deProfile).toContain('profile__completion-check');
    expect(deProfile).toContain('data-completion-item="signed-in"');
    expect(deProfile).toContain('data-completion-item="email"');
    expect(deProfile).toContain('data-completion-item="profile-image"');
    expect(deProfile).toContain('data-completion-item="display-name"');
    expect(deProfile).toContain('E-Mail-Status');
    expect(deProfile).toContain('Profil Bild');
    expect(deProfile).toContain('Anzeige Name');
    expect([...deProfile.matchAll(/data-completion-item="([^"]+)"/g)].map((match) => match[1])).toEqual([
      'signed-in',
      'email',
      'profile-image',
      'display-name',
      'wallet',
    ]);
    expect(deProfile).not.toContain('data-completion-item="profile-loaded"');
    expect(deProfile).not.toContain('id="completionProfileLoadedStatus"');
    expect(deProfile).not.toContain('Profil geladen</span>');
    expect(deProfile).not.toContain('id="profileUsageTrustCard"');
    expect(deProfile).not.toContain('Credits und Pro bleiben konto-gebunden');
    expect(deProfile).not.toContain('Profil hält Wiederherstellung und Kontoidentität nahe, vergibt aber keine Credits.');
    expect(deProfile).not.toContain('href="/de/account/credits.html?scope=member&amp;source=profile-usage"');
    expect(deProfile).not.toContain('href="/de/generate-lab/?source=profile-usage"');
    expect(deProfile).not.toContain('href="/de/account/assets-manager.html?source=profile-usage&amp;recent=1#generate-lab-recent"');
    expect(deProfile).toContain('id="completionWalletStatus"');
    expect(deProfile).toContain('id="profileAvatarAccountStack"');
    expect(deProfile).toContain('id="profileAvatarCard"');
    expect(deProfile).toContain('profile__avatar-card--compact');
    expect(deProfile).toContain('profile__avatar-message');
    expect(deProfile).toContain('id="profileAccountCard"');
    expect(deProfile).toContain('profile__account-card--compact');
    expect(deProfile).toContain('profile__settings-row');
    expect(deProfile.indexOf('class="profile__card profile__edit-card"')).toBeGreaterThan(-1);
    expect(deProfile).not.toContain('id="walletSectionCard"');
    expect(deProfile).not.toContain('id="profileWalletContext"');
    expect(deProfile).not.toContain('profile__wallet-context');
    expect(deProfile).not.toContain('BITBI-Konto</p>');
    expect(deProfile).toContain('id="profileWalletCardStatus"');
    expect(deProfile).not.toContain('Wallet-Verknüpfung ist optional und erfordert niemals private Schlüssel.');
    expect(deProfile).not.toContain('id="walletTrustStatus"');
    expect(deProfile).not.toContain('Hinweise zum Wallet-Vertrauen');
    expect(deProfile).not.toContain('keine Wallet-Verwahrung');
    expect(deProfile).not.toContain('id="walletStatusRefreshBtn"');
    expect(deProfile).not.toContain('Wallet-Status aktualisieren');
    expect(deProfile).toContain('id="profileEditState"');
    expect(deProfile).toContain('Anzeigename, Bio, Website und Avatar sind hier bearbeitbar.');
    expect(deProfile).not.toContain('Wallet-Status und Aktionen liegen kompakt im BITBI-Konto-Kontext darunter.');
    expect(deProfile).toContain('Anmelden, um Ihr Profil zu öffnen');
    expect(deProfile).toContain('schließen Sie die E-Mail-Bestätigung nach der Anmeldung ab');
    expect(deProfile).toContain('data-auth-message-key="authRecovery.profileMessage"');
    expect(deProfile).toContain('href="/de/account/forgot-password.html?source=profile"');

    expect(profileCss).toContain('.profile__avatar-card--compact .profile__avatar-frame');
    expect(profileCss).toContain('grid-template-areas:');
    expect(profileCss).toContain('"frame actions message"');
    expect(profileCss).toContain('width: 64px');
    expect(profileCss).toContain('height: 64px');
    expect(profileCss).toContain('.profile__completion-title-row');
    expect(profileCss).toContain('--profile-overview-account-block');
    expect(profileCss).toContain('grid-template-rows: repeat(4, minmax(0, 1fr))');
    expect(profileCss).toContain('grid-template-rows: repeat(3, minmax(0, 1fr))');
    expect(profileCss).toContain('#profileFavoritesQuickLink');
    expect(profileCss).toContain('display: none');
    expect(profileCss).toContain('.profile__studio-card--favorites');
    expect(profileCss).toContain('.profile__favorites-back');
    expect(profileCss).toContain('.profile-view--favorites-focused');
    expect(profileCss).not.toContain('.profile__wallet-context');
    expect(profileCss).toContain('#profileTabBar');
    expect(profileCss).toContain('grid-row: 1 / span 2');
    expect(profileCss).toContain('display: contents');
    expect(profileCss).toContain('min-block-size: calc((88px * 2) + var(--space-3))');
    expect(profileCss).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(profileCss).not.toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');

    expect(enCredits).not.toContain('href="../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(repoFile('css/account/credits.css')).not.toContain('.credits-return');
    expect(enCredits).not.toContain('id="creditsReturnState"');
    expect(deCredits).not.toContain('id="creditsReturnState"');
    expect(enCredits).not.toContain('id="creditsWorkspacePriority"');
    expect(enCredits).not.toContain('Use credits before the next generation');
    expect(enCredits).not.toContain('Keep creating from your credits context');
    expect(enCredits).not.toContain('credits-onboarding');
    expect(enCredits).not.toContain('How credits fit into creation');
    expect(enCredits).not.toContain('id="creditsContinuityPanel"');
    expect(enCredits).not.toContain('Credit and storage context');
    expect(enCredits).not.toContain('Credits help you create; Assets stores what you save');
    expect(enCredits).not.toContain('Low or unknown credits should send you here first.');
    expect(enCredits).not.toContain('id="creditsPostActionGuide"');
    expect(enCredits).not.toContain('Use Credits as the verified return point');
    expect(enCredits).not.toContain('After pricing');
    expect(enCredits).toContain('credits-overview-grid');
    expect(enCredits).toContain('credits-work-grid');
    expect(enCredits).not.toContain('credits-history-grid');
    expect(enCredits).toContain('credits-membership-grid');
    expect(enCredits).toContain('credits-ledger-section');
    expect(enCredits).toContain('href="/account/profile.html">Back to Profile</a>');
    expect(enCredits).toContain('Sign in to review credits');
    expect(enCredits).toContain('Profile verification guidance are available');
    expect(enCredits).toContain('href="/account/profile.html?returnContext=credits#profileCompletionCard"');
    expect(enCredits).toContain('data-auth-message-key="authRecovery.creditsMessage"');
    expect(enCredits).toContain('After sign-in, continue here to refresh verified credits');
    expect(enCredits).toContain('data-auth-source="credits"');
    expect(enCredits).toContain('href="/account/forgot-password.html?source=credits"');

    expect(deCredits).not.toContain('href="../../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(deCredits).not.toContain('id="creditsWorkspacePriority"');
    expect(deCredits).not.toContain('Credits vor der nächsten Generierung nutzen');
    expect(deCredits).not.toContain('Aus dem Credits-Kontext weiter erstellen');
    expect(deCredits).not.toContain('credits-onboarding');
    expect(deCredits).not.toContain('So passen Credits zur Erstellung');
    expect(deCredits).not.toContain('id="creditsContinuityPanel"');
    expect(deCredits).not.toContain('Credit- und Speicherkontext');
    expect(deCredits).not.toContain('Credits helfen beim Erstellen; Assets speichert, was Sie behalten');
    expect(deCredits).not.toContain('Niedrige oder unbekannte Credits führen zuerst hierher.');
    expect(deCredits).not.toContain('id="creditsPostActionGuide"');
    expect(deCredits).not.toContain('Credits als verifizierten Rückkehrpunkt nutzen');
    expect(deCredits).not.toContain('Nach Pricing');
    expect(deCredits).toContain('credits-overview-grid');
    expect(deCredits).toContain('credits-work-grid');
    expect(deCredits).not.toContain('credits-history-grid');
    expect(deCredits).toContain('credits-membership-grid');
    expect(deCredits).toContain('credits-ledger-section');
    expect(deCredits).toContain('href="/de/account/profile.html">Zurück zum Profil</a>');
    expect(deCredits).toContain('Anmelden, um Credits zu prüfen');
    expect(deCredits).toContain('Profilhinweise zur Bestätigung sind verfügbar');
    expect(deCredits).toContain('href="/de/account/profile.html?returnContext=credits#profileCompletionCard"');
    expect(deCredits).toContain('data-auth-message-key="authRecovery.creditsMessage"');
    expect(deCredits).toContain('Nach der Anmeldung hier fortfahren, um verifizierte Credits');
    expect(deCredits).toContain('data-auth-source="credits"');
    expect(deCredits).toContain('href="/de/account/forgot-password.html?source=credits"');

    expect(enAssets).not.toContain('assets-manager__workspace-nav');
    expect(enAssets).not.toContain('id="assetsWorkspacePriority"');
    expect(enAssets).not.toContain('Keep the library moving');
    expect(enAssets).not.toContain('href="#studioGalleryFilter"');
    expect(enAssets).not.toContain('href="/account/profile.html?returnContext=assets-manager#profileCompletionCard"');
    expect(enAssets).not.toContain('Move between creation, credits, and profile');
    expect(enAssets).not.toContain('assets-manager__first-run');
    expect(enAssets).not.toContain('Your library starts after you save from Generate Lab');
    expect(enAssets).not.toContain('First saved asset?');
    expect(enAssets).not.toContain('assets-manager__storage-panel');
    expect(enAssets).not.toContain('Storage status');
    expect(enAssets).not.toContain('Storage details appear after your library loads');
    expect(enAssets).not.toContain('id="studioViewContext"');
    expect(enAssets).not.toContain('Library view');
    expect(enAssets).toContain('Refresh latest');
    expect(enAssets).not.toContain('id="studioFolderDetail"');
    expect(enAssets).not.toContain('Folder detail');
    expect(enAssets).not.toContain('Folder count appears after loading.');
    expect(enAssets).toContain('id="studioBulkMoveSummary"');
    expect(enAssets).toContain('id="studioActionResult"');
    expect(enAssets).toContain('Action result');
    expect(enAssets).toContain('Rename, move, delete, and folder results appear here after backend confirmation.');
    expect(enAssets).toContain('Folder and selection tools stay here on phones.');
    expect(enAssets).not.toContain('Private first');
    expect(enAssets).not.toContain('Actions stay grouped</h3>');
    expect(enAssets).not.toContain('Storage is separate from credits');
    expect(enAssets).not.toContain('Credits are reviewed in Credits and consumed by generation, not folder organization.');
    expect(enAssets).not.toContain('href="/account/credits.html?scope=member&amp;source=assets-manager"');
    expect(enAssets).not.toContain('href="/generate-lab/?source=assets-manager&amp;step=create"');
    expect(enAssets).toContain('Selection mode active');
    expect(enAssets).toContain('On phones, selected count and bulk actions stay directly below this guide.');
    expect(enAssets).toContain('Move selected assets');
    expect(enAssets).toContain('Your selection stays available if saving fails.');
    expect(enAssets).toContain('href="/generate-lab/"');
    expect(enAssets).toContain('Sign in to open Assets Manager');
    expect(enAssets).toContain('data-auth-message-key="authRecovery.assetsMessage"');
    expect(enAssets).toContain('After sign-in, continue here to refresh your saved library');
    expect(enAssets).toContain('data-auth-source="assets-manager"');
    expect(enAssets).toContain('href="/account/forgot-password.html?source=assets-manager"');

    expect(deAssets).not.toContain('assets-manager__workspace-nav');
    expect(deAssets).not.toContain('id="assetsWorkspacePriority"');
    expect(deAssets).not.toContain('Die Bibliothek in Bewegung halten');
    expect(deAssets).not.toContain('href="#studioGalleryFilter"');
    expect(deAssets).not.toContain('href="/de/account/profile.html?returnContext=assets-manager#profileCompletionCard"');
    expect(deAssets).not.toContain('Zwischen Erstellung, Credits und Profil wechseln');
    expect(deAssets).not.toContain('assets-manager__first-run');
    expect(deAssets).not.toContain('Ihre Bibliothek beginnt nach dem Speichern aus Generate Lab');
    expect(deAssets).not.toContain('Erstes gespeichertes Asset?');
    expect(deAssets).not.toContain('assets-manager__storage-panel');
    expect(deAssets).not.toContain('Speicherstatus');
    expect(deAssets).not.toContain('Speicherdetails erscheinen, sobald Ihre Bibliothek geladen ist.');
    expect(deAssets).not.toContain('id="studioViewContext"');
    expect(deAssets).not.toContain('Bibliotheksansicht');
    expect(deAssets).toContain('Neueste aktualisieren');
    expect(deAssets).not.toContain('id="studioFolderDetail"');
    expect(deAssets).not.toContain('Ordnerdetail');
    expect(deAssets).not.toContain('Die Ordneranzahl erscheint nach dem Laden.');
    expect(deAssets).toContain('id="studioBulkMoveSummary"');
    expect(deAssets).toContain('id="studioActionResult"');
    expect(deAssets).toContain('Aktionsergebnis');
    expect(deAssets).toContain('Ergebnisse von Umbenennen, Verschieben, Löschen und Ordneraktionen erscheinen hier nach Backend-Bestätigung.');
    expect(deAssets).toContain('Ordner- und Auswahlwerkzeuge bleiben auf Smartphones hier.');
    expect(deAssets).not.toContain('Zuerst privat');
    expect(deAssets).not.toContain('Aktionen bleiben gebündelt</h3>');
    expect(deAssets).not.toContain('Speicher ist getrennt von Credits');
    expect(deAssets).not.toContain('Credits werden in Credits geprüft und durch Generierung verbraucht, nicht durch Ordnerorganisation.');
    expect(deAssets).not.toContain('href="/de/account/credits.html?scope=member&amp;source=assets-manager"');
    expect(deAssets).not.toContain('href="/de/generate-lab/?source=assets-manager&amp;step=create"');
    expect(deAssets).toContain('Auswahlmodus aktiv');
    expect(deAssets).toContain('Auf Smartphones bleiben ausgewählte Anzahl und Bulk-Aktionen direkt unter dieser Hilfe sichtbar.');
    expect(deAssets).toContain('Ausgewählte Assets verschieben');
    expect(deAssets).toContain('Ihre Auswahl bleibt verfügbar, wenn Speichern fehlschlägt.');
    expect(deAssets).toContain('href="/de/generate-lab/"');
    expect(deAssets).toContain('Anmelden, um den Assets Manager zu öffnen');
    expect(deAssets).toContain('data-auth-message-key="authRecovery.assetsMessage"');
    expect(deAssets).toContain('Nach der Anmeldung hier fortfahren, um Ihre gespeicherte Bibliothek');
    expect(deAssets).toContain('data-auth-source="assets-manager"');
    expect(deAssets).toContain('href="/de/account/forgot-password.html?source=assets-manager"');
    expect(helpMenu).toContain("id: 'saved-output-recovery'");
    expect(helpMenu).toContain('Find saved output');
    expect(helpMenu).toContain('Gespeicherte Ergebnisse finden');
    expect(helpMenu).toContain('refresh the library or show all assets');
    expect(helpMenu).toContain('aktualisieren Sie die Bibliothek oder zeigen Sie alle Assets an');
    expect(helpMenu).toContain("id: 'private-publishing'");
    expect(helpMenu).toContain('Private until published');
    expect(helpMenu).toContain('Privat bis zur Veröffentlichung');
    expect(helpMenu).toContain("id: 'mobile-asset-actions'");
    expect(helpMenu).toContain('Mobile asset actions');
    expect(helpMenu).toContain('Mobile Asset-Aktionen');
    expect(helpMenu).toContain('Storage quota and credits are separate account concepts.');
    expect(helpMenu).toContain('Speicherplatz und Credits sind getrennte Konto-Konzepte.');
    expect((helpMenu.match(/id: 'storage-vs-credits'/g) || [])).toHaveLength(1);
    expect(localeJs).toContain("actionMoveSuccessTitle: 'Move confirmed'");
    expect(localeJs).toContain("actionMoveSuccessTitle: 'Verschieben bestätigt'");
    expect(localeJs).toContain("actionDeleteSuccessMeta: 'Deleted items cannot be restored from this workspace.");
    expect(localeJs).toContain("actionDeleteSuccessMeta: 'Gelöschte Elemente können in diesem Workspace nicht wiederhergestellt werden.");

    expect(enGenerate).not.toContain('href="../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(enGenerate).not.toContain('generate-lab__member-nav');
    expect(enGenerate).not.toContain('id="generateWorkspacePriority"');
    expect(enGenerate).not.toContain('Prepare, generate, save, manage');
    expect(enGenerate).not.toContain('href="/account/profile.html?returnContext=generate-lab#profileCompletionCard"');
    expect(enGenerate).not.toContain('generate-lab__session-panel');
    expect(enGenerate).not.toContain('Signed-in workspace status');
    expect(enGenerate).not.toContain('id="labSessionAccountStatus"');
    expect(enGenerate).not.toContain('generate-lab__first-run');
    expect(enGenerate).not.toContain('generate-lab__account-needed');
    expect(enGenerate).not.toContain('Create, preview, save, then manage');
    expect(enGenerate).toContain('Optimized for desktop');
    expect(enGenerate).toContain('This creation workspace is built for desktop');
    expect(enGenerate).toContain('Open BITBI homepage');
    expect(enGenerate).not.toContain('Mobile creation flow');
    expect(enGenerate).not.toContain('The full Generate Lab workspace is available below');
    expect(enGenerate).not.toContain('Start prompt');
    expect(enGenerate).not.toContain('Review cost');
    expect(enGenerate).not.toContain('generate-lab__topbar');
    expect(enGenerate).not.toContain('id="generateLabTitle"');
    expect(enGenerate).not.toContain('Create images, videos, and music with BITBI');
    expect(enGenerate).not.toContain('generate-lab__composer-flow');
    expect(enGenerate).not.toContain('Write or refine the idea here.');
    expect(enGenerate).not.toContain('Backend validation confirms final credits');
    expect(enGenerate).not.toContain('id="labCreditRecovery"');
    expect(enGenerate).not.toContain('Low or unknown credits?');
    expect(enGenerate).not.toContain('Open Credits to refresh balance');
    expect(enGenerate).not.toContain('Check saved assets');
    expect(enGenerate).not.toContain('The result stays visible after save errors');
    expect(enGenerate).not.toContain('Saved output opens from Assets Manager');
    expect(enGenerate).not.toContain('Ready to configure');
    expect(enGenerate).not.toContain('Pick a model, review estimated credits, then generate.');
    expect(enGenerate).not.toContain('Review credits');
    expect(enGenerate).not.toContain('Images remain in preview until you save them.');
    expect(enGenerate).not.toContain('id="labCurrentResult"');
    expect(enGenerate).not.toContain('No preview yet');
    expect(enGenerate).not.toContain('Jump to preview');
    expect(enGenerate).toContain('Backend-loaded saved assets');
    expect(enGenerate).not.toContain('Show all saved');
    expect(enGenerate).not.toContain('data-auth-message-key="authRecovery.generateMessage"');
    expect(enGenerate).not.toContain('Sign in before generation or saving');
    expect(enGenerate).not.toContain('After sign-in, continue here with the current prompt');
    expect(enGenerate).not.toContain('data-auth-source="generate-lab"');
    expect(enGenerate).not.toContain('href="/account/forgot-password.html?source=generate-lab"');

    expect(deGenerate).not.toContain('href="../../css/components/member-workflow.css?v=__ASSET_VERSION__"');
    expect(deGenerate).not.toContain('generate-lab__member-nav');
    expect(deGenerate).not.toContain('id="generateWorkspacePriority"');
    expect(deGenerate).not.toContain('Vorbereiten, generieren, speichern, verwalten');
    expect(deGenerate).not.toContain('href="/de/account/profile.html?returnContext=generate-lab#profileCompletionCard"');
    expect(deGenerate).not.toContain('generate-lab__session-panel');
    expect(deGenerate).not.toContain('Status des angemeldeten Workspace');
    expect(deGenerate).not.toContain('id="labSessionAccountStatus"');
    expect(deGenerate).not.toContain('generate-lab__first-run');
    expect(deGenerate).not.toContain('generate-lab__account-needed');
    expect(deGenerate).not.toContain('Erstellen, prüfen, speichern, verwalten');
    expect(deGenerate).toContain('Für Desktop optimiert');
    expect(deGenerate).toContain('Dieser Erstellungsbereich ist für Desktop gebaut');
    expect(deGenerate).toContain('BITBI-Startseite öffnen');
    expect(deGenerate).not.toContain('Mobiler Erstellungsfluss');
    expect(deGenerate).not.toContain('Der vollständige Generate-Lab-Arbeitsbereich ist unten verfügbar');
    expect(deGenerate).not.toContain('Prompt starten');
    expect(deGenerate).not.toContain('Kosten prüfen');
    expect(deGenerate).not.toContain('generate-lab__topbar');
    expect(deGenerate).not.toContain('id="generateLabTitle"');
    expect(deGenerate).not.toContain('Erstellen Sie Bilder, Videos und Musik');
    expect(deGenerate).not.toContain('generate-lab__composer-flow');
    expect(deGenerate).not.toContain('Idee hier schreiben oder verfeinern.');
    expect(deGenerate).not.toContain('Backend-Validierung bestätigt finale Credits');
    expect(deGenerate).not.toContain('id="labCreditRecovery"');
    expect(deGenerate).not.toContain('Niedrige oder unbekannte Credits?');
    expect(deGenerate).not.toContain('Öffnen Sie Credits, um das Guthaben zu aktualisieren');
    expect(deGenerate).not.toContain('Gespeicherte Assets prüfen');
    expect(deGenerate).not.toContain('Das Ergebnis bleibt nach Speicherfehlern sichtbar');
    expect(deGenerate).not.toContain('Gespeicherte Ergebnisse öffnen aus dem Assets Manager');
    expect(deGenerate).not.toContain('Bereit zum Konfigurieren');
    expect(deGenerate).not.toContain('Wählen Sie ein Modell, prüfen Sie die geschätzten Credits');
    expect(deGenerate).not.toContain('Credits prüfen');
    expect(deGenerate).not.toContain('Bilder bleiben in der Vorschau, bis Sie sie speichern.');
    expect(deGenerate).not.toContain('id="labCurrentResult"');
    expect(deGenerate).not.toContain('Noch keine Vorschau');
    expect(deGenerate).not.toContain('Zur Vorschau');
    expect(deGenerate).toContain('Vom Backend geladene gespeicherte Assets');
    expect(deGenerate).not.toContain('Alle gespeicherten anzeigen');
    expect(deGenerate).not.toContain('data-auth-message-key="authRecovery.generateMessage"');
    expect(deGenerate).not.toContain('Vor Generierung oder Speichern anmelden');
    expect(deGenerate).not.toContain('Nach der Anmeldung hier mit dem aktuellen Prompt');
    expect(deGenerate).not.toContain('data-auth-source="generate-lab"');
    expect(deGenerate).not.toContain('href="/de/account/forgot-password.html?source=generate-lab"');
    expect(helpMenu).toContain("id: 'generate-first-run'");
    expect(helpMenu).toContain('First Generate Lab run');
    expect(helpMenu).toContain('Erster Generate-Lab-Lauf');
    expect(helpMenu).toContain('Sign in before generation or saving.');
    expect(helpMenu).toContain('Vor Generierung oder Speichern anmelden.');
    expect((helpMenu.match(/id: 'generate-first-run'/g) || [])).toHaveLength(1);
    expect(localeJs).toContain("sessionExpiredTitle: 'Session expired. Sign in again.'");
    expect(localeJs).toContain("sessionExpiredTitle: 'Sitzung abgelaufen. Melden Sie sich erneut an.'");
    expect(localeJs).toContain("workspaceStatus: 'Profile, Credits, Generate Lab, and Assets Manager use this account session.'");
    expect(localeJs).toContain("workspaceStatus: 'Profil, Credits, Generate Lab und Assets Manager verwenden diese Kontositzung.'");
    expect(localeJs).toContain("safeContext: 'Only a safe page source is used for this guidance; private URLs, tokens, and asset IDs are not stored.'");
    expect(localeJs).toContain("safeContext: 'Für diese Hilfe wird nur eine sichere Seitenquelle verwendet; private URLs, Tokens und Asset-IDs werden nicht gespeichert.'");
    expect(localeJs).not.toContain("eyebrow: 'Signed-in workspace'");
    expect(localeJs).not.toContain("eyebrow: 'Angemeldeter Arbeitsbereich'");
    expect(localeJs).not.toContain("profileTitle: 'You are signed in to Profile'");
    expect(localeJs).not.toContain("profileTitle: 'Sie sind im Profil angemeldet'");
    expect(localeJs).not.toContain("generateLabTitle: 'You are signed in to Generate Lab'");
    expect(localeJs).not.toContain("generateLabTitle: 'Sie sind im Generate Lab angemeldet'");
    expect(localeJs).not.toContain("raw return URLs, tokens, and asset IDs are not stored");
    expect(localeJs).not.toContain("rohe Rückkehr-URLs, Tokens und Asset-IDs werden nicht gespeichert");
    expect(localeJs).toContain("walletStatusRefreshed: 'Wallet status refreshed from the existing account endpoint.'");
    expect(localeJs).toContain("walletStatusRefreshed: 'Wallet-Status aus dem bestehenden Konto-Endpunkt aktualisiert.'");
    expect(helpMenu).toContain("id: 'wallet-safety'");
    expect(helpMenu).toContain('Wallet linking is an identity hint, not custody');
    expect(helpMenu).toContain('BITBI fragt nie nach Seed-Phrasen oder privaten Schlüsseln');
    expect((helpMenu.match(/id: 'wallet-safety'/g) || []).length).toBe(1);

    for (const html of [deProfile, deCredits, deAssets, deGenerate]) {
      expect(html).not.toContain('/de/admin');
    }
    expect(localeJs).toContain("creditBalanceUnavailable: 'Credit balance unavailable. Review Credits, then retry generation.'");
    expect(localeJs).toContain("creditBalanceUnavailable: 'Credit-Guthaben nicht verfügbar. Prüfen Sie Credits und versuchen Sie die Generierung erneut.'");
    expect(localeJs).not.toContain('costInsightLow');
    expect(localeJs).not.toContain("returnErrorTitle: 'Checkout needs another try'");
    expect(localeJs).not.toContain("returnErrorTitle: 'Checkout braucht einen neuen Versuch'");
    expect(localeJs).not.toContain("returnSuccessTitle: 'Check your verified balance below'");
    expect(localeJs).not.toContain("returnActionGenerate: 'Open Generate Lab'");
    expect(localeJs).toContain("pricingTitle: 'Checkout starts from an account'");
    expect(localeJs).toContain("pricingTitle: 'Checkout startet aus einem Konto'");
    expect(localeJs).toContain("generateTitle: 'Generate and save with your account'");
    expect(localeJs).toContain("generateTitle: 'Mit Ihrem Konto generieren und speichern'");
    expect(localeJs).toContain("contextReset: 'Reset password'");
    expect(localeJs).toContain("contextReset: 'Passwort zurücksetzen'");
    expect(localeJs).toContain("contextVerify: 'Email verification'");
    expect(localeJs).toContain("contextVerify: 'E-Mail-Bestätigung'");
  });

  test('account recovery and verification pages provide localized trust guidance', () => {
    const enForgot = repoFile('account/forgot-password.html');
    const deForgot = repoFile('de/account/forgot-password.html');
    const enReset = repoFile('account/reset-password.html');
    const deReset = repoFile('de/account/reset-password.html');
    const enVerify = repoFile('account/verify-email.html');
    const deVerify = repoFile('de/account/verify-email.html');

    expect(enForgot).toContain('id="accountRecoveryTrust"');
    expect(enForgot).toContain('auth-page__disclosure');
    expect(enForgot).toContain('Account recovery is private');
    expect(enForgot).toContain('Show details');
    expect(enForgot).toContain('same success message whether or not an email exists');
    expect(enForgot).not.toContain('id="accountRecoveryNext"');
    expect(enForgot).not.toContain('Return to the signed-in workspace');
    expect(enForgot).not.toContain('href="/account/profile.html?returnContext=recovery#profileSecurityCard"');
    expect(enForgot).not.toContain('href="/account/credits.html?scope=member&amp;source=recovery"');
    expect(deForgot).toContain('id="accountRecoveryTrust"');
    expect(deForgot).toContain('auth-page__disclosure');
    expect(deForgot).toContain('Kontowiederherstellung bleibt privat');
    expect(deForgot).toContain('Details anzeigen');
    expect(deForgot).toContain('dieselbe Erfolgsmeldung, unabhängig davon, ob eine E-Mail existiert');
    expect(deForgot).not.toContain('id="accountRecoveryNext"');
    expect(deForgot).not.toContain('Zur angemeldeten Arbeitsumgebung zurückkehren');
    expect(deForgot).not.toContain('href="/de/account/profile.html?returnContext=recovery#profileSecurityCard"');
    expect(deForgot).not.toContain('href="/de/account/credits.html?scope=member&amp;source=recovery"');

    expect(enReset).toContain('id="resetSecurityTrust"');
    expect(enReset).toContain('Before you change it');
    expect(enReset).toContain('id="resetRecoveryContinuity"');
    expect(enReset).toContain('Use the newest reset email');
    expect(enReset).toContain('href="/account/assets-manager.html?source=reset-password&amp;recent=1#generate-lab-recent"');
    expect(enReset).toContain('data-auth-entry="login"');
    expect(enReset).toContain('href="/account/profile.html"');
    expect(deReset).toContain('id="resetSecurityTrust"');
    expect(deReset).toContain('Bevor Sie es ändern');
    expect(deReset).toContain('id="resetRecoveryContinuity"');
    expect(deReset).toContain('Die neueste Reset-E-Mail verwenden');
    expect(deReset).toContain('href="/de/account/assets-manager.html?source=reset-password&amp;recent=1#generate-lab-recent"');
    expect(deReset).toContain('data-auth-entry="login"');
    expect(deReset).toContain('href="/de/account/profile.html"');

    expect(enVerify).toContain('Email confirmation is checked by the backend account record');
    expect(enVerify).not.toContain('id="verifyRecoveryContinuity"');
    expect(enVerify).not.toContain('Email status protects account-bound work');
    expect(enVerify).not.toContain('href="/account/profile.html?returnContext=verification#profileSecurityCard"');
    expect(enVerify).toContain('href="/account/forgot-password.html"');
    expect(enVerify).toContain('href="/account/profile.html"');
    expect(deVerify).toContain('Die E-Mail-Bestätigung wird im Backend-Kontodatensatz geprüft');
    expect(deVerify).not.toContain('id="verifyRecoveryContinuity"');
    expect(deVerify).not.toContain('E-Mail-Status schützt kontogebundene Arbeit');
    expect(deVerify).not.toContain('href="/de/account/profile.html?returnContext=verification#profileSecurityCard"');
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
    await expect(page.locator('#mobileHeaderCreateAccount')).toBeVisible();
    await expect(page.locator('#mobileHeaderCreateAccount')).toHaveText('CREATE *FREE* ACCOUNT');
    await expect(page.locator('#mobileHeaderCreateAccount')).toHaveAttribute('aria-label', 'Create a free BITBI account');
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
    await expect(mobileNav).not.toContainText('Account workspace needs sign-in');
    await expect(mobileNav).not.toContainText('Signed in as');
    await expect(mobileNav).not.toContainText('Reset password');

    await page.goto('/de/');
    await expect(page.locator('#mobileHeaderCreateAccount')).toBeVisible();
    await expect(page.locator('#mobileHeaderCreateAccount')).toHaveText('CREATE *FREE* ACCOUNT');
    await expect(page.locator('#mobileHeaderCreateAccount')).toHaveAttribute('aria-label', 'Kostenloses BITBI-Konto erstellen');
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
    await expect(mobileNav).not.toContainText('Konto-Workspace benötigt Anmeldung');
    await expect(mobileNav).not.toContainText('Angemeldet als');
    await expect(mobileNav).not.toContainText('Passwort zurücksetzen');
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
      'Library view',
      'Folder overview',
      'Refresh latest',
      'Folder and selection tools stay here on phones.',
      'On phones, selected count and bulk actions stay directly below this guide.',
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
      'Mobile creation flow',
      'Start prompt',
      'Backend validation confirms final credits',
      'Current result',
      'No preview yet',
      'Jump to preview',
      'Backend-loaded saved assets',
      'Show all saved',
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
      'Creation Workspace',
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
        if (file === 'de/index.html' && phrase === 'Open Generate Lab') {
          expect(visibleText, `${file} keeps the operator-requested homepage CTA label`).toContain(phrase);
          continue;
        }
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
