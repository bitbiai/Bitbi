#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { escapeMarkdownTableCell } from './lib/markdown-table.mjs';

const ROOT = process.cwd();
const USE_MARKDOWN = process.argv.includes('--markdown');
const MANIFEST_PATH = path.join(ROOT, 'docs/performance/media-derivatives-manifest.json');
const ASSET_ROOTS = Object.freeze(['assets', 'fonts']);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.wrangler',
  '_site',
  'coverage',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
]);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function cssEscapedAssetReferencePath(assetPath) {
  return String(assetPath || '').split('/').join('\\/');
}

export function escapeMediaInventoryMarkdownCell(value) {
  return escapeMarkdownTableCell(value);
}

function toRepoPath(absolutePath) {
  return path.relative(ROOT, absolutePath).split(path.sep).join('/');
}

function walkFiles(rootDir) {
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (entry.isFile()) files.push(absolutePath);
    }
  }

  walk(rootDir);
  return files.sort((left, right) => toRepoPath(left).localeCompare(toRepoPath(right)));
}

function categoryFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) return 'video';
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'].includes(ext)) return 'audio';
  return 'other';
}

function readTextIfSafe(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { candidates: [], bySource: new Map(), found: false };
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const candidates = Array.isArray(manifest.candidates) ? manifest.candidates : [];
  return {
    candidates,
    bySource: new Map(candidates.map((candidate) => [candidate.source, candidate])),
    found: true,
  };
}

function parsePngDimensions(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseGifDimensions(buffer) {
  if (buffer.length < 10) return null;
  const signature = buffer.toString('ascii', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function parseJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    );
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function parseWebpDimensions(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunkType === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + ((b3 << 6) | (b2 >> 2) | ((b1 & 0xc0) << 2)),
    };
  }
  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    for (let index = 20; index + 10 < buffer.length; index += 1) {
      if (buffer[index] === 0x9d && buffer[index + 1] === 0x01 && buffer[index + 2] === 0x2a) {
        return {
          width: buffer.readUInt16LE(index + 3) & 0x3fff,
          height: buffer.readUInt16LE(index + 5) & 0x3fff,
        };
      }
    }
  }
  return null;
}

