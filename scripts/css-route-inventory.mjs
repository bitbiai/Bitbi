#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { escapeMarkdownTableCell } from './lib/markdown-table.mjs';

const ROOT = process.cwd();
const USE_MARKDOWN = process.argv.includes('--markdown');

const IGNORED_DIRS = new Set([
  '.git',
  '_site',
  '.wrangler',
  'coverage',
  'docs',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const PRIORITY_HTML_ROUTES = Object.freeze([
  'index.html',
  'de/index.html',
  'pricing.html',
  'de/pricing.html',
  'generate-lab/index.html',
  'de/generate-lab/index.html',
  'admin/index.html',
  'legal/privacy.html',
  'legal/terms.html',
  'legal/imprint.html',
  'legal/datenschutz.html',
  'de/legal/privacy.html',
  'de/legal/terms.html',
  'de/legal/imprint.html',
  'de/legal/datenschutz.html',
  'account/profile.html',
  'de/account/profile.html',
  'account/profile-settings.html',
  'de/account/profile-settings.html',
  'account/assets-manager.html',
  'de/account/assets-manager.html',
  'account/credits.html',
  'de/account/credits.html',
  'account/forgot-password.html',
  'de/account/forgot-password.html',
  'account/reset-password.html',
  'de/account/reset-password.html',
  'account/verify-email.html',
  'de/account/verify-email.html',
  'account/organization.html',
  'de/account/organization.html',
]);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function walkFiles(rootDir) {
  const files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile()) files.push(absolutePath);
    }
  }

  walk(rootDir);
  return files;
}

function readText(repoPath) {
  const absolutePath = path.join(ROOT, repoPath);
  if (!fs.existsSync(absolutePath)) return '';
  return fs.readFileSync(absolutePath, 'utf8');
}

