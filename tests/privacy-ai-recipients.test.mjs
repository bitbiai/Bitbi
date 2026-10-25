import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { CONSUMER_TERMS_VERSION, consumerConsentText } from '../js/shared/consumer-contract.mjs';
import { CONSUMER_TERMS_CONTENT, HISTORICAL_CONSUMER_TERMS_CONTENT } from '../workers/auth/src/lib/consumer-terms-content.js';
import { listAdminAiCatalog } from '../js/shared/admin-ai-contract.mjs';
import { CANVAS_ASSISTANT_MODELS } from '../js/shared/canvas-assistant-models.mjs';
import { ASSISTANT_MODELS } from '../workers/auth/src/lib/website-assistant-policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
const require = createRequire(import.meta.url);
const { yaml } = require('../node_modules/playwright-core/lib/utilsBundle.js');
const PAGES = [
  'legal/privacy.html',
  'de/legal/datenschutz.html',
  'de/legal/privacy.html',
  'legal/datenschutz.html',
];
const pages = Object.fromEntries(PAGES.map(file => [file, read(file)]));

function modelIds(html) {
  return new Set([...html.matchAll(/data-model="([^"]+)"/g)].map(match => match[1]));
}

function markupOutsideScripts(html) {
  const lower = html.toLowerCase();
  let cursor = 0;
  let visible = '';
  while (cursor < html.length) {
    const open = lower.indexOf('<script', cursor);
    if (open === -1) {
      visible += html.slice(cursor);
      break;
    }
    const openEnd = lower.indexOf('>', open);
    const close = openEnd === -1 ? -1 : lower.indexOf('</script', openEnd + 1);
    const closeEnd = close === -1 ? -1 : lower.indexOf('>', close);
    if (openEnd === -1 || close === -1 || closeEnd === -1) {
      visible += html.slice(cursor);
      break;
    }
    visible += html.slice(cursor, open);
    cursor = closeEnd + 1;
  }
  return visible;
}

function visibleText(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', szlig: 'ß' };
  return markupOutsideScripts(html).replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return entities[code] ?? all;
  }).replace(/\s+/g, ' ').trim();
}

function legalBody(html) {
  const body = html.match(/<div class="card-stack--legal">([\s\S]*?)<p class="last-updated">/);
  assert.ok(body, 'legal document body must remain identifiable');
  return body[1];
}