function parseSvgDimensions(content) {
  const widthMatch = content.match(/\bwidth=["']?([0-9.]+)/i);
  const heightMatch = content.match(/\bheight=["']?([0-9.]+)/i);
  if (widthMatch && heightMatch) {
    return {
      width: Math.round(Number(widthMatch[1])),
      height: Math.round(Number(heightMatch[1])),
    };
  }
  const viewBoxMatch = content.match(/\bviewBox=["'][^"']*?\s([0-9.]+)\s+([0-9.]+)["']/i);
  if (viewBoxMatch) {
    return {
      width: Math.round(Number(viewBoxMatch[1])),
      height: Math.round(Number(viewBoxMatch[2])),
    };
  }
  return null;
}

function detectDimensions(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.svg') return parseSvgDimensions(fs.readFileSync(filePath, 'utf8'));
    const buffer = fs.readFileSync(filePath);
    if (ext === '.png') return parsePngDimensions(buffer);
    if (ext === '.gif') return parseGifDimensions(buffer);
    if (ext === '.jpg' || ext === '.jpeg') return parseJpegDimensions(buffer);
    if (ext === '.webp') return parseWebpDimensions(buffer);
  } catch {
    return null;
  }
  return null;
}

function collectTextFiles() {
  return walkFiles(ROOT)
    .filter((filePath) => TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => {
      const content = readTextIfSafe(filePath);
      return content === null ? null : { path: toRepoPath(filePath), content };
    })
    .filter(Boolean);
}

function getContext(content, needle) {
  const index = content.indexOf(needle);
  if (index === -1) return '';
  const start = Math.max(0, index - 160);
  const end = Math.min(content.length, index + needle.length + 160);
  return content.slice(start, end);
}

function detectRoles(assetPath, references) {
  const roles = new Set();
  if (assetPath.startsWith('assets/favicons/')) roles.add('favicon_or_manifest_asset');
  if (assetPath.includes('/hero/')) roles.add('hero_media_candidate');
  if (assetPath.startsWith('fonts/')) roles.add('font_asset');
  if (assetPath.startsWith('assets/derivatives/')) roles.add('generated_derivative');

  for (const reference of references) {
    const context = reference.context.toLowerCase();
    if (reference.path.endsWith('.css')) roles.add('css_referenced');
    if (reference.path.startsWith('tests/')) roles.add('test_fixture_reference');
    if (reference.path === 'assets/favicons/site.webmanifest') roles.add('manifest_icon_reference');
    if (context.includes('og:image') || context.includes('twitter:image')) roles.add('social_preview_reference');
    if (context.includes('application/ld+json') || context.includes('"image"') || context.includes('"logo"')) {
      roles.add('structured_data_reference');
    }
    if (context.includes('rel="preload"') || context.includes("rel='preload'")) roles.add('preload_reference');
    if (context.includes('fetchpriority="high"') || context.includes("fetchpriority='high'")) roles.add('high_priority_reference');
    if (context.includes('background-image')) roles.add('css_background_reference');
    if (context.includes('<img') || context.includes('<source')) roles.add('html_media_reference');
    if (context.includes('<video') || context.includes('poster=')) roles.add('html_video_reference');
  }

  return [...roles].sort();
}

function traceReferences(assets, textFiles) {
  const byAsset = new Map();
  for (const asset of assets) byAsset.set(asset.path, []);

  for (const file of textFiles) {
    for (const asset of assets) {
      const needles = [
        asset.path,
        `/${asset.path}`,
        cssEscapedAssetReferencePath(asset.path),
      ];
      const matchedNeedle = needles.find((needle) => file.content.includes(needle));
      if (!matchedNeedle) continue;
      byAsset.get(asset.path).push({
        path: file.path,
        context: getContext(file.content, matchedNeedle),
      });
    }
  }

  return byAsset;
}

function getAssets(manifest) {
  const roots = ASSET_ROOTS
    .map((root) => path.join(ROOT, root))
    .filter((root) => fs.existsSync(root));
  const files = roots.flatMap((root) => walkFiles(root));
  return files.map((filePath) => {
    const stats = fs.statSync(filePath);
    const repoPath = toRepoPath(filePath);
    const manifestCandidate = manifest.bySource.get(repoPath) || null;
    return {
      path: repoPath,
      category: categoryFor(filePath),
      bytes: stats.size,
      dimensions: detectDimensions(filePath),
      manifestStatus: manifestCandidate?.status || null,
      manifestRisk: manifestCandidate?.risk || null,
      safeToAutoIntegrate: manifestCandidate?.safeToAutoIntegrate ?? null,
    };
  }).sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
}

function summarizeCategories(assets) {
  const categories = new Map();
  for (const asset of assets) {
    const existing = categories.get(asset.category) || { files: 0, bytes: 0 };
    existing.files += 1;
    existing.bytes += asset.bytes;
    categories.set(asset.category, existing);
  }
  return [...categories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, value]) => ({ category, ...value }));
}

function renderDimensions(dimensions) {
  return dimensions ? `${dimensions.width}x${dimensions.height}` : 'unknown';
}

function renderTable(headers, rows) {
  if (!USE_MARKDOWN) {
    const widths = headers.map((header, index) => Math.max(
      header.length,
      ...rows.map((row) => String(row[index]).length),
    ));
    const renderRow = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ');
    return [renderRow(headers), renderRow(widths.map((width) => '-'.repeat(width))), ...rows.map(renderRow)].join('\n');
  }

  const headerLine = `| ${headers.map((header) => escapeMediaInventoryMarkdownCell(header)).join(' | ')} |`;
  const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => `| ${row.map((cell) => escapeMediaInventoryMarkdownCell(cell)).join(' | ')} |`);
  return [headerLine, dividerLine, ...rowLines].join('\n');
}

