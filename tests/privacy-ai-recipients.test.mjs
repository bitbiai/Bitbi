import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAdminAiCatalog } from '../js/shared/admin-ai-contract.mjs';
import { CANVAS_ASSISTANT_MODELS } from '../js/shared/canvas-assistant-models.mjs';
import { ASSISTANT_MODELS } from '../workers/auth/src/lib/website-assistant-policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
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
  assert.match(pages['legal/privacy.html'], /Effective date: <strong class="text-strong">October 22, 2026<\/strong>/);
  assert.match(pages['legal/privacy.html'], /Last updated: October 22, 2026/);
  assert.match(pages['legal/privacy.html'], /href="https:\/\/bitbi\.ai\/legal\/privacy\.html"/);
  assert.match(pages['legal/privacy.html'], /<h2 class="glass-card__title">11\. Infrastructure, Processors, and Transfers<\/h2>/);
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    assert.match(pages[file], /Stand: <strong class="text-strong">22\. Oktober 2026<\/strong>/);
    assert.match(pages[file], /<p class="last-updated">Stand: 22\. Oktober 2026<\/p>/);
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

test('section 11 names third-country recipients without claiming signed clauses', () => {
  const english = pages['legal/privacy.html'];
  assert.match(english, /participant 5666/);
  assert.match(english, /participant 5780/);
  assert.match(english, /Active - Re-certification under Review/);
  assert.match(english, /Article 46\(2\)\(c\) GDPR/);
  assert.match(english, /no European Commission adequacy decision for China/);
  assert.match(english, /no European Commission adequacy decision for Hong Kong/);
  assert.match(english, /no European Commission adequacy decision for Singapore/);
  assert.match(english, /stored in Singapore and processed in China/);
  assert.match(english, /does not show whether BITBI has concluded those clauses/);
  assert.doesNotMatch(english, /we have (signed|concluded) standard contractual clauses/i);
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    const html = pages[file];
    assert.match(html, /Teilnehmer 5666/);
    assert.match(html, /Teilnehmer 5780/);
    assert.match(html, /Art\. 46 Abs\. 2 lit\. c DSGVO/);
    assert.match(html, /kein Angemessenheitsbeschluss der Europ&auml;ischen Kommission/);
    assert.match(html, /in Singapur gespeichert und in China verarbeitet/);
    assert.match(html, /zeigt nicht, ob BITBI diese Klauseln abgeschlossen hat/);
    assert.doesNotMatch(html, /§ 356a|elektronische Widerrufsfunktion/);
  }
});

test('terms include the withdrawal instruction, model form, and output-rights clause', () => {
  const english = read('legal/terms.html');
  const german = read('de/legal/terms.html');
  assert.match(english, /Effective date: October 22, 2026/);
  assert.match(english, /<meta name="robots" content="noindex, follow">/);
  assert.match(english, /Model withdrawal form/);
  assert.match(english, /Muster-Widerrufsformular/);
  assert.match(english, /Schwarzwaldstra&szlig;e 20, 78647 Trossingen, Germany/);
  assert.match(english, /§ 356\(6\) BGB|356\(6\) BGB/);
  assert.match(english, /claims no ownership in those outputs/);
  assert.match(english, /10 free credits each day/);
  assert.doesNotMatch(english, /§ 356a|electronic withdrawal/);
  assert.match(german, /Stand: 22\. Oktober 2026/);
  assert.match(german, /<meta name="robots" content="noindex, follow">/);
  assert.match(german, /Muster-Widerrufsformular/);
  assert.match(german, /Anlage 2 \(zu Artikel 246a § 1 Absatz 2 Satz 1 Nummer 1 und § 2 Absatz 2 Nummer 2 EGBGB\)/);
  assert.match(german, /Schwarzwaldstraße 20, 78647 Trossingen, Deutschland/);
  assert.match(german, /§ 356 Abs\. 6 BGB/);
  assert.match(german, /beansprucht kein Eigentum an diesen Ausgaben/);
  assert.match(german, /10 kostenlose Credits je Tag/);
  assert.doesNotMatch(german, /§ 356a|Widerruf bestätigen|elektronische Widerrufsfunktion/);
  assert.doesNotMatch(english, /credits expire|Credits verfallen/);
  assert.doesNotMatch(german, /Credits verfallen|verfallen die Credits/);
});

test('checkout terms version matches the October 22, 2026 terms date', () => {
  assert.match(read('js/pages/pricing/main.js'), /const TERMS_VERSION = '2026-10-22';/);
  assert.match(read('js/pages/credits/main.js'), /const TERMS_VERSION = '2026-10-22';/);
  assert.match(read('workers/auth/src/lib/stripe-billing.js'), /export const BITBI_TERMS_VERSION = "2026-10-22";/);
});

test('the privacy recipient file is registered on CI node:test commands', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const name of ['test:asset-version', 'test:website-assistant']) {
    assert.match(scripts[name], /node --test\b/);
    assert.match(scripts[name], /tests\/privacy-ai-recipients\.test\.mjs/);
  }
  assert.match(scripts['test:workers'], /npm run test:website-assistant/);
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