function legalBlocks(html) {
  return [...legalBody(html).matchAll(/<(h2|h3|p|li|th|td)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(match => visibleText(match[2]));
}

function verifyDocumentStructure(html, kind) {
  const body = legalBody(html);
  const headings = [...body.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(match => visibleText(match[1]));
  const numbers = headings.map(heading => heading.match(/^(\d+a?)\./)?.[1]).filter(Boolean);
  const expected = kind === 'terms' ? Array.from({ length: 22 }, (_, i) => String(i + 1))
    : ['1', '2', '3', '4', '5', '5a', ...Array.from({ length: 11 }, (_, i) => String(i + 6))];
  assert.deepEqual(numbers, expected, `${kind} numbered sections must remain complete and ordered`);
  const text = visibleText(body);
  assert.doesNotMatch(text, /\[(?:P|V)\d|EFFECTIVE_DATE|ARBEITSENTWURF|working draft|PRIVATE PREVIEW|PRIVATE VORSCHAU|Variante [AB]|Option [AB]|\/Users\//i);
  if (kind === 'privacy') {
    assert.deepEqual(headings.filter(heading => /^(?:Appendix|Anhang) [AB] /.test(heading)).map(heading => heading.match(/^(?:Appendix|Anhang) ([AB])/)[1]), ['A', 'B']);
    assert.equal((body.match(/<table\b/g) || []).length, 3, 'retention, provider and browser-storage tables must remain');
  }
}

function requiredModelIds() {
  const ids = new Set();
  const catalog = listAdminAiCatalog({ includeCanvas: true });
  for (const models of Object.values(catalog.models)) {
    for (const model of models) ids.add(model.id);
  }
  for (const model of CANVAS_ASSISTANT_MODELS) ids.add(model.modelId);
  for (const id of Object.keys(ASSISTANT_MODELS)) ids.add(id);
  const grokChat = read('workers/ai/src/lib/grok-chat.js');
  const search = grokChat.match(/export const GROK_SEARCH_MODEL_ID = "([^"]+)"/);
  assert.ok(search, 'private Grok search model id must stay explicit in grok-chat.js');
  ids.add(search[1]);
  return { ids, catalog };
}

const { ids, catalog } = requiredModelIds();

test('privacy pages disclose every catalog, assistant, and private-search model route', () => {
  assert.ok(ids.size >= 35, `expected the verified recipient set, found ${ids.size}`);
  for (const [file, html] of Object.entries(pages)) {
    const listed = modelIds(html);
    for (const id of ids) assert.ok(listed.has(id), `${file} does not name ${id}`);
    assert.deepEqual(listed, ids, `${file} has a recipient row that is not in the model catalog`);
  }
});

test('privacy pages name every catalog vendor', () => {
  const vendors = new Set();
  for (const models of Object.values(catalog.models)) {
    for (const model of models) if (model.vendor) vendors.add(model.vendor);
  }
  assert.ok(vendors.has('xAI') && vendors.has('ByteDance') && vendors.has('Alibaba'));
  for (const [file, html] of Object.entries(pages)) {
    const text = html.toLowerCase();
    for (const vendor of vendors) assert.ok(text.includes(vendor.toLowerCase()), `${file} does not mention ${vendor}`);
  }
});

test('privacy copies retain route language, aliases, metadata and current publication version', () => {
  const english = pages['legal/privacy.html'];
  assert.match(visibleText(english), /Version dated 24 October 2026/);
  assert.match(english, /Last updated: October 24, 2026/);
  assert.match(english, /<link rel="canonical" href="https:\/\/bitbi\.ai\/legal\/privacy\.html">/);
  assert.match(english, /<html lang="en"/);
  assert.doesNotMatch(markupOutsideScripts(english), /AGB/);
  const german = pages['de/legal/datenschutz.html'];
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    assert.match(visibleText(pages[file]), /Stand: 24\. Oktober 2026/);
    assert.match(pages[file], /<p class="last-updated">Stand: 24\. Oktober 2026<\/p>/);
    assert.match(pages[file], /<html lang="de"/);
    assert.deepEqual(legalBlocks(pages[file]), legalBlocks(german), `${file} German alias content drift`);
  }
  for (const html of Object.values(pages)) {
    assert.match(html, /<meta name="robots" content="noindex, follow">/);
    assert.match(html, /<section id="website-assistant"[^>]*aria-labelledby="legal-section-6">/);
    assert.doesNotMatch(html, /andere konfigurierte Modellanbieter|other configured model providers/);
  }
  assert.doesNotMatch(read('sitemap.xml'), /legal\/privacy|datenschutz/);
  for (const sample of [
    '<p>visible</p><script>AGB</script><p>after</p>',
    '<p>visible</p><SCRIPT type="text/javascript">AGB</SCRIPT><p>after</p>',
    '<p>visible</p><script type="module">AGB</script ><p>after</p>',
  ]) assert.equal(markupOutsideScripts(sample), '<p>visible</p><p>after</p>');
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html']) {
    assert.match(pages[file], /\/de\/legal\/datenschutz\.html/);
    assert.match(pages[file], /\/de\/legal\/terms\.html/);
    assert.doesNotMatch(pages[file], /href="datenschutz\.html"|href="terms\.html"|href="imprint\.html"/);
  }
  assert.match(pages['de/legal/datenschutz.html'], /<link rel="canonical" href="https:\/\/bitbi\.ai\/de\/legal\/datenschutz\.html">/);
  assert.match(pages['de/legal/privacy.html'], /<link rel="canonical" href="https:\/\/bitbi\.ai\/de\/legal\/datenschutz\.html">/);
  assert.match(pages['legal/datenschutz.html'], /<link rel="canonical" href="https:\/\/bitbi\.ai\/legal\/datenschutz\.html">/);
});

test('disclosures distinguish dated register observations, unconfirmed account coverage and real hosting', () => {
  const english = visibleText(pages['legal/privacy.html']);
  for (const participant of [5666, 5780, 9996]) assert.match(english, new RegExp(`no\\. ${participant}`));
  assert.match(english, /23 October 2026/);
  assert.match(english, /Eleven Labs Inc\./);
  assert.match(english, /Active – Re-certification under Review/);
  assert.match(english, /dated registry observation, not a promise of continued certification/);
  assert.match(english, /Article 46\(2\)\(c\) GDPR/);
  assert.match(english, /Switzerland and the United Kingdom/);
  assert.match(english, /December 2025/);
  assert.match(english, /Plus Five Five, Inc\./);
  assert.match(english, /processor or independent controller depending on purpose/);
  assert.match(english, /not the public website host/);
  assert.match(english, /actual recipient entity and applicable contractual and transfer chain have not yet been fully confirmed/);
  assert.match(english, /exclude certain third-party products on third-party infrastructure from Cloudflare's DPA/);
  for (const html of Object.values(pages)) {
    assert.doesNotMatch(html, /GitHub Pages|public product code does not show whether|zeigt nicht, ob BITBI diese Klauseln/);
    assert.doesNotMatch(html, /we rely on.*otherwise on standard contractual clauses|intended safeguard/i);
    assert.match(html, /api\.vidu\.com/);
    assert.match(html, /Canvas/);
  }
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    const text = visibleText(pages[file]);
    assert.match(text, /Nr\. 9996/);
    assert.match(text, /Art\. 46 Abs\. 2 Buchst\. c DSGVO/);
    assert.match(text, /Plus Five Five, Inc\./);
    assert.match(text, /UK-Angemessenheit/);
    assert.match(text, /noch nicht vollständig bestätigt/);
    assert.match(text, /Drittanbieterprodukte auf fremder Infrastruktur von Cloudflares DPA/);
  }
});

test('analytics and retention disclosures do not turn missing proof into opt-out or erasure promises', () => {
  const english = visibleText(pages['legal/privacy.html']);
  assert.match(english, /does not reliably prevent this analytics activity/);
  assert.match(english, /Those test requests were intercepted before transmission/);
  assert.match(english, /prove neither acceptance nor storage by Cloudflare/);
  assert.match(english, /90 days/);
  assert.match(english, /archiv/i);
  assert.match(english, /bitbi_home_scroll_restore_v2/);
  const german = visibleText(pages['de/legal/datenschutz.html']);
  assert.match(german, /verhindert diese Analyse nicht zuverlässig/);
  assert.match(german, /Testanfragen wurden vor dem Versand abgefangen/);
  assert.match(german, /weder ihre Annahme noch ihre Speicherung durch Cloudflare belegt/);
  assert.match(german, /90 Tage/);
  assert.match(german, /Archiv/);
});

const inventory = JSON.parse(read('config/privacy-provider-routes.json'));
function verifyRoutes(routes, required, documents, sources = read) {
  const primary = routes.filter(route => ['hosted', 'gateway'].includes(route.transport));
  const mapped = primary.flatMap(route => route.models);
  assert.equal(new Set(mapped).size, mapped.length, 'a model has competing primary routes');
  assert.deepEqual(new Set(mapped), required, 'new or removed model needs an explicit route review');
  for (const [file, html] of Object.entries(documents)) {
    assert.deepEqual(modelIds(html), required, `${file} model disclosure is incomplete`);
    for (const route of routes) {
      for (const id of route.models) assert.ok(required.has(id), `unknown model ${id}`);
      for (const file of [route.source, ...(route.additionalSources || [])]) {
        assert.ok(sources(file).length > 0, `missing caller ${file}`);
      }
      if (route.transport === 'hosted') {
        assert.equal(route.recipient, 'Cloudflare, Inc.');
        assert.ok(route.models.every(id => id.startsWith('@cf/')), 'hosted recipient misclassification');
      } else assert.ok(route.models.every(id => !id.startsWith('@cf/')), 'model author is not a hosted recipient');
      if (route.host) {
        assert.ok(sources(route.source).includes(`https://${route.host}`), 'direct host drift');
        assert.ok(html.includes(route.host), `${file} missing direct route ${route.host}`);
      }
    }
  }
  const direct = routes.filter(route => route.host);
  for (const file of new Set(routes.flatMap(route => [route.source, ...(route.additionalSources || [])]))) {
    for (const match of sources(file).matchAll(/https:\/\/(api\.[a-z0-9.-]+|app-api\.[a-z0-9.-]+)/g)) {
      const host = match[1];
      if (host !== 'api.cloudflare.com') assert.ok(direct.some(route => route.host === host && route.source === file), `unreviewed API recipient ${host}`);
    }
  }
}

test('route guard covers the actual catalog and direct callers, with drift counterchecks', () => {
  verifyRoutes(inventory.routes, ids, pages);
  assert.throws(() => verifyRoutes(inventory.routes, new Set([...ids, 'new-provider/new-model']), pages), /explicit route review/);
  const wrongRecipient = structuredClone(inventory.routes);
  wrongRecipient.find(route => route.transport === 'hosted').recipient = 'OpenAI';
  assert.throws(() => verifyRoutes(wrongRecipient, ids, pages));
  const withoutFallback = inventory.routes.filter(route => route.id !== 'vidu-admin-direct');
  assert.throws(() => verifyRoutes(withoutFallback, ids, pages), /unreviewed API recipient api.vidu.com/);
  assert.throws(() => verifyRoutes(inventory.routes, ids, pages, file => read(file) + (file === 'workers/ai/src/lib/invoke-ai-video.js' ? '\nconst unexpected = "https://api.new-provider.example/run";' : '')), /unreviewed API recipient/);
  assert.throws(() => verifyRoutes(inventory.routes, ids, pages, file => read(file) + (file === 'workers/auth/src/lib/canvas-agent-model-operations.js' ? '\nconst unexpected = "https://api.unreviewed-assistant.example/run";' : '')), /unreviewed API recipient/);
  const removed = { ...pages, 'legal/privacy.html': pages['legal/privacy.html'].replace('data-model="xai/grok-4.7"', 'data-removed-model="xai/grok-4.7"') };
  assert.throws(() => verifyRoutes(inventory.routes, ids, removed), /incomplete/);
});

test('persistent assistant and conditional direct routes are distinguished from hosted model authors', () => {
  const english = visibleText(pages['legal/privacy.html']);
  assert.match(english, /REST background processing/);
  assert.match(english, /native Messages format/);
  assert.match(english, /Nanonoble Pte\. Ltd\./);
  assert.match(english, /Public API terms name MOTIVAI PRIVATE LIMITED/);
  assert.match(english, /Singapore storage and possible China processing/);
  assert.match(english, /Developer names do not establish extra API calls/);
  assert.match(english, /conditional direct fallback at api\.vidu\.com/);
  assert.doesNotMatch(english, /direct api\.vidu\.com[^.]*disabled/i);
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    const text = visibleText(pages[file]);
    assert.match(text, /REST-Hintergrundverarbeitung/);
    assert.match(text, /nativem Messages-Format/);
    assert.match(text, /Nanonoble Pte\. Ltd\./);
    assert.match(text, /API-Bedingungen nennen MOTIVAI PRIVATE LIMITED/);
  }
});

test('terms preserve withdrawal, usable-result rights and bounded input and output licences', () => {
  const englishHtml = read('legal/terms.html'), germanHtml = read('de/legal/terms.html');
  const english = visibleText(legalBody(englishHtml)), german = visibleText(legalBody(germanHtml));
  for (const html of [englishHtml, germanHtml]) assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.match(english, /Version dated 25 October 2026/);
  assert.match(english, /Model withdrawal form/);
  assert.match(english, /Schwarzwaldstraße 20, 78647 Trossingen, Germany/);
  assert.match(english, /saved, playable exported video with the agreed audio or music and its editable Canvas project/);
  assert.match(english, /raises the combined existing credit balance to no more than ten credits/);
  assert.match(english, /§ 356\(6\) no\. 2 BGB/);
  assert.match(english, /not a waiver of the right of withdrawal/);
  assert.match(english, /not its full performance/);
  assert.match(english, /No blanket licence is granted for every commercial use/);
  assert.match(english, /does not automatically authorise independent advertising or model training using private content/);
  assert.match(english, /responsibility for its own necessary provider and service permissions is not shifted to you/);
  assert.match(english, /internal supplier invoice or credit entry alone does not determine/);
  assert.match(english, /payment-provider change has already occurred/);
  assert.match(english, /Existing contracts are not automatically replaced/);
  assert.match(german, /Fassung vom 25\. Oktober 2026/);
  assert.match(german, /Muster-Widerrufsformular/);
  assert.match(german, /Schwarzwaldstraße 20, 78647 Trossingen, Deutschland/);
  assert.match(german, /§ 356 Abs\. 6 Nr\. 2 BGB/);
  assert.match(german, /keinen Verzicht auf das Widerrufsrecht/);
  assert.match(german, /kein fertiger Film/);
  assert.match(german, /nicht seine vollständige Erfüllung/);
  assert.match(german, /Eine pauschale Lizenz für jede kommerzielle Verwendung sämtlicher Modellergebnisse wird nicht erteilt/);
  assert.match(german, /Bestätigungs-E-Mail|technischer Mailfehler/);
  for (const [html, paths] of [[englishHtml, ['withdrawal', 'cancellation']], [germanHtml, ['widerruf', 'kuendigung']]]) {
    for (const path of paths) assert.match(html, new RegExp(`href="/(?:de/)?legal/${path}\\.html"`));
  }
  assert.doesNotMatch(english, /credits expire|Credits verfallen/);
  assert.doesNotMatch(german, /Credits verfallen|verfallen die Credits/);
});

test('checkout, complete legal texts and immutable historical content keep explicit versions', () => {
  assert.equal(CONSUMER_TERMS_VERSION, '2026-10-25');
  for (const file of ['js/pages/pricing/main.js', 'js/pages/credits/main.js', 'workers/auth/src/lib/stripe-billing.js']) {
    assert.match(read(file), /consumer-contract\.mjs/);
  }
  function verifyTermsContent(html, text) {
    assert.deepEqual(legalBlocks(html), text.split('\n').filter(Boolean), 'every current terms block must match its contract snapshot text');
  }
  for (const [locale, file] of [['en', 'legal/terms.html'], ['de', 'de/legal/terms.html']]) {
    const content = CONSUMER_TERMS_CONTENT[locale];
    assert.equal(content.version, CONSUMER_TERMS_VERSION);
    assert.match(consumerConsentText(locale).terms, locale === 'de' ? /25\.10\.2026/ : /25 October 2026/);
    verifyTermsContent(read(file), content.text);
    const missingParagraph = read(file).replace(/<p>[^<]*<\/p>/, '');
    assert.notEqual(missingParagraph, read(file), 'countercontrol must remove a real paragraph');
    assert.throws(() => verifyTermsContent(missingParagraph, content.text), /snapshot text/);
    assert.equal(HISTORICAL_CONSUMER_TERMS_CONTENT['2026-10-23'][locale].version, '2026-10-23');
    assert.equal(HISTORICAL_CONSUMER_TERMS_CONTENT['2026-10-24'][locale].version, '2026-10-24');
    assert.match(HISTORICAL_CONSUMER_TERMS_CONTENT['2026-10-24'][locale].text, locale === 'de' ? /keinen pauschalen Verzicht/ : /not a blanket waiver/);
  }
  // Original a4b2cc3c bundle retained byte-for-byte; do not silently replace old accepted text.
  assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'workers/auth/src/lib/consumer-terms-content-2026-10-23.js'))).digest('hex'),
    '6480399bd5ebdeb5ac97df401fa10578fad273c774e99bdb750a4a6a59905f28');
});

