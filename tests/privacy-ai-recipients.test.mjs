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
  assert.match(pages['legal/privacy.html'], /Last updated: 3 May 2026/);
  assert.match(pages['legal/privacy.html'], /href="https:\/\/bitbi\.ai\/legal\/privacy\.html"/);
  assert.match(pages['legal/privacy.html'], /<h2 class="glass-card__title">11\. Infrastructure, Processors, and Transfers<\/h2>/);
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'legal/datenschutz.html']) {
    assert.match(pages[file], /3\. Mai 2026/);
    assert.match(pages[file], /<h2 class="glass-card__title">11\. Infrastruktur, Auftragsverarbeiter und Drittlandtransfer<\/h2>/);
  }
  assert.match(pages['de/legal/datenschutz.html'], /href="https:\/\/bitbi\.ai\/de\/legal\/datenschutz\.html"/);
  for (const html of Object.values(pages)) {
    assert.match(html, /<meta name="robots" content="noindex, follow">/);
    assert.doesNotMatch(html, /andere konfigurierte Modellanbieter|other configured model providers/);
  }
  const sitemap = read('sitemap.xml');
  assert.doesNotMatch(sitemap, /legal\/privacy|datenschutz/);
  for (const file of ['legal/privacy.html', 'legal/datenschutz.html']) {
    assert.doesNotMatch(pages[file].replace(/<script[\s\S]*?<\/script>/g, ' '), /AGB/);
  }
  for (const file of ['de/legal/datenschutz.html', 'de/legal/privacy.html']) {
    assert.match(pages[file], /\/de\/legal\/datenschutz\.html/);
    assert.match(pages[file], /\/de\/legal\/terms\.html/);
    assert.doesNotMatch(pages[file], /href="datenschutz\.html"|href="terms\.html"|href="imprint\.html"/);
  }
  assert.match(pages['de/legal/privacy.html'], /<link rel="canonical" href="https:\/\/bitbi\.ai\/de\/legal\/datenschutz\.html">/);
  assert.match(pages['legal/datenschutz.html'], /<link rel="canonical" href="https:\/\/bitbi\.ai\/legal\/datenschutz\.html">/);
});
