// Browser module maps retain failed imports. A deliberate retry needs a fresh
// module URL while preserving the build's asset version; never retry on a timer.
const retries = new Map();
export async function loadAdminModule(source) {
    const key = source.href;
    const attempt = retries.get(key) || 0;
    const url = new URL(key);
    if (attempt) url.searchParams.set('admin_retry', String(attempt));
    try { return await import(url.href); }
    catch (error) { retries.set(key, attempt + 1); throw error; }
}
