#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const ROOT = process.cwd();
const SERVE_ROOT = fs.existsSync(path.join(ROOT, '_site')) ? path.join(ROOT, '_site') : ROOT;
const ARTIFACT_ROOT = path.join(ROOT, 'test-results/visual-guardrails/latest');
const NEWS_THUMB_PATH = path.join(ROOT, 'assets/favicons/favicon-16x16.png');
const VISUAL_MEMBER_COOKIE_NAME = 'bitbi_visual_auth';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

const BROWSERS = Object.freeze([
  { name: 'chromium', launcher: chromium },
  { name: 'firefox', launcher: firefox },
  { name: 'webkit', launcher: webkit },
]);

const SCENARIOS = Object.freeze([
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'tablet', width: 768, height: 1024, hasTouch: true },
]);

const ROUTES = Object.freeze([
  { path: '/', name: 'home-en' },
  { path: '/de/', name: 'home-de' },
  { path: '/generate-lab/', name: 'generate-lab-en' },
  { path: '/de/generate-lab/', name: 'generate-lab-de' },
  { path: '/pricing.html', name: 'pricing-en' },
  { path: '/de/pricing.html', name: 'pricing-de' },
  { path: '/legal/privacy.html', name: 'legal-privacy-en' },
  { path: '/account/assets-manager.html', name: 'account-assets-guest' },
  { path: '/admin/', name: 'admin' },
]);
const MEMBER_HOME_ROUTE = Object.freeze({ path: '/', name: 'home-en-member', authState: 'member' });

function buildRunPlan(browserName) {
  if (browserName === 'chromium') {
    const scenarios = [];
    for (const route of ROUTES) {
      for (const scenario of SCENARIOS) scenarios.push({ route, scenario, reducedMotion: false });
    }
    scenarios.push({ route: MEMBER_HOME_ROUTE, scenario: SCENARIOS[0], reducedMotion: false });
    scenarios.push({ route: ROUTES[0], scenario: SCENARIOS[0], reducedMotion: true });
    scenarios.push({ route: ROUTES[0], scenario: SCENARIOS[1], reducedMotion: true });
    return scenarios;
  }

  return [
    { route: ROUTES[0], scenario: SCENARIOS[0], reducedMotion: false },
    { route: ROUTES[0], scenario: SCENARIOS[1], reducedMotion: false },
    { route: ROUTES[1], scenario: SCENARIOS[0], reducedMotion: false },
    { route: ROUTES[4], scenario: SCENARIOS[0], reducedMotion: false },
    { route: ROUTES[0], scenario: SCENARIOS[0], reducedMotion: true },
  ];
}

function ensureArtifactRoot() {
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
}

function writeJson(response, body, statusCode = 200) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function writeTinyImage(response) {
  const png = fs.existsSync(NEWS_THUMB_PATH) ? fs.readFileSync(NEWS_THUMB_PATH) : Buffer.alloc(0);
  response.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': png.length,
  });
  response.end(png);
}

function isVisualMemberRequest(request) {
  const cookieHeader = String(request.headers.cookie || '');
  return cookieHeader.split(';').some((part) => {
    const [name, value] = part.trim().split('=');
    return name === VISUAL_MEMBER_COOKIE_NAME && value === 'member';
  });
}

