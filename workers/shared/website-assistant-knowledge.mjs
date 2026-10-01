import { publicPageIds } from '../../js/shared/website-assistant-context.mjs';
import { knowledgeArticles } from './website-assistant-content.mjs';
import { knowledgeVersion } from './website-assistant-version.mjs';

export { publicPageIds, publicContextForPath } from '../../js/shared/website-assistant-context.mjs';
export { knowledgeVersion } from './website-assistant-version.mjs';

export const pageSuggestionIds = Object.freeze({
  home: ['getting-started', 'image-model-choice', 'canvas-start'],
  images: ['image-model-choice', 'image-references', 'save-results'],
  video: ['video-references', 'save-results', 'generation-recovery'],
  music: ['music-workflow', 'save-results', 'canvas-music-export'],
  'generate-lab': ['image-model-choice', 'credit-estimates', 'save-results'],
  canvas: ['canvas-start', 'canvas-inputs', 'canvas-music-export'],
  pricing: ['plans-and-packs', 'credit-estimates', 'billing-recovery'],
  assets: ['save-results', 'asset-organization', 'generation-recovery'],
  credits: ['plans-and-packs', 'credit-estimates', 'billing-recovery'],
  profile: ['session-recovery', 'asset-organization', 'public-help-boundary'],
  privacy: ['public-help-boundary', 'asset-organization', 'contact-support'],
  legal: ['public-help-boundary', 'billing-recovery', 'contact-support'],
  contact: ['contact-support', 'generation-recovery', 'public-help-boundary'],
});

const byId = new Map(knowledgeArticles.map(article => [article.id, article]));
const cache = new Map(); // Finite: allowlisted pages × two languages × this deployed version.
const supported = (pageId, language) => publicPageIds.includes(pageId) && (language === 'en' || language === 'de');
const stopwords = new Set(('a about an and are as at be before bitbi by can could describe did do does explain for from get have how i if in into is it me my of on or please should so tell that the their there these this to use want was what when where which why will with would you your '
  + 'aber alle als am an auch auf aus bei bin bis bitte das dass dem den der des die ein eine einem einen einer erklar erklare erklaren es fur habe haben hat ich im in ist kann konnen mein meine mich mit nach nicht noch oder sie sich sind soll um und uns vom von vor wann warum was welche welcher wie wir wo zu zum zur').split(/\s+/));
const vocabulary = new Map([
  ['ergebnis', 'result'], ['ergebnisse', 'result'], ['result', 'result'], ['results', 'result'],
  ['bild', 'image'], ['bilder', 'image'], ['image', 'image'], ['images', 'image'],
  ['modell', 'model'], ['modelle', 'model'], ['model', 'model'], ['models', 'model'],
  ['credit', 'credit'], ['credits', 'credit'],
]);

function tokens(text) {
  return [...new Set(String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ß/g, 'ss').match(/[a-z0-9]+/g) || [])]
    .filter(word => word.length > 1 && !stopwords.has(word))
    .map(word => vocabulary.get(word) || (word.length > 5 ? word.replace(/(?:ungen|ation|ing|ern|en|es|er|e|s)$/, '') : word));
}

const index = new Map(['en', 'de'].map(language => [language, knowledgeArticles.map(article => ({
  article,
  question: new Set(tokens(article[language].question)),
  title: new Set(tokens(article[language].title)),
  keywords: new Set(tokens(article.keywords.join(' '))),
  text: new Set(tokens(article[language].text)),
}))]));

function localizedUrl(path, language) {
  if (language === 'de') path = path === '/legal/privacy.html' ? '/de/legal/datenschutz.html' : `/de${path}`;
  return `https://bitbi.ai${path}`;
}

function document(article, language) {
  return Object.freeze({ id: article.id, title: article[language].title, text: article[language].text, url: localizedUrl(article.path, language) });
}

export function getSuggestions({ pageId, language } = {}) {
  if (!supported(pageId, language)) return [];
  const key = `${knowledgeVersion}:${language}:${pageId}`;
  if (!cache.has(key)) cache.set(key, Object.freeze(pageSuggestionIds[pageId].map(id => Object.freeze({
    id, question: byId.get(id)[language].question, sourceIds: Object.freeze([id]),
  }))));
  return cache.get(key);
}

export function retrieveKnowledge({ question, pageId, language, limit = 3 } = {}) {
  if (!supported(pageId, language) || typeof question !== 'string' || question.length > 2000) return [];
  const query = tokens(question);
  if (!query.length) return [];
  const cap = Number.isSafeInteger(limit) ? Math.max(1, Math.min(4, limit)) : 3;
  const matches = index.get(language).map(entry => {
    const exact = question.trim().toLocaleLowerCase(language) === entry.article[language].question.toLocaleLowerCase(language);
    let score = exact ? 100 : 0;
    let matched = 0;
    for (const word of query) {
      const weight = entry.question.has(word) ? 5 : entry.title.has(word) ? 4 : entry.keywords.has(word) ? 3 : entry.text.has(word) ? 1 : 0;
      if (weight) { score += weight; matched++; }
    }
    // Page context only ranks a lexical match. It cannot turn an unrelated
    // question into an apparently supported answer.
    const relevance = matched / query.length;
    if (!exact && (score < 3 || relevance < 0.2)) return null;
    return { article: entry.article, score: score + (entry.article.pages.includes(pageId) ? 1 : 0) + relevance };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id));
  return matches.slice(0, cap).map(match => document(match.article, language));
}

// This serialized, public-only corpus is the version boundary. Tests/guard hash
// this exact representation; model context contains only selected documents.
export function knowledgeVersionInput() {
  return JSON.stringify({ schema: 1, pages: publicPageIds, suggestions: pageSuggestionIds, articles: knowledgeArticles });
}