function printReport() {
  const manifest = readManifest();
  const assets = getAssets(manifest);
  const textFiles = collectTextFiles();
  const references = traceReferences(assets, textFiles);

  for (const asset of assets) {
    asset.references = references.get(asset.path) || [];
    asset.roles = detectRoles(asset.path, asset.references);
  }

  const lines = [];
  lines.push(USE_MARKDOWN ? '# BITBI Media Derivative Inventory' : 'BITBI Media Derivative Inventory');
  lines.push('');
  lines.push(`Manifest: ${manifest.found ? 'docs/performance/media-derivatives-manifest.json' : 'not found'}`);
  lines.push(`Assets scanned: ${assets.length}`);
  lines.push(`Reference text files scanned: ${textFiles.length}`);
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Bytes by Media Category' : 'Bytes by media category');
  lines.push(renderTable(
    ['Category', 'Files', 'Bytes', 'Human'],
    summarizeCategories(assets).map((row) => [row.category, row.files, row.bytes, formatBytes(row.bytes)]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Largest Assets' : 'Largest assets');
  lines.push(renderTable(
    ['Rank', 'Path', 'Category', 'Bytes', 'Human', 'Dimensions', 'Refs', 'Roles'],
    assets.slice(0, 30).map((asset, index) => [
      index + 1,
      asset.path,
      asset.category,
      asset.bytes,
      formatBytes(asset.bytes),
      renderDimensions(asset.dimensions),
      asset.references.length,
      asset.roles.join(', ') || 'none',
    ]),
  ));
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Manifest Candidates' : 'Manifest candidates');
  if (!manifest.candidates.length) {
    lines.push('No derivative manifest candidates are defined.');
  } else {
    lines.push(renderTable(
      ['Source', 'Status', 'Risk', 'Safe to auto-integrate', 'Current bytes', 'References'],
      manifest.candidates.map((candidate) => {
        const asset = assets.find((item) => item.path === candidate.source);
        return [
          candidate.source,
          candidate.status || 'unspecified',
          candidate.risk || 'unspecified',
          candidate.safeToAutoIntegrate === true ? 'yes' : 'no',
          candidate.currentBytes ?? asset?.bytes ?? 'unknown',
          asset?.references.length ?? candidate.references?.length ?? 0,
        ];
      }),
    ));
  }
  lines.push('');

  lines.push(USE_MARKDOWN ? '## High-Risk SEO, Social, Favicon, and Manifest Assets' : 'High-risk SEO, social, favicon, and manifest assets');
  const highRiskAssets = assets.filter((asset) => asset.roles.some((role) => (
    role.includes('favicon')
    || role.includes('manifest')
    || role.includes('social')
    || role.includes('structured_data')
    || role.includes('high_priority')
  )));
  if (!highRiskAssets.length) {
    lines.push('No high-risk SEO/social/favicon assets were detected.');
  } else {
    lines.push(renderTable(
      ['Path', 'Bytes', 'Dimensions', 'Roles', 'Manifest status'],
      highRiskAssets.map((asset) => [
        asset.path,
        asset.bytes,
        renderDimensions(asset.dimensions),
        asset.roles.join(', '),
        asset.manifestStatus || 'not in manifest',
      ]),
    ));
  }
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Generated Derivatives' : 'Generated derivatives');
  const generatedDerivatives = assets.filter((asset) => asset.path.startsWith('assets/derivatives/'));
  if (!generatedDerivatives.length) {
    lines.push('No generated derivative assets are present.');
  } else {
    lines.push(renderTable(
      ['Path', 'Bytes', 'Dimensions', 'References'],
      generatedDerivatives.map((asset) => [
        asset.path,
        asset.bytes,
        renderDimensions(asset.dimensions),
        asset.references.length,
      ]),
    ));
  }
  lines.push('');

  lines.push(USE_MARKDOWN ? '## Unreferenced First-Party Media Assets' : 'Unreferenced first-party media assets');
  const unreferenced = assets.filter((asset) => (
    asset.category !== 'font'
    && asset.references.length === 0
    && !asset.path.startsWith('assets/derivatives/')
  ));
  if (!unreferenced.length) {
    lines.push('No unreferenced first-party image/video/audio assets were detected.');
  } else {
    lines.push(renderTable(
      ['Path', 'Category', 'Bytes', 'Dimensions', 'Manifest status'],
      unreferenced.map((asset) => [
        asset.path,
        asset.category,
        asset.bytes,
        renderDimensions(asset.dimensions),
        asset.manifestStatus || 'not in manifest',
      ]),
    ));
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  printReport();
}