test('complete numbered documents and both privacy appendices cannot disappear during conversion', () => {
  for (const html of Object.values(pages)) verifyDocumentStructure(html, 'privacy');
  for (const file of ['legal/terms.html', 'de/legal/terms.html']) verifyDocumentStructure(read(file), 'terms');
  const missingSection = pages['legal/privacy.html'].replace(/>5a\. Public website assistant<\/h2>/, '>Missing section</h2>');
  assert.notEqual(missingSection, pages['legal/privacy.html']);
  assert.throws(() => verifyDocumentStructure(missingSection, 'privacy'), /complete and ordered/);
  const withoutAppendix = pages['legal/privacy.html'].replace('Appendix B — BITBI browser storage', 'Removed appendix');
  assert.throws(() => verifyDocumentStructure(withoutAppendix, 'privacy'));
  assert.throws(() => verifyDocumentStructure(read('legal/terms.html').replace('1. Provider and scope', '[V1: unfinished]'), 'terms'));
});

test('the protected release executes the privacy guard through its unconditional asset-version caller', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const plan = yaml.parse(read('config/release-validation.yml'));
  function verifyCaller(commands, contract) {
    assert.match(commands['test:asset-version'], /node --test\b[^\n]*tests\/privacy-ai-recipients\.test\.mjs/);
    const steps = contract.jobs['release-compatibility'].steps;
    const caller = steps.find(step => step.run === 'npm run test:asset-version');
    assert.ok(caller, 'protected release must execute the privacy guard');
    assert.equal(caller.if, undefined, 'privacy guard must not depend on a product-suite selection');
  }
  verifyCaller(scripts, plan);
  const missing = structuredClone(plan);
  missing.jobs['release-compatibility'].steps = missing.jobs['release-compatibility'].steps
    .filter(step => step.run !== 'npm run test:asset-version');
  assert.throws(() => verifyCaller(scripts, missing), /must execute/);
  const conditional = structuredClone(plan);
  conditional.jobs['release-compatibility'].steps.find(step => step.run === 'npm run test:asset-version').if = 'false';
  assert.throws(() => verifyCaller(scripts, conditional), /must not depend/);
  assert.throws(() => verifyCaller({ ...scripts, 'test:asset-version': 'node scripts/test-asset-version.mjs' }, plan));
});

test('all legal table wrappers are keyboard-focusable and named independently of attribute ordering', () => {
  for (const [file, html] of Object.entries(pages)) {
    const wrappers = [...legalBody(html).matchAll(/<div\b[^>]*class="policy-table-wrap"[^>]*>/g)].map(match => match[0]);
    assert.equal(wrappers.length, 3, `${file} requires named retention, provider and storage table wrappers`);
    for (const wrapper of wrappers) {
      assert.match(wrapper, /tabindex="0"/);
      assert.match(wrapper, /role="region"/);
      assert.match(wrapper, /aria-label="[^"\s][^"]+"/);
    }
  }
  assert.match(read('css/pages/legal.css'), /\.policy-table-wrap:focus-visible\s*\{[^}]*outline:/);
});
