const fs = require('fs');
const path = require('path');

const IMAGE_BYTES = fs.readFileSync(path.join(__dirname, '../fixtures/media/favorite-thumb.jpg'));
const VIDEO_BYTES = fs.readFileSync(path.join(__dirname, '../fixtures/media/test-video.mp4'));
const COLLECTIONS = ['mempics', 'memvids', 'memtracks'];

function buildHomepageMediaItems(collection, count = 60) {
  return Array.from({ length: count }, (_, index) => {
    const id = `loading-${collection}-${index + 1}`;
    const base = `/api/gallery/${collection}/${id}`;
    const item = {
      id,
      slug: id,
      title: `${collection} ${index + 1}`,
      caption: 'Local populated homepage fixture.',
      category: collection,
      publisher: { display_name: 'Fixture Publisher', avatar: { url: `${base}/avatar` } },
      file: { url: `${base}/file` },
    };
    if (collection === 'mempics') {
      item.thumb = { url: `${base}/thumb`, w: 640, h: 640 };
      item.preview = { url: `${base}/medium`, w: 1280, h: 1280 };
      item.full = { url: `${base}/file` };
    } else {
      item.poster = { url: `${base}/poster`, w: 640, h: 360 };
    }
    return item;
  });
}

async function routeHomepageMediaFixtures(page, { failImage = '' } = {}) {
  const items = Object.fromEntries(COLLECTIONS.map((collection) => [collection, buildHomepageMediaItems(collection)]));
  const requests = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (/\/api\/gallery\/(?:mempics|memvids|memtracks)\/[^/]+\/(?:thumb|poster|avatar|medium|file)$/.test(pathname)) {
      requests.push(pathname);
    }
  });
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const collection = COLLECTIONS.find((name) => pathname === `/api/gallery/${name}`);
    if (collection) return route.fulfill({
      json: { ok: true, data: { items: items[collection], has_more: false, next_cursor: null, applied_limit: 60 } },
    });
    if (pathname === failImage) return route.fulfill({ status: 404, body: '' });
    if (/\/(?:thumb|poster|avatar|medium)$/.test(pathname)) {
      return route.fulfill({ contentType: 'image/jpeg', body: IMAGE_BYTES });
    }
    if (pathname.endsWith('/file')) {
      return route.fulfill({ contentType: pathname.includes('/memvids/') ? 'video/mp4' : 'image/jpeg', body: pathname.includes('/memvids/') ? VIDEO_BYTES : IMAGE_BYTES });
    }
    if (pathname === '/api/me') return route.fulfill({ json: { loggedIn: false, user: null } });
    if (pathname === '/api/public/news-pulse') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: { ok: true, data: { items: [] } } });
  });
  await page.route(/^https?:\/\/(?!localhost(?::|\/)|127\.0\.0\.1(?::|\/))/, (route) => route.abort());
  return {
    requests,
    thumbnailRequests(collection) {
      return requests.filter((url) => url.startsWith(`/api/gallery/${collection}/`) && /\/(?:thumb|poster)$/.test(url));
    },
    avatarRequests(collection) {
      return requests.filter((url) => url.startsWith(`/api/gallery/${collection}/`) && url.endsWith('/avatar'));
    },
  };
}

module.exports = { buildHomepageMediaItems, routeHomepageMediaFixtures };