function parseAttributes(tag) {
  const attrs = new Map();
  const matches = tag.matchAll(/([a-zA-Z0-9:_-]+)\s*=\s*(["'])(.*?)\2/g);
  for (const match of matches) {
    attrs.set(match[1].toLowerCase(), match[3]);
  }
  return attrs;
}

function stripUrlDecorators(value) {
  return String(value || '').split('#')[0].split('?')[0];
}

function isExternalOrDataUrl(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|data:)/i.test(String(value || '').trim());
}

function resolveFromHtml(htmlPath, href) {
  if (!href || isExternalOrDataUrl(href)) return null;
  const cleanHref = stripUrlDecorators(href);
  if (!cleanHref) return null;
  const relativePath = cleanHref.startsWith('/')
    ? cleanHref.replace(/^\/+/, '')
    : path.join(path.dirname(htmlPath), cleanHref);
  return path.normalize(relativePath).split(path.sep).join('/');
}

function getStylesheetLinks(htmlPath) {
  const content = readText(htmlPath);
  const links = [];
  const tags = content.matchAll(/<link\b[^>]*>/gi);
  for (const tagMatch of tags) {
    const tag = tagMatch[0];
    const attrs = parseAttributes(tag);
    const rel = String(attrs.get('rel') || '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet')) continue;
    const href = attrs.get('href') || '';
    links.push({
      href,
      path: resolveFromHtml(htmlPath, href),
    });
  }
  return links;
}

function getPreloadCount(htmlPath) {
  const content = readText(htmlPath);
  let count = 0;
  for (const tagMatch of content.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(tagMatch[0]);
    const rel = String(attrs.get('rel') || '').toLowerCase().split(/\s+/);
    if (rel.includes('preload')) count += 1;
  }
  return count;
}

function classifyCss(cssPath) {
  if (cssPath === 'css/base/tokens.css' || cssPath === 'css/base/reset.css' || cssPath === 'css/base/base.css') {
    return 'critical_global';
  }
  if (cssPath === 'css/base/utilities.css') return 'critical_global';
  if (cssPath === 'css/components/components.css') return 'shared_component_required';
  if (cssPath === 'css/components/auth.css') return 'auth_or_wallet_required';
  if (cssPath === 'css/components/wallet.css') return 'auth_or_wallet_required';
  if (cssPath === 'css/components/news-pulse.css') return 'shared_component_required';
  if (cssPath === 'css/account/assets-manager.css') return 'auth_or_wallet_required';
  if (cssPath.startsWith('css/admin/')) return 'admin_required';
  if (cssPath.startsWith('css/pages/') || cssPath.startsWith('css/account/')) return 'page_specific_required';
  if (cssPath.startsWith('css/components/')) return 'shared_component_required';
  return 'deferred_needs_proof';
}

function routeKind(htmlPath) {
  if (htmlPath === 'index.html' || htmlPath === 'de/index.html') return 'homepage';
  if (htmlPath.includes('generate-lab/')) return 'generate_lab';
  if (htmlPath === 'admin/index.html') return 'admin';
  if (htmlPath.includes('/legal/') || htmlPath.startsWith('legal/')) return 'legal';
  if (htmlPath.includes('pricing')) return 'pricing';
  if (htmlPath.includes('/account/') || htmlPath.startsWith('account/')) return 'account';
  return 'other';
}

function getCssFiles() {
  return walkFiles(path.join(ROOT, 'css'))
    .filter((filePath) => path.extname(filePath).toLowerCase() === '.css')
    .map((filePath) => {
      const repoPath = toRepoPath(filePath);
      const bytes = fs.statSync(filePath).size;
      return {
        path: repoPath,
        bytes,
        classification: classifyCss(repoPath),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function getHtmlRoutes() {
  const allHtml = walkFiles(ROOT)
    .filter((filePath) => path.extname(filePath).toLowerCase() === '.html')
    .map(toRepoPath)
    .filter((repoPath) => !repoPath.startsWith('_site/'))
    .sort();
  const seen = new Set();
  const ordered = [];
  for (const route of PRIORITY_HTML_ROUTES) {
    if (allHtml.includes(route) && !seen.has(route)) {
      ordered.push(route);
      seen.add(route);
    }
  }
  for (const route of allHtml) {
    if (!seen.has(route)) ordered.push(route);
  }
  return ordered;
}

function summarizeRoute(route, cssSizeMap) {
  const links = getStylesheetLinks(route);
  const totalBytes = links.reduce((sum, link) => sum + (cssSizeMap.get(link.path)?.bytes || 0), 0);
  const classifications = [...new Set(links.map((link) => classifyCss(link.path || '')))].sort();
  return {
    route,
    kind: routeKind(route),
    stylesheetCount: links.length,
    stylesheetBytes: totalBytes,
    preloadCount: getPreloadCount(route),
    classifications,
    links,
  };
}

function extractCssUrlReferences(cssFile) {
  const content = readText(cssFile.path);
  const refs = [];
  for (const match of content.matchAll(/\burl\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const rawUrl = match[2].trim();
    if (!rawUrl || rawUrl.startsWith('#') || isExternalOrDataUrl(rawUrl)) continue;
    const cleanUrl = stripUrlDecorators(rawUrl);
    if (!cleanUrl) continue;
    const resolved = path.normalize(path.join(path.dirname(cssFile.path), cleanUrl)).split(path.sep).join('/');
    refs.push({
      cssPath: cssFile.path,
      rawUrl,
      resolved,
      exists: fs.existsSync(path.join(ROOT, resolved)),
    });
  }
  return refs;
}

function stripCssComments(content) {
  return String(content || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractSelectorPrefixes(cssFile) {
  const content = stripCssComments(readText(cssFile.path));
  const counts = new Map();
  for (const match of content.matchAll(/([^{}]+)\{/g)) {
    const rawBlock = match[1].trim();
    if (!rawBlock || rawBlock.startsWith('@')) continue;
    const selectors = rawBlock.split(',');
    for (const selector of selectors) {
      const cleanSelector = selector.trim();
      if (!cleanSelector || cleanSelector.startsWith('@')) continue;
      const prefixMatch = cleanSelector.match(/([.#][a-zA-Z0-9_-]+)/)
        || cleanSelector.match(/^([a-zA-Z][a-zA-Z0-9_-]*)/);
      const prefix = prefixMatch?.[1] || '(complex)';
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([prefix, count]) => `${prefix} (${count})`);
}

function summarizeCssRouteUsage(cssFiles, routes) {
  const routeUsage = new Map(cssFiles.map((file) => [file.path, {
    cssPath: file.path,
    routeKinds: new Set(),
    routes: [],
  }]));

  for (const route of routes) {
    for (const link of route.links) {
      if (!link.path) continue;
      if (!routeUsage.has(link.path)) {
        routeUsage.set(link.path, {
          cssPath: link.path,
          routeKinds: new Set(),
          routes: [],
        });
      }
      const usage = routeUsage.get(link.path);
      usage.routeKinds.add(route.kind);
      usage.routes.push(route.route);
    }
  }

  return [...routeUsage.values()]
    .map((usage) => ({
      ...usage,
      routeKinds: [...usage.routeKinds].sort(),
      routes: usage.routes.sort(),
    }))
    .sort((left, right) => left.cssPath.localeCompare(right.cssPath));
}

function summarizeCssSourceReferences(cssFiles) {
  const textFiles = walkFiles(ROOT)
    .map(toRepoPath)
    .filter((repoPath) => /\.(?:css|html|js|json|mjs)$/i.test(repoPath));
  return cssFiles.map((cssFile) => {
    const references = [];
    for (const repoPath of textFiles) {
      if (repoPath === cssFile.path) continue;
      const content = readText(repoPath);
      if (content.includes(cssFile.path)) references.push(repoPath);
    }
    return {
      cssPath: cssFile.path,
      references: references.sort(),
    };
  });
}

function buildRouteOverlapRows(routes) {
  const byKind = new Map();
  for (const route of routes) {
    if (!byKind.has(route.kind)) byKind.set(route.kind, new Set());
    for (const link of route.links) {
      if (link.path) byKind.get(route.kind).add(link.path);
    }
  }
  const kinds = [...byKind.keys()].sort();
  const rows = [];
  for (const leftKind of kinds) {
    for (const rightKind of kinds) {
      if (leftKind > rightKind) continue;
      const left = byKind.get(leftKind);
      const right = byKind.get(rightKind);
      const overlap = [...left].filter((cssPath) => right.has(cssPath));
      rows.push([
        leftKind,
        rightKind,
        overlap.length,
        overlap.sort().join(', '),
      ]);
    }
  }
  return rows;
}

function renderTable(headers, rows) {
  if (USE_MARKDOWN) {
    return [
      `| ${headers.map((header) => escapeMarkdownTableCell(header)).join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map((row) => `| ${row.map((cell) => escapeMarkdownTableCell(cell)).join(' | ')} |`),
    ].join('\n');
  }

  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => String(row[index]).length),
  ));
  const renderRow = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ');
  return [
    renderRow(headers),
    renderRow(widths.map((width) => '-'.repeat(width))),
    ...rows.map(renderRow),
  ].join('\n');
}

function printReport() {
  const cssFiles = getCssFiles();
  const cssSizeMap = new Map(cssFiles.map((file) => [file.path, file]));
  const routes = getHtmlRoutes().map((route) => summarizeRoute(route, cssSizeMap));
  const cssUrlRefs = cssFiles.flatMap(extractCssUrlReferences);
  const missingUrlRefs = cssUrlRefs.filter((ref) => !ref.exists);
  const cssRouteUsage = summarizeCssRouteUsage(cssFiles, routes);
  const cssSourceRefs = summarizeCssSourceReferences(cssFiles);

  const totalCssBytes = cssFiles.reduce((sum, file) => sum + file.bytes, 0);
  const lines = [];
  lines.push(USE_MARKDOWN ? '# BITBI CSS Route Inventory' : 'BITBI CSS Route Inventory');
  lines.push('');
  lines.push(`CSS files scanned: ${cssFiles.length}`);
  lines.push(`Total CSS bytes: ${totalCssBytes} (${formatBytes(totalCssBytes)})`);
  lines.push(`HTML routes scanned: ${routes.length}`);
  lines.push(`CSS url(...) references: ${cssUrlRefs.length}`);
  lines.push(`Missing CSS url(...) references: ${missingUrlRefs.length}`);
  lines.push('');

  lines.push(USE_MARKDOWN ? '## CSS Files' : 'CSS files');
  lines.push(renderTable(
    ['Path', 'Bytes', 'Human', 'Classification'],
    cssFiles.map((file) => [file.path, file.bytes, formatBytes(file.bytes), file.classification]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## CSS File Route Usage' : 'CSS file route usage');
  lines.push(renderTable(
    ['Stylesheet', 'Route count', 'Route kinds', 'Routes'],
    cssRouteUsage.map((usage) => [
      usage.cssPath,
      usage.routes.length,
      usage.routeKinds.join(', ') || '-',
      usage.routes.join(', ') || '-',
    ]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## CSS Source References' : 'CSS source references');
  lines.push(renderTable(
    ['Stylesheet', 'Source reference count', 'Source references'],
    cssSourceRefs.map((usage) => [
      usage.cssPath,
      usage.references.length,
      usage.references.join(', ') || '-',
    ]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Selector Prefix Heuristics' : 'Selector prefix heuristics');
  lines.push(renderTable(
    ['Stylesheet', 'Top selector prefixes'],
    cssFiles.map((file) => [
      file.path,
      extractSelectorPrefixes(file).join(', ') || '-',
    ]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Route Kind Overlap' : 'Route kind overlap');
  lines.push(renderTable(
    ['Route kind A', 'Route kind B', 'Shared stylesheets', 'Stylesheets'],
    buildRouteOverlapRows(routes),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Route Stylesheet Summary' : 'Route stylesheet summary');
  lines.push(renderTable(
    ['Route', 'Kind', 'CSS links', 'CSS bytes', 'Human', 'Preloads', 'Classifications'],
    routes.map((route) => [
      route.route,
      route.kind,
      route.stylesheetCount,
      route.stylesheetBytes,
      formatBytes(route.stylesheetBytes),
      route.preloadCount,
      route.classifications.join(', '),
    ]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Route Stylesheet Detail' : 'Route stylesheet detail');
  lines.push(renderTable(
    ['Route', 'Order', 'Stylesheet', 'Bytes', 'Human', 'Classification'],
    routes.flatMap((route) => route.links.map((link, index) => {
      const file = cssSizeMap.get(link.path);
      return [
        route.route,
        index + 1,
        link.path || link.href,
        file?.bytes || 0,
        formatBytes(file?.bytes || 0),
        classifyCss(link.path || ''),
      ];
    })),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## CSS URL References' : 'CSS URL references');
  if (cssUrlRefs.length === 0) {
    lines.push('No local CSS url(...) references found.');
  } else {
    lines.push(renderTable(
      ['CSS file', 'Raw URL', 'Resolved path', 'Exists'],
      cssUrlRefs.map((ref) => [ref.cssPath, ref.rawUrl, ref.resolved, ref.exists ? 'yes' : 'no']),
    ));
  }
  lines.push('');

  if (missingUrlRefs.length > 0) {
    lines.push(USE_MARKDOWN ? '## Missing CSS URL References' : 'Missing CSS URL references');
    lines.push(renderTable(
      ['CSS file', 'Raw URL', 'Resolved path'],
      missingUrlRefs.map((ref) => [ref.cssPath, ref.rawUrl, ref.resolved]),
    ));
    lines.push('');
  }

  console.log(lines.join('\n'));
}

printReport();