function handleApiRequest(request, response, pathname) {
  if (pathname.startsWith('/api/public/news-pulse/thumbs/')) {
    writeTinyImage(response);
    return true;
  }

  if (pathname === '/api/public/news-pulse') {
    writeJson(response, {
      ok: true,
      items: [
        {
          id: 'phase-d-1',
          title: 'AI platform safety audit',
          summary: 'Local visual guardrail fixture for BITBI Phase D.',
          source: 'BITBI Local',
          category: 'AI',
          url: 'https://bitbi.ai/',
          visual_type: 'generated',
          visual_thumb_url: '/api/public/news-pulse/thumbs/phase-d-1.png',
          visual_alt: 'Generated local news thumbnail fixture',
        },
        {
          id: 'phase-d-2',
          title: 'Media derivative guardrails',
          summary: 'Local-only fixture used to avoid external network calls.',
          source: 'BITBI Local',
          category: 'Media',
          url: 'https://bitbi.ai/de/',
        },
      ],
    });
    return true;
  }

  if (pathname === '/api/homepage/hero-videos') {
    writeJson(response, { ok: true, data: { slots: [] } });
    return true;
  }

  if (pathname === '/api/gallery/mempics' || pathname === '/api/gallery/memvids') {
    writeJson(response, { ok: true, data: { items: [], next_cursor: null, has_more: false } });
    return true;
  }

  if (pathname === '/api/gallery/memtracks') {
    writeJson(response, { ok: true, data: { items: [], next_cursor: null, has_more: false } });
    return true;
  }

  if (pathname === '/api/me') {
    if (isVisualMemberRequest(request)) {
      writeJson(response, {
        ok: true,
        loggedIn: true,
        user: {
          id: 'visual-guardrail-member',
          email: 'visual-member@example.test',
          display_name: 'Visual Member',
          role: 'member',
        },
      });
      return true;
    }
    writeJson(response, { ok: false, error: 'not_authenticated' }, 401);
    return true;
  }

  if (pathname === '/api/ai/quota') {
    if (isVisualMemberRequest(request)) {
      writeJson(response, {
        ok: true,
        data: {
          credits: 42,
          creditBalance: 42,
          isAdmin: false,
        },
      });
      return true;
    }
    writeJson(response, { ok: false, error: 'not_authenticated' }, 401);
    return true;
  }

  if (pathname === '/api/ai/folders') {
    if (isVisualMemberRequest(request)) {
      writeJson(response, {
        ok: true,
        data: {
          folders: [],
          counts: {},
          unfolderedCount: 0,
          storageUsage: {
            usedBytes: 0,
            limitBytes: 52428800,
            remainingBytes: 52428800,
            isUnlimited: false,
          },
        },
      });
      return true;
    }
    writeJson(response, { ok: false, error: 'not_authenticated' }, 401);
    return true;
  }

  if (pathname === '/api/favorites') {
    if (isVisualMemberRequest(request)) {
      writeJson(response, { ok: true, favorites: [] });
      return true;
    }
    writeJson(response, { ok: false, error: 'not_authenticated' }, 401);
    return true;
  }

  if (pathname === '/api/wallet/status') {
    if (isVisualMemberRequest(request)) {
      writeJson(response, {
        ok: true,
        authenticated: true,
        linked_wallet: null,
      });
      return true;
    }
    writeJson(response, { ok: false, error: 'not_authenticated' }, 401);
    return true;
  }

  if (pathname === '/api/admin/me') {
    writeJson(response, { ok: false, error: 'not_authenticated' }, 401);
    return true;
  }

  if (pathname.startsWith('/api/')) {
    writeJson(response, { ok: false, error: 'visual_guardrail_stub' }, 404);
    return true;
  }

  return false;
}

function safeStaticPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const normalized = path.normalize(decodedPath.replace(/^\/+/, ''));
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return null;
  let filePath = path.join(SERVE_ROOT, normalized);
  if (decodedPath.endsWith('/') || !path.extname(filePath)) {
    filePath = path.join(filePath, 'index.html');
  }
  return filePath;
}

function serveStatic(request, response, pathname) {
  const filePath = safeStaticPath(pathname);
  if (!filePath || !filePath.startsWith(SERVE_ROOT)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': MIME_TYPES.get(ext) || 'application/octet-stream',
  });
  fs.createReadStream(filePath).pipe(response);
}

function createServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (handleApiRequest(request, response, url.pathname)) return;
    serveStatic(request, response, url.pathname);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        height: Math.round(rect.height * 100) / 100,
        left: Math.round(rect.left * 100) / 100,
        top: Math.round(rect.top * 100) / 100,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        width: Math.round(rect.width * 100) / 100,
      };
    };

    const resources = performance.getEntriesByType('resource');
    const navigation = performance.getEntriesByType('navigation')[0];
    const resourceTypes = resources.reduce((counts, entry) => {
      counts[entry.initiatorType || 'unknown'] = (counts[entry.initiatorType || 'unknown'] || 0) + 1;
      return counts;
    }, {});

    return {
      activeCategory: document.querySelector('[data-category-panel].is-active')?.dataset?.categoryPanel || null,
      animations: document.getAnimations ? document.getAnimations().length : null,
      completeImages: [...document.images].filter((image) => image.complete).length,
      domNodes: document.querySelectorAll('*').length,
      images: document.images.length,
      mobileNavHidden: document.querySelector('#mobileNav')?.getAttribute('aria-hidden') || null,
      stylesheets: [...document.querySelectorAll('link[rel~="stylesheet"]')].map((link) => link.getAttribute('href')),
      rects: {
        adminRoot: rectFor('.admin-shell, .admin-page, [data-admin-root], main'),
        authModal: rectFor('.auth-modal__overlay.active, .modal-overlay.active, #authModal [role="dialog"]'),
        categoryStage: rectFor('.category-stage, .home-categories__stage, .home-categories'),
        gallery: rectFor('#gallery'),
        generateLab: rectFor('.generate-lab, [data-generate-lab-workspace], main'),
        hero: rectFor('#hero'),
        pricing: rectFor('.pricing-root, [data-pricing-root], main'),
        nav: rectFor('.site-header, .main-nav, .site-nav, header'),
        soundlab: rectFor('#soundlab'),
        video: rectFor('#video-creations'),
        walletModal: rectFor('#walletModal.is-open, #walletModal:not([hidden])'),
        walletWorkspace: rectFor('#walletWorkspace.is-open, #walletWorkspace:not([hidden])'),
      },
      resourceCount: resources.length,
      resourceTypes,
      runtimeProbe: window.__bitbiRuntimeProbe ? { ...window.__bitbiRuntimeProbe } : null,
      stylesheetResources: resources
        .filter((entry) => entry.initiatorType === 'link' || String(entry.name || '').includes('.css'))
        .map((entry) => {
          try {
            const url = new URL(entry.name);
            return url.pathname;
          } catch {
            return entry.name;
          }
        }),
      videos: document.querySelectorAll('video').length,
      navigation: navigation ? {
        domContentLoadedEventEnd: Math.round(navigation.domContentLoadedEventEnd),
        loadEventEnd: Math.round(navigation.loadEventEnd),
        transferSize: navigation.transferSize || 0,
      } : null,
    };
  });
}

async function closeTransientUi(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(80);
}

