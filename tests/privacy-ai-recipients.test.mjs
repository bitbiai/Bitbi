import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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

test('privacy pages name every catalog, assistant, and private-search model recipient', () => {
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

test('privacy copies stay noindex, dated, and outside the sitemap', () => {
  assert.match(pages['legal/privacy.html'], /Effective date: <strong class="text-strong">October 23, 2026<\/strong>/);
  assert.match(pages['legal/privacy.html'], /Last updated: October 23, 2026/);
  assert.match(pages['legal/privacy.html'], /href="https:\/\/bitbi\.ai\/legal\/privacy\.html"/);
  assert.match(pages['legal/privacy.html'], /<h2 class="glass-card__title">11\. Infrastructure, Processors, and Transfers<\/h2>/);
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    assert.match(pages[file], /Stand: <strong class="text-strong">23\. Oktober 2026<\/strong>/);
    assert.match(pages[file], /<p class="last-updated">Stand: 23\. Oktober 2026<\/p>/);
    assert.match(pages[file], /<h2 class="glass-card__title">11\. Infrastruktur, Auftragsverarbeiter und Drittlandtransfer<\/h2>/);
  }
  assert.match(pages['de/legal/datenschutz.html'], /href="https:\/\/bitbi\.ai\/de\/legal\/datenschutz\.html"/);
  for (const html of Object.values(pages)) {
    assert.match(html, /<meta name="robots" content="noindex, follow">/);
    assert.doesNotMatch(html, /andere konfigurierte Modellanbieter|other configured model providers/);
  }
  const sitemap = read('sitemap.xml');
  assert.doesNotMatch(sitemap, /legal\/privacy|datenschutz/);
  const scriptShapes = [
    '<p>visible</p><script>AGB</script><p>after</p>',
    '<p>visible</p><SCRIPT type="text/javascript">AGB</SCRIPT><p>after</p>',
    '<p>visible</p><script type="module">AGB</script ><p>after</p>',
  ];
  for (const sample of scriptShapes) {
    const visible = markupOutsideScripts(sample);
    assert.equal(visible, '<p>visible</p><p>after</p>');
    assert.doesNotMatch(visible, /AGB/);
  }
  for (const file of ['legal/privacy.html', 'legal/datenschutz.html']) {
    assert.doesNotMatch(markupOutsideScripts(pages[file]), /AGB/);
  }
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html']) {
    assert.match(pages[file], /\/de\/legal\/datenschutz\.html/);
    assert.match(pages[file], /\/de\/legal\/terms\.html/);
    assert.doesNotMatch(pages[file], /href="datenschutz\.html"|href="terms\.html"|href="imprint\.html"/);
  }
  assert.match(pages['de/legal/privacy.html'], /<link rel="canonical" href="https:\/\/bitbi\.ai\/de\/legal\/datenschutz\.html">/);
  assert.match(pages['legal/datenschutz.html'], /<link rel="canonical" href="https:\/\/bitbi\.ai\/legal\/datenschutz\.html">/);
});

test('disclosures distinguish verified register scope, account coverage and real hosting', () => {
  const english = pages['legal/privacy.html'];
  for (const participant of [5666, 5780, 9996]) assert.match(english, new RegExp(`participant ${participant}`));
  assert.match(english, /Eleven Labs Inc\./);
  assert.match(english, /Active - Re-certification under Review/);
  assert.match(english, /Article 46\(2\)\(c\) GDPR/);
  assert.match(english, /United Kingdom and Switzerland/);
  assert.match(english, /December 2025/);
  assert.match(english, /Plus Five Five, Inc\./);
  assert.match(english, /processor or as a controller/);
  assert.match(english, /not the configured public website host/);
  assert.match(english, /account-specific coverage.*has not yet been fully confirmed/);
  for (const html of Object.values(pages)) {
    assert.doesNotMatch(html, /GitHub Pages|public product code does not show whether|zeigt nicht, ob BITBI diese Klauseln/);
    assert.doesNotMatch(html, /we rely on.*otherwise on standard contractual clauses|intended safeguard/i);
    assert.match(html, /api\.vidu\.com/);
    assert.match(html, /Canvas/);
  }
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    assert.match(pages[file], /Teilnehmer 9996/);
    assert.match(pages[file], /Art\. 46 Abs\. 2 lit\. c DSGVO/);
    assert.match(pages[file], /Plus Five Five, Inc\./);
    assert.match(pages[file], /UK-Angemessenheit/);
    assert.match(pages[file], /noch nicht vollständig bestätigt/);
  }
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

test('persistent assistant and conditional direct routes are not described as unrelated consumer services', () => {
  const english = pages['legal/privacy.html'];
  assert.match(english, /REST background processing/);
  assert.match(english, /native Messages format/);
  assert.match(english, /Nanonoble Pte\. Ltd\./);
  assert.match(english, /API Platform Terms name MOTIVAI PRIVATE LIMITED/);
  assert.match(english, /Singapore storage and possible China processing/);
  assert.doesNotMatch(english, /direct api\.vidu\.com[^<]*disabled/i);
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    assert.match(pages[file], /REST-Hintergrundverarbeitung/);
    assert.match(pages[file], /nativem Messages-Format/);
    assert.match(pages[file], /Nanonoble Pte\. Ltd\./);
    assert.match(pages[file], /API-Plattformbedingungen nennen MOTIVAI PRIVATE LIMITED/);
  }
});

