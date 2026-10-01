// Public help context only. Never inspect forms, session data, query parameters,
// project identifiers or account content to decide what to send to the assistant.
const routes = new Map([
  ['/', 'home'], ['/index.html', 'home'],
  ['/generate-lab', 'generate-lab'], ['/generate-lab/', 'generate-lab'], ['/generate-lab/index.html', 'generate-lab'],
  ['/canvas', 'canvas'], ['/canvas/', 'canvas'], ['/canvas/index.html', 'canvas'],
  ['/pricing', 'pricing'], ['/pricing.html', 'pricing'],
  ['/account/assets-manager.html', 'assets'], ['/account/credits.html', 'credits'],
  ['/account/image-studio.html', 'images'], ['/account/profile.html', 'profile'],
  ['/account/profile-settings.html', 'profile'],
  ['/legal/privacy.html', 'privacy'], ['/legal/datenschutz.html', 'privacy'],
  ['/legal/terms.html', 'legal'], ['/legal/imprint.html', 'legal'],
]);
// The static server and frontend hosting may canonicalize approved .html routes.
// Derive only these exact aliases, never accept arbitrary account subpaths.
for (const [path, pageId] of [...routes]) if (path.endsWith('.html')) routes.set(path.slice(0, -5), pageId);
const homeSections = new Map([
  ['#gallery', 'images'], ['#video-creations', 'video'], ['#soundlab', 'music'], ['#contact', 'contact'],
]);
export const publicPageIds = Object.freeze([
  'home', 'images', 'video', 'music', 'generate-lab', 'canvas', 'pricing',
  'assets', 'credits', 'profile', 'privacy', 'legal', 'contact',
]);

export function publicContextForPath(pathname, hash = '') {
  if (typeof pathname !== 'string' || pathname.length > 120 || /[?#\\%]/.test(pathname)) return null;
  const language = pathname === '/de' || pathname.startsWith('/de/') ? 'de' : 'en';
  const path = language === 'de' ? pathname.slice(3) || '/' : pathname;
  const pageId = routes.get(path);
  if (!pageId) return null;
  return { pageId: pageId === 'home' ? homeSections.get(hash) || pageId : pageId, language };
}