async function captureNamedState(page, runId, screenshots, metrics, key, fileSuffix) {
  const screenshot = path.join(ARTIFACT_ROOT, `${runId}__${fileSuffix}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  screenshots[key] = path.relative(ROOT, screenshot).split(path.sep).join('/');
  metrics[key] = await collectMetrics(page);
}

async function clickVisibleCandidate(page, selectors) {
  return page.evaluate((candidateSelectors) => {
    const candidates = candidateSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const visible = candidates.find((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
        && !element.disabled;
    });
    const target = visible || candidates[0];
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, selectors);
}

function isExpectedLocalConsoleNotice(text) {
  const value = String(text || '');
  return value.includes('401 (Unauthorized)')
    || value.includes('403 (Forbidden)')
    || value.includes('visual_guardrail_stub');
}

async function captureScenario({ browserName, browser, origin, route, scenario, reducedMotion = false }) {
  const contextOptions = {
    baseURL: origin,
    hasTouch: scenario.hasTouch || false,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    viewport: { width: scenario.width, height: scenario.height },
  };
  if (browserName !== 'firefox') {
    contextOptions.isMobile = scenario.isMobile || false;
  }
  const context = await browser.newContext(contextOptions);
  if (route.authState === 'member') {
    const host = new URL(origin).hostname;
    await context.addCookies([{
      domain: host,
      name: VISUAL_MEMBER_COOKIE_NAME,
      path: '/',
      value: 'member',
      }]);
  }
  await context.addInitScript(() => {
    if (window.__bitbiRuntimeProbe) return;
    const originalRequestAnimationFrame = window.requestAnimationFrame?.bind(window);
    const originalCancelAnimationFrame = window.cancelAnimationFrame?.bind(window);
    const activeFrames = new Set();
    window.__bitbiRuntimeProbe = {
      rafScheduled: 0,
      rafCallbacks: 0,
      activeRaf: 0,
      maxActiveRaf: 0,
    };
    if (typeof originalRequestAnimationFrame === 'function') {
      window.requestAnimationFrame = (callback) => {
        window.__bitbiRuntimeProbe.rafScheduled += 1;
        const id = originalRequestAnimationFrame((time) => {
          activeFrames.delete(id);
          window.__bitbiRuntimeProbe.activeRaf = activeFrames.size;
          window.__bitbiRuntimeProbe.rafCallbacks += 1;
          callback(time);
        });
        activeFrames.add(id);
        window.__bitbiRuntimeProbe.activeRaf = activeFrames.size;
        window.__bitbiRuntimeProbe.maxActiveRaf = Math.max(
          window.__bitbiRuntimeProbe.maxActiveRaf,
          activeFrames.size,
        );
        return id;
      };
    }
    if (typeof originalCancelAnimationFrame === 'function') {
      window.cancelAnimationFrame = (id) => {
        activeFrames.delete(id);
        window.__bitbiRuntimeProbe.activeRaf = activeFrames.size;
        return originalCancelAnimationFrame(id);
      };
    }
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const expectedConsoleNotices = [];
  const pageErrors = [];
  const warnings = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedLocalConsoleNotice(text)) {
      expectedConsoleNotices.push(text);
      return;
    }
    consoleErrors.push(text);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.route('**/*', async (routeRequest) => {
    const requestUrl = new URL(routeRequest.request().url());
    if (requestUrl.protocol === 'data:' || requestUrl.origin === origin) {
      await routeRequest.continue();
      return;
    }
    await routeRequest.fulfill({ status: 204, body: '' });
  });

  await page.goto(route.path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(350);

  const runId = [
    browserName,
    scenario.name,
    reducedMotion ? 'reduced-motion' : 'motion',
    route.name,
  ].map(safeName).join('__');
  const initialScreenshot = path.join(ARTIFACT_ROOT, `${runId}__initial.png`);
  await page.screenshot({ path: initialScreenshot, fullPage: false });

  const metrics = {
    initial: await collectMetrics(page),
  };
  const screenshots = {
    initial: path.relative(ROOT, initialScreenshot).split(path.sep).join('/'),
  };

  if (route.name.startsWith('home-')) {
    for (const section of [
      { category: 'gallery', name: 'gallery', selector: '#gallery' },
      { category: 'video', name: 'video', selector: '#video-creations' },
      { category: 'sound', name: 'soundlab', selector: '#soundlab' },
    ]) {
      const didScroll = await page.evaluate(({ category, selector }) => {
        const link = document.querySelector(`[data-category-link="${category}"]`);
        if (link) link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        const element = document.querySelector(selector);
        if (!element) return false;
        element.scrollIntoView({ block: 'start' });
        return true;
      }, section).catch((error) => {
        warnings.push(`${section.name} scroll failed: ${error.message}`);
        return false;
      });
      if (didScroll) {
        await page.waitForTimeout(100);
        metrics[section.name] = await collectMetrics(page);
      }
    }

    if (scenario.name === 'mobile') {
      const didClickMobileNav = await page.evaluate(() => {
        const button = document.querySelector('#mobileMenuBtn');
        if (!button) return false;
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }).catch((error) => {
        warnings.push(`mobile nav click failed: ${error.message}`);
        return false;
      });
      if (didClickMobileNav) {
        await page.waitForTimeout(100);
        await captureNamedState(page, runId, screenshots, metrics, 'mobileNavOpen', 'mobile-nav');
      }
    } else if (route.authState === 'member') {
      const didClickMemberCreate = await clickVisibleCandidate(page, [
        '.gallery-mode__btn[data-mode="create"]',
      ]).catch((error) => {
        warnings.push(`member create click failed: ${error.message}`);
        return false;
      });
      if (didClickMemberCreate) {
        await page.waitForFunction(() => {
          const panel = document.querySelector('#galleryStudio');
          const panelStyle = panel ? window.getComputedStyle(panel) : null;
          const hasAssetsStyles = [...document.querySelectorAll('link[rel~="stylesheet"]')]
            .some((link) => String(link.href || '').includes('/css/account/assets-manager.css'));
          return Boolean(
            panel
            && panelStyle
            && panelStyle.display !== 'none'
            && hasAssetsStyles
          );
        }, null, { timeout: 4000 }).catch((error) => {
          warnings.push(`member create ready wait failed: ${error.message}`);
        });
        await captureNamedState(page, runId, screenshots, metrics, 'memberCreate', 'member-create');
      }

      const didClickModels = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll('[data-models-link]')];
        const visible = candidates.find((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        });
        const trigger = visible || candidates[0];
        if (!trigger) return false;
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }).catch((error) => {
        warnings.push(`models click failed: ${error.message}`);
        return false;
      });
      if (didClickModels) {
        await page.waitForTimeout(150);
        await captureNamedState(page, runId, screenshots, metrics, 'modelsClick', 'models');
      }
    } else {
      const didClickCreateGate = await clickVisibleCandidate(page, [
        '.gallery-mode__btn[data-mode="create"]',
        '#video-creations .video-mode__btn[data-video-mode="create"]',
        '#soundlab .video-mode__btn[data-sound-mode="create"]',
      ]).catch((error) => {
        warnings.push(`create auth gate click failed: ${error.message}`);
        return false;
      });
      if (didClickCreateGate) {
        await page.waitForTimeout(150);
        await captureNamedState(page, runId, screenshots, metrics, 'createAuthGate', 'create-auth-gate');
        await closeTransientUi(page);
      }

      const didClickModels = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll('[data-models-link]')];
        const visible = candidates.find((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        });
        const trigger = visible || candidates[0];
        if (!trigger) return false;
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }).catch((error) => {
        warnings.push(`models click failed: ${error.message}`);
        return false;
      });
      if (didClickModels) {
        await page.waitForTimeout(150);
        await captureNamedState(page, runId, screenshots, metrics, 'modelsClick', 'models');
      }
    }
  }

  if (route.name.startsWith('pricing-')) {
    const didOpenWallet = scenario.name === 'mobile'
      ? await page.evaluate(() => {
        const menu = document.querySelector('#mobileMenuBtn');
        if (menu) menu.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        const trigger = document.querySelector('[data-wallet-open="mobile"]');
        if (!trigger) return false;
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      }).catch((error) => {
        warnings.push(`pricing mobile wallet click failed: ${error.message}`);
        return false;
      })
      : await clickVisibleCandidate(page, ['.wallet-nav__trigger', '[data-wallet-open="desktop"]']).catch((error) => {
        warnings.push(`pricing wallet click failed: ${error.message}`);
        return false;
      });
    if (didOpenWallet) {
      await page.waitForTimeout(180);
      await captureNamedState(page, runId, screenshots, metrics, 'walletOpen', 'wallet-open');
      await closeTransientUi(page);
    }

    const didClickPricingAuth = await clickVisibleCandidate(page, [
      '.pricing-card__cta[data-pricing-auth-entry]',
      '.pricing-card__cta',
      '.pricing-legal__checkout',
    ]).catch((error) => {
      warnings.push(`pricing auth click failed: ${error.message}`);
      return false;
    });
    if (didClickPricingAuth) {
      await page.waitForTimeout(180);
      await captureNamedState(page, runId, screenshots, metrics, 'pricingAuthGate', 'pricing-auth-gate');
      await closeTransientUi(page);
    }
  }

  if (route.name.startsWith('generate-lab-')) {
    const didClickModelCard = await clickVisibleCandidate(page, [
      '#labModelList .generate-lab__model-card',
    ]).catch((error) => {
      warnings.push(`generate lab model card click failed: ${error.message}`);
      return false;
    });
    if (didClickModelCard) {
      await page.waitForTimeout(100);
      await captureNamedState(page, runId, screenshots, metrics, 'generateLabModelPicker', 'model-picker');
    }
  }

  await context.close();
  return {
    browser: browserName,
    consoleErrors,
    expectedConsoleNotices,
    pageErrors,
    reducedMotion,
    route: route.path,
    authState: route.authState || 'guest',
    routeName: route.name,
    scenario: scenario.name,
    screenshots,
    warnings,
    metrics,
    status: consoleErrors.length || pageErrors.length ? 'warning' : 'ok',
  };
}

function renderMarkdown(results) {
  const lines = [];
  lines.push('# BITBI Visual Guardrails Capture');
  lines.push('');
  lines.push(`Serve root: ${path.relative(ROOT, SERVE_ROOT) || '.'}`);
  lines.push(`Results: ${results.length}`);
  lines.push('');
  lines.push('| Browser | Viewport | Route | Motion | Status | Console errors | Page errors | Warnings | Expected local notices | Initial screenshot |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const result of results) {
    lines.push(`| ${result.browser} | ${result.scenario} | ${result.route} | ${result.reducedMotion ? 'reduced' : 'normal'} | ${result.status} | ${result.consoleErrors.length} | ${result.pageErrors.length} | ${result.warnings.length} | ${result.expectedConsoleNotices.length} | ${result.screenshots.initial || ''} |`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Screenshots are evidence artifacts for manual review, not committed baseline snapshots.');
  lines.push('- API calls are locally stubbed; paid generation, billing, payment, and mutation endpoints are not invoked.');
  return lines.join('\n');
}

async function run() {
  ensureArtifactRoot();
  const { server, origin } = await createServer();
  const results = [];
  const failures = [];

  try {
    for (const browserDefinition of BROWSERS) {
      let browser = null;
      try {
        browser = await browserDefinition.launcher.launch({ headless: true });
        for (const { route, scenario, reducedMotion } of buildRunPlan(browserDefinition.name)) {
          try {
            results.push(await captureScenario({
              browser,
              browserName: browserDefinition.name,
              origin,
              route,
              scenario,
              reducedMotion,
            }));
          } catch (error) {
            failures.push({
              browser: browserDefinition.name,
              error: error.message,
              reducedMotion,
              route: route.path,
              scenario: scenario.name,
            });
          }
        }
      } catch (error) {
        failures.push({ browser: browserDefinition.name, error: error.message });
      } finally {
        if (browser) await browser.close();
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    serveRoot: path.relative(ROOT, SERVE_ROOT) || '.',
    origin,
    results,
    failures,
  };
  fs.writeFileSync(path.join(ARTIFACT_ROOT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(ARTIFACT_ROOT, 'summary.md'), `${renderMarkdown(results)}\n`);

  process.stdout.write(`Visual guardrails captured ${results.length} scenario(s).\n`);
  process.stdout.write(`Artifacts: ${path.relative(ROOT, ARTIFACT_ROOT)}\n`);
  if (failures.length) {
    process.stdout.write('Browser launch failures:\n');
    for (const failure of failures) {
      process.stdout.write(`- ${failure.browser}: ${failure.error}\n`);
    }
  }
  const warningCount = results.reduce((sum, result) => (
    sum + result.consoleErrors.length + result.pageErrors.length + result.warnings.length
  ), 0);
  const expectedNoticeCount = results.reduce((sum, result) => sum + result.expectedConsoleNotices.length, 0);
  process.stdout.write(`Warnings captured: ${warningCount}\n`);
  process.stdout.write(`Expected local auth/stub console notices filtered: ${expectedNoticeCount}\n`);

  if (!results.length) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