test('terms include the withdrawal instruction, model form, and output-rights clause', () => {
  const english = read('legal/terms.html');
  const german = read('de/legal/terms.html');
  assert.match(english, /Effective date: October 23, 2026/);
  assert.match(english, /<meta name="robots" content="noindex, follow">/);
  assert.match(english, /Model withdrawal form/);
  assert.match(english, /Muster-Widerrufsformular/);
  assert.match(english, /Schwarzwaldstra&szlig;e 20, 78647 Trossingen, Germany/);
  assert.match(english, /§ 356\(6\) BGB|356\(6\) BGB/);
  assert.match(english, /claims no ownership in those outputs/);
  assert.match(english, /10 free credits each day/);
  assert.match(english, /href="\/legal\/withdrawal\.html"/);
  assert.match(english, /href="\/legal\/cancellation\.html"/);
  assert.match(english, /does not automatically treat/);
  assert.match(english, /not a blanket waiver/);
  assert.match(english, /not full performance/);
  assert.match(english, /does not grant a blanket licence/);
  assert.match(german, /Stand: 23\. Oktober 2026/);
  assert.match(german, /<meta name="robots" content="noindex, follow">/);
  assert.match(german, /Muster-Widerrufsformular/);
  assert.match(german, /Anlage 2 \(zu Artikel 246a § 1 Absatz 2 Satz 1 Nummer 1 und § 2 Absatz 2 Nummer 2 EGBGB\)/);
  assert.match(german, /Schwarzwaldstraße 20, 78647 Trossingen, Deutschland/);
  assert.match(german, /§ 356 Abs\. 6 BGB/);
  assert.match(german, /beansprucht kein Eigentum an diesen Ausgaben/);
  assert.match(german, /10 kostenlose Credits je Tag/);
  assert.match(german, /Widerruf bestätigen/);
  assert.match(german, /href="\/de\/legal\/widerruf\.html"/);
  assert.match(german, /href="\/de\/legal\/kuendigung\.html"/);
  assert.match(german, /kein pauschaler Verzicht/);
  assert.match(german, /keine pauschale Erlaubnis/);
  assert.doesNotMatch(english, /credits expire|Credits verfallen/);
  assert.doesNotMatch(german, /Credits verfallen|verfallen die Credits/);
});

test('checkout and legal versions share one explicit current contract', () => {
  const contract = read('js/shared/consumer-contract.mjs');
  assert.match(contract, /2026-10-23/);
  for (const file of ['js/pages/pricing/main.js', 'js/pages/credits/main.js', 'workers/auth/src/lib/stripe-billing.js']) {
    assert.match(read(file), /consumer-contract\.mjs/);
  }
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

test('recipient table wrappers are keyboard-focusable and named', () => {
  const english = '<div class="policy-table-wrap" tabindex="0" role="region" aria-label="AI models and the companies that receive generation content">';
  const german = '<div class="policy-table-wrap" tabindex="0" role="region" aria-label="KI-Modelle und die Unternehmen, die Generierungsinhalte erhalten">';
  assert.ok(pages['legal/privacy.html'].includes(english));
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    assert.ok(pages[file].includes(german), file);
  }
  assert.match(read('css/pages/legal.css'), /\.policy-table-wrap:focus-visible\s*\{[^}]*outline:/);
});
