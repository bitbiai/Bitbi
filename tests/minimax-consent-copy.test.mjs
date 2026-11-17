import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseFragment } from 'parse5';
import { MINIMAX_CONSENT_COPY } from '../js/shared/minimax-consent-copy.mjs';

// Digests derived independently from Justiziar v3 section 7 (2026-11-16),
// with only the owner-decided retention placeholder replaced. Not HTML snapshots.
const APPROVED = {
  "de": {
    "ui": "8427210222ee943129aa422e78ad9e85513955e0479a391668004564ca113990",
    "privacy": "683798a164a99a01f31f35981702b9945fe360ed65b28989783c2894a3b1bc75",
    "cross": "a1d4e1f4af4eb064884119ded6fe51636ceab524a4caa8262950604babeba65d",
    "rows": "753f1883a20a6b75ee0d9b0667380e5792928552f7ca5173b3297486ddf95ef2",
    "terms": "78c3b5f31397a880b38f901b8301524fd6a176f217993587ff34920f970ca7d1"
  },
  "en": {
    "ui": "bb317aafe5f11acd536dd21e11bed5bf93e237ba8d1b6d2af00449d80a16465a",
    "privacy": "22937a3f4d66856ec441717bdbdc4e63e0bd6452322edbd68d4e95609368a5d6",
    "cross": "443d6af3413f019c3713b062003df4b1b5a42155f76fe3124c06ed7a8785def5",
    "rows": "a364abe797163144c2d3b179e279e957fd972955574c57d3c99efb1bfca47dcf",
    "terms": "dc5b57060cfdbaea41dd6703c8da32c43f478d9f6e140353a4b0af8367e428fd"
  }
};
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(html) {
  // Extract text for comparison only; this is not an HTML sanitizer or renderer.
  const contents = node => node.nodeName === '#text' ? node.value
    : (node.childNodes || []).map(contents).join('');
  return contents(parseFragment(html)).trim();
}
test('legal-copy extraction respects markup boundaries and decodes text once', () => {
  assert.equal(text('<a title="1 > 0">Complete <strong>risk</strong></a> disclosure'), 'Complete risk disclosure');
  assert.equal(text('A &amp; B &lt;script&gt; &quot;quote&quot; &#x27; &#39; &amp;lt;'),
    'A & B <script> "quote" \' \' &lt;');
  assert.equal(text('<scrip<script>t>'), 't>');
  assert.equal(text('<script'), '');
  assert.equal(text('before<!-- a > comment -->after'), 'beforeafter');
});
for (const locale of ['en', 'de']) {
  test(`MiniMax ${locale} product copy preserves complete approved risk disclosures`, () => {
    const c = MINIMAX_CONSENT_COPY[locale];
    const values = [c.register.label, ...c.register.paragraphs, c.register.linkText,
      c.dialog.title, ...c.dialog.paragraphs, c.dialog.accept, c.dialog.decline, c.dialog.blocked,
      ...['label', 'description', 'granted', 'notGranted', 'revoked', 'regranted'].map(k => c.settings[k]),
      c.notices.video, c.notices.music, c.referenceLabel];
    assert.equal(hash(values), APPROVED[locale].ui);
    assert.equal(c.register.paragraphs.length, 4);
    assert.equal(c.dialog.paragraphs.length, 5);
    for (const value of values) assert.doesNotMatch(value.replaceAll('[DATUM]', ''), /\[[A-Z_]+\]/);
    const [privacyPath, anchor] = c.links.privacy.split('#');
    assert.match(read(privacyPath.slice(1)), new RegExp(`id="${anchor}"`));
    assert.equal(c.links.profile, `${locale === 'de' ? '/de' : ''}/account/profile-settings.html#minimax-consent`);
  });
  const files = locale === 'en' ? ['legal/privacy.html']
    : ['legal/datenschutz.html', 'de/legal/datenschutz.html', 'de/legal/privacy.html'];
  for (const file of files) test(`${file} preserves supplied section 5.6, transfer update and two MiniMax rows`, () => {
    const html = read(file);
    const section = html.match(/<h3 id="minimax-consent">[\s\S]*?<\/div><\/section>/)?.[0];
    assert.ok(section, '5.6 remains a subsection before 5a');
    const paragraphs = [...section.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => text(m[1]));
    assert.equal(hash(paragraphs), APPROVED[locale].privacy);
    assert.ok(html.indexOf('id="minimax-consent"') < html.indexOf('id="website-assistant"'));
    const cross = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => text(m[1]))
      .find(p => p.startsWith(locale === 'en' ? 'For the models minimax/h3' : 'Für die Modelle minimax/h3'));
    assert.equal(hash(cross), APPROVED[locale].cross);
    const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m =>
      [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(c => text(c[1])))
      .filter(row => /^MiniMax (?:[Vv]ideo|Musik|music):/.test(row[0] || ''));
    assert.equal(hash(rows), APPROVED[locale].rows);
    for (const id of ['minimax/h3', 'minimax/h3-lite', 'minimax/music-2.6']) assert.ok(html.includes(`data-model="${id}"`));
    assert.doesNotMatch(section, /\[[A-Z_]+\]/);
  });
  test(`MiniMax ${locale} terms append every approved clause`, () => {
    const html = read(locale === 'en' ? 'legal/terms.html' : 'de/legal/terms.html');
    const clauses = [...html.matchAll(/<p data-minimax-terms="(\d+)">([\s\S]*?)<\/p>/g)];
    assert.deepEqual(clauses.map(m => Number(m[1])), [8, 9, 11, 13, 19]);
    assert.equal(hash(clauses.map(m => text(m[2]))), APPROVED[locale].terms);
  });
}
