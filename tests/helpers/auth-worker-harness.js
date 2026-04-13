const path = require('path');
const { pathToFileURL } = require('url');
const { webcrypto } = require('crypto');

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function countInlinePlaceholders(query, pattern) {
  const match = query.match(pattern);
  if (!match || !match[1]) return 0;
  return (match[1].match(/\?/g) || []).length;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAiImageRow(row = {}) {
  return {
    thumb_key: null,
    medium_key: null,
    thumb_mime_type: null,
    medium_mime_type: null,
    thumb_width: null,
    thumb_height: null,
    medium_width: null,
    medium_height: null,
    derivatives_status: 'pending',
    derivatives_error: null,
    derivatives_version: 1,
    derivatives_started_at: null,
    derivatives_ready_at: null,
    derivatives_attempted_at: null,
    derivatives_processing_token: null,
    derivatives_lease_expires_at: null,
    ...row,
  };
}

function listAiImageKeys(row) {
  return Array.from(new Set([row?.r2_key, row?.thumb_key, row?.medium_key].filter(Boolean)));
}

async function bodyToArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.byteLength === value.byteLength
      ? value.buffer
      : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (typeof value.arrayBuffer === 'function') {
    try {
      return await value.arrayBuffer();
    } catch {
      return null;
    }
  }
  if (typeof value.getReader === 'function') {
    try {
      return await new Response(value).arrayBuffer();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).buffer;
  }
  return null;
}

function parseMockImageInfo(bytes, fallback) {
  try {
    const text = new TextDecoder().decode(bytes);
    const match = text.match(/^mock-image:(\d+)x(\d+):(.+)$/);
    if (!match) return fallback;
    return {
      width: Number(match[1]) || fallback.width,
      height: Number(match[2]) || fallback.height,
      format: match[3] || fallback.format,
    };
  } catch {
    return fallback;
  }
}

function scaleDownDimensions(width, height, maxWidth, maxHeight) {
  const safeWidth = Math.max(1, Number(width) || maxWidth || 1);
  const safeHeight = Math.max(1, Number(height) || maxHeight || 1);
  const ratio = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);
  return {
    width: Math.max(1, Math.round(safeWidth * ratio)),
    height: Math.max(1, Math.round(safeHeight * ratio)),
  };
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

class MockBucket {
  constructor(initial = {}) {
    this.objects = new Map();
    this.failDeleteKeys = new Set();
    this.putCalls = [];
    this.getCalls = [];
    this.listCalls = [];
    this.deleteCalls = [];
    for (const [key, value] of Object.entries(initial)) {
      this.objects.set(key, {
        body: value.body,
        httpMetadata: value.httpMetadata || {},
        size: value.size ?? (value.body?.byteLength ?? 0),
        uploaded: value.uploaded ? new Date(value.uploaded) : new Date(),
      });
      if (value.failDelete) this.failDeleteKeys.add(key);
    }
  }

  async put(key, body, options = {}) {
    this.putCalls.push({ key, options });
    this.objects.set(key, {
      body,
      httpMetadata: options.httpMetadata || {},
      size: body?.byteLength ?? 0,
      uploaded: new Date(),
    });
  }

  async get(key) {
    this.getCalls.push(key);
    return this.objects.get(key) || null;
  }

  async delete(key) {
    this.deleteCalls.push(key);
    if (this.failDeleteKeys.has(key)) {
      throw new Error(`Mock delete failure for ${key}`);
    }
    this.objects.delete(key);
  }

  async list({ prefix = '', limit = 1000 } = {}) {
    this.listCalls.push({ prefix, limit });
    const objects = [];
    for (const [key, value] of this.objects) {
      if (!key.startsWith(prefix)) continue;
      objects.push({
        key,
        uploaded: value.uploaded,
        size: value.size,
        httpMetadata: value.httpMetadata,
      });
      if (objects.length >= limit) break;
    }
    return { objects };
  }
}

class MockQueueProducer {
  constructor() {
    this.messages = [];
    this.failWith = null;
  }

  async send(body) {
    if (this.failWith) {
      throw this.failWith instanceof Error ? this.failWith : new Error(String(this.failWith));
    }
    this.messages.push(deepClone(body));
  }
}

class MockImagesBinding {
  constructor(options = {}) {
    this.originalInfo = options.originalInfo || { width: 1024, height: 1024, format: 'image/png' };
    this.failInfoWith = options.failInfoWith || null;
    this.failResponseWith = options.failResponseWith || null;
    this.infoCalls = [];
    this.transformCalls = [];
  }

  async info(input) {
    if (this.failInfoWith) {
      throw this.failInfoWith instanceof Error ? this.failInfoWith : new Error(String(this.failInfoWith));
    }
    const buffer = await bodyToArrayBuffer(input);
    const bytes = buffer ? new Uint8Array(buffer) : new Uint8Array();
    const info = parseMockImageInfo(bytes, this.originalInfo);
    this.infoCalls.push(info);
    return info;
  }

  input(input) {
    const binding = this;
    const transforms = [];
    let outputOptions = null;
    return {
      transform(options) {
        transforms.push(options || {});
        return this;
      },
      // Matches Cloudflare Images runtime: .output() returns a
      // Promise<ImageTransformationResult> with .response(), .image(),
      // and .contentType() methods.
      output(options) {
        outputOptions = options || {};
        return (async () => {
          if (binding.failResponseWith) {
            throw binding.failResponseWith instanceof Error
              ? binding.failResponseWith
              : new Error(String(binding.failResponseWith));
          }

          const buffer = await bodyToArrayBuffer(input);
          const bytes = buffer ? new Uint8Array(buffer) : new Uint8Array();
          const inputInfo = parseMockImageInfo(bytes, binding.originalInfo);
          const latest = transforms[transforms.length - 1] || {};
          const dims = scaleDownDimensions(
            inputInfo.width,
            inputInfo.height,
            latest.width || inputInfo.width,
            latest.height || inputInfo.height
          );
          const format = outputOptions?.format || 'image/webp';
          binding.transformCalls.push({
            transforms: deepClone(transforms),
            outputOptions: deepClone(outputOptions),
            width: dims.width,
            height: dims.height,
          });
          const body = new TextEncoder().encode(`mock-image:${dims.width}x${dims.height}:${format}`);
          const res = new Response(body, {
            headers: { 'content-type': format },
          });
          // ImageTransformationResult shape
          return {
            response() { return res; },
            image() {
              return new ReadableStream({
                start(controller) { controller.enqueue(body); controller.close(); },
              });
            },
            contentType() { return format; },
          };
        })();
      },
    };
  }
}

class BoundStatement {
  constructor(db, query, bindings = []) {
    this.db = db;
    this.query = query;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new BoundStatement(this.db, this.query, bindings);
  }

  async first() {
    return this.db.execute(this.query, this.bindings, 'first');
  }

  async all() {
    return this.db.execute(this.query, this.bindings, 'all');
  }

  async run() {
    return this.db.execute(this.query, this.bindings, 'run');
  }
}

class MockD1 {
  constructor(seed = {}) {
    this.state = {
      users: [],
      sessions: [],
      emailVerificationTokens: [],
      passwordResetTokens: [],
      profiles: [],
      favorites: [],
      adminAuditLog: [],
      rateLimitCounters: [],
      aiFolders: [],
      aiImages: [],
      aiTextAssets: [],
      aiGenerationLog: [],
      aiDailyQuotaUsage: [],
      userActivityLog: [],
      r2CleanupQueue: [],
      ...deepClone(seed),
    };
    this.state.profiles = (this.state.profiles || []).map((row) => ({
      has_avatar: row.has_avatar ?? null,
      ...row,
    }));
    this.state.aiImages = (this.state.aiImages || []).map((row) => normalizeAiImageRow(row));
    this._cleanupSeq = (this.state.r2CleanupQueue || []).length + 1;
    this._lastChanges = 0;
  }

  prepare(query) {
    return new BoundStatement(this, query);
  }

  async batch(statements) {
    const snapshot = deepClone(this.state);
    const seq = this._cleanupSeq;
    const lastChanges = this._lastChanges;
    const results = [];
    try {
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    } catch (error) {
      this.state = snapshot;
      this._cleanupSeq = seq;
      this._lastChanges = lastChanges;
      throw error;
    }
  }

  async execute(rawQuery, bindings, mode) {
    const query = normalizeSql(rawQuery);

    if (query.includes('FROM sessions INNER JOIN users ON users.id = sessions.user_id')) {
      const [tokenHash, currentTime] = bindings;
      const session = this.state.sessions.find(
        (row) => row.token_hash === tokenHash && row.expires_at > currentTime
      );
      if (!session) return mode === 'all' ? { results: [] } : null;
      const user = this.state.users.find(
        (row) => row.id === session.user_id && row.status === 'active'
      );
      if (!user) return mode === 'all' ? { results: [] } : null;
      return {
        session_id: session.id,
        user_id: session.user_id,
        expires_at: session.expires_at,
        last_seen_at: session.last_seen_at || null,
        email: user.email,
        created_at: user.created_at,
        status: user.status,
        role: user.role,
        verification_method: user.verification_method ?? null,
      };
    }

    if (query === 'UPDATE sessions SET last_seen_at = ? WHERE id = ?') {
      const [lastSeenAt, sessionId] = bindings;
      const row = this.state.sessions.find((item) => item.id === sessionId);
      if (row) row.last_seen_at = lastSeenAt;
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }

    if (query.startsWith('SELECT id, email, password_hash, created_at, status, role, email_verified_at FROM users WHERE email = ?')) {
      const [email] = bindings;
      return this.state.users.find((row) => row.email === email) || null;
    }

    if (query.startsWith('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) VALUES')) {
      const [id, userId, tokenHash, createdAt, expiresAt, lastSeenAt] = bindings;
      this.state.sessions.push({
        id,
        user_id: userId,
        token_hash: tokenHash,
        created_at: createdAt,
        expires_at: expiresAt,
        last_seen_at: lastSeenAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1') {
      const [tokenHash] = bindings;
      const row = this.state.sessions.find((item) => item.token_hash === tokenHash);
      return row ? { user_id: row.user_id } : null;
    }

    if (query === 'DELETE FROM sessions WHERE token_hash = ?') {
      const [tokenHash] = bindings;
      const before = this.state.sessions.length;
      this.state.sessions = this.state.sessions.filter((row) => row.token_hash !== tokenHash);
      return { success: true, meta: { changes: before - this.state.sessions.length } };
    }

    if (query.startsWith('INSERT INTO user_activity_log (id, user_id, action, meta_json, ip_address, created_at) VALUES')) {
      const [id, userId, action, metaJson, ipAddress, createdAt] = bindings;
      this.state.userActivityLog.push({
        id,
        user_id: userId,
        action,
        meta_json: metaJson,
        ip_address: ipAddress,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO rate_limit_counters (scope, limiter_key, window_start_ms, count, expires_at, updated_at)')) {
      const [scope, limiterKey, windowStartMs, expiresAt, updatedAt] = bindings;
      const existing = this.state.rateLimitCounters.find(
        (row) =>
          row.scope === scope &&
          row.limiter_key === limiterKey &&
          row.window_start_ms === windowStartMs
      );
      if (existing) {
        existing.count += 1;
        existing.updated_at = updatedAt;
        existing.expires_at = expiresAt;
      } else {
        this.state.rateLimitCounters.push({
          scope,
          limiter_key: limiterKey,
          window_start_ms: windowStartMs,
          count: 1,
          expires_at: expiresAt,
          updated_at: updatedAt,
        });
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT count FROM rate_limit_counters WHERE scope = ? AND limiter_key = ? AND window_start_ms = ? LIMIT 1') {
      const [scope, limiterKey, windowStartMs] = bindings;
      const row = this.state.rateLimitCounters.find(
        (item) =>
          item.scope === scope &&
          item.limiter_key === limiterKey &&
          item.window_start_ms === windowStartMs
      );
      return row ? { count: row.count } : null;
    }

    if (query === 'DELETE FROM rate_limit_counters WHERE expires_at < ?') {
      const [now] = bindings;
      const before = this.state.rateLimitCounters.length;
      this.state.rateLimitCounters = this.state.rateLimitCounters.filter((row) => row.expires_at >= now);
      return { success: true, meta: { changes: before - this.state.rateLimitCounters.length } };
    }

    if (query === 'SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1') {
      const [userId] = bindings;
      return this.state.users.find((row) => row.id === userId) || null;
    }

    if (query === 'DELETE FROM sessions WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.sessions.length;
      this.state.sessions = this.state.sessions.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.sessions.length } };
    }

    if (query === 'DELETE FROM sessions WHERE expires_at < ?') {
      const [now] = bindings;
      const before = this.state.sessions.length;
      this.state.sessions = this.state.sessions.filter((row) => row.expires_at >= now);
      return { success: true, meta: { changes: before - this.state.sessions.length } };
    }

    if (query === 'DELETE FROM email_verification_tokens WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.emailVerificationTokens.length;
      this.state.emailVerificationTokens = this.state.emailVerificationTokens.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.emailVerificationTokens.length } };
    }

    if (query === 'DELETE FROM email_verification_tokens WHERE used_at IS NOT NULL OR expires_at < ?') {
      const [now] = bindings;
      const before = this.state.emailVerificationTokens.length;
      this.state.emailVerificationTokens = this.state.emailVerificationTokens.filter(
        (row) => row.used_at == null && row.expires_at >= now
      );
      return { success: true, meta: { changes: before - this.state.emailVerificationTokens.length } };
    }

    if (query === 'DELETE FROM password_reset_tokens WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.passwordResetTokens.length;
      this.state.passwordResetTokens = this.state.passwordResetTokens.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.passwordResetTokens.length } };
    }

    if (query === 'DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at < ?') {
      const [now] = bindings;
      const before = this.state.passwordResetTokens.length;
      this.state.passwordResetTokens = this.state.passwordResetTokens.filter(
        (row) => row.used_at == null && row.expires_at >= now
      );
      return { success: true, meta: { changes: before - this.state.passwordResetTokens.length } };
    }

    if (query === 'DELETE FROM profiles WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.profiles.length;
      this.state.profiles = this.state.profiles.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.profiles.length } };
    }

    if (query === 'SELECT display_name, bio, website, youtube_url, created_at FROM profiles WHERE user_id = ?') {
      const [userId] = bindings;
      return this.state.profiles.find((row) => row.user_id === userId) || null;
    }

    if (query === 'SELECT display_name FROM profiles WHERE user_id = ? LIMIT 1') {
      const [userId] = bindings;
      const row = this.state.profiles.find((entry) => entry.user_id === userId);
      if (!row) return null;
      return { display_name: row.display_name };
    }

    if (query === 'SELECT display_name, has_avatar FROM profiles WHERE user_id = ? LIMIT 1') {
      const [userId] = bindings;
      const row = this.state.profiles.find((entry) => entry.user_id === userId);
      if (!row) return null;
      return {
        display_name: row.display_name,
        has_avatar: row.has_avatar ?? null,
      };
    }

    if (query.startsWith('INSERT INTO profiles (user_id, display_name, bio, website, youtube_url, created_at, updated_at) VALUES')) {
      const [userId, displayName, bio, website, youtubeUrl, createdAt, updatedAt] = bindings;
      const existing = this.state.profiles.find((row) => row.user_id === userId);
      if (existing) {
        existing.display_name = displayName;
        existing.bio = bio;
        existing.website = website;
        existing.youtube_url = youtubeUrl;
        existing.updated_at = updatedAt;
      } else {
        this.state.profiles.push({
          user_id: userId,
          display_name: displayName,
          bio,
          website,
          youtube_url: youtubeUrl,
          has_avatar: null,
          created_at: createdAt,
          updated_at: updatedAt,
        });
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO profiles (user_id, display_name, bio, website, youtube_url, has_avatar, created_at, updated_at) VALUES')) {
      const [userId, hasAvatar, createdAt, updatedAt] = bindings;
      const existing = this.state.profiles.find((row) => row.user_id === userId);
      if (existing) {
        existing.has_avatar = hasAvatar;
        existing.updated_at = updatedAt;
      } else {
        this.state.profiles.push({
          user_id: userId,
          display_name: '',
          bio: '',
          website: '',
          youtube_url: '',
          has_avatar: hasAvatar,
          created_at: createdAt,
          updated_at: updatedAt,
        });
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT 1 AS existing FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ? LIMIT 1') {
      const [userId, itemType, itemId] = bindings;
      const row = this.state.favorites.find(
        (item) => item.user_id === userId && item.item_type === itemType && item.item_id === itemId
      );
      return row ? { existing: 1 } : null;
    }

    if (query === 'SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        c: this.state.favorites.filter((row) => row.user_id === userId).length,
      };
    }

    if (query === 'INSERT OR IGNORE INTO favorites (user_id, item_type, item_id, title, thumb_url) VALUES (?, ?, ?, ?, ?)') {
      const [userId, itemType, itemId, title, thumbUrl] = bindings;
      const existing = this.state.favorites.find(
        (row) => row.user_id === userId && row.item_type === itemType && row.item_id === itemId
      );
      if (existing) {
        return { success: true, meta: { changes: 0 } };
      }
      this.state.favorites.push({
        id: this.state.favorites.length + 1,
        user_id: userId,
        item_type: itemType,
        item_id: itemId,
        title,
        thumb_url: thumbUrl,
        created_at: nowIso(),
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM favorites WHERE user_id = ? AND item_type = ? AND item_id = ?') {
      const [userId, itemType, itemId] = bindings;
      const before = this.state.favorites.length;
      this.state.favorites = this.state.favorites.filter(
        (row) => !(row.user_id === userId && row.item_type === itemType && row.item_id === itemId)
      );
      return { success: true, meta: { changes: before - this.state.favorites.length } };
    }

    if (query === 'DELETE FROM users WHERE id = ?') {
      const [userId] = bindings;
      const hasAiChildren =
        this.state.aiFolders.some((row) => row.user_id === userId) ||
        this.state.aiImages.some((row) => row.user_id === userId) ||
        this.state.aiTextAssets.some((row) => row.user_id === userId);
      if (hasAiChildren) {
        throw new Error('FOREIGN KEY constraint failed');
      }
      const before = this.state.users.length;
      this.state.users = this.state.users.filter((row) => row.id !== userId);
      this.state.sessions = this.state.sessions.filter((row) => row.user_id !== userId);
      this.state.emailVerificationTokens = this.state.emailVerificationTokens.filter((row) => row.user_id !== userId);
      this.state.passwordResetTokens = this.state.passwordResetTokens.filter((row) => row.user_id !== userId);
      this.state.profiles = this.state.profiles.filter((row) => row.user_id !== userId);
      this.state.favorites = this.state.favorites.filter((row) => row.user_id !== userId);
      this.state.aiGenerationLog = this.state.aiGenerationLog.filter((row) => row.user_id !== userId);
      this.state.aiTextAssets = this.state.aiTextAssets.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.users.length } };
    }

    if (query.startsWith('SELECT id, name, slug') && query.includes('FROM ai_folders WHERE user_id = ? AND status IN')) {
      const [userId] = bindings;
      const includeDeleting = query.includes("('active', 'deleting')");
      const rows = this.state.aiFolders
        .filter((row) => row.user_id === userId && (includeDeleting ? ['active', 'deleting'].includes(row.status) : row.status === 'active'))
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((row) => {
          const base = {
            id: row.id,
            name: row.name,
            slug: row.slug,
            created_at: row.created_at,
          };
          if (query.startsWith('SELECT id, name, slug, status, created_at')) {
            base.status = row.status;
          }
          return base;
        });
      return { results: rows };
    }

    if (query === 'SELECT folder_id, COUNT(*) AS cnt FROM ai_images WHERE user_id = ? GROUP BY folder_id') {
      const [userId] = bindings;
      const counts = new Map();
      for (const row of this.state.aiImages) {
        if (row.user_id !== userId) continue;
        const key = row.folder_id ?? null;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return {
        results: Array.from(counts.entries()).map(([folderId, cnt]) => ({
          folder_id: folderId,
          cnt,
        })),
      };
    }

    if (query === 'SELECT folder_id, COUNT(*) AS cnt FROM ai_text_assets WHERE user_id = ? GROUP BY folder_id') {
      const [userId] = bindings;
      const counts = new Map();
      for (const row of this.state.aiTextAssets) {
        if (row.user_id !== userId) continue;
        const key = row.folder_id ?? null;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return {
        results: Array.from(counts.entries()).map(([folderId, cnt]) => ({
          folder_id: folderId,
          cnt,
        })),
      };
    }

    if (query.startsWith('INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at) VALUES')) {
      const [id, adminUserId, action, targetUserId, metaJson, createdAt] = bindings;
      this.state.adminAuditLog.push({
        id,
        admin_user_id: adminUserId,
        action,
        target_user_id: targetUserId,
        meta_json: metaJson,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'") {
      const [folderId, userId] = bindings;
      return this.state.aiFolders.find((row) => row.id === folderId && row.user_id === userId && row.status === 'active') || null;
    }

    if (query === "SELECT id FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'") {
      const [folderId, userId] = bindings;
      const row = this.state.aiFolders.find((item) => item.id === folderId && item.user_id === userId && item.status === 'active');
      return row ? { id: row.id } : null;
    }

    if (query.startsWith('INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at) SELECT')) {
      const [id, userId, folderId, r2Key, prompt, model, steps, seed, createdAt, existsFolderId, existsUserId] = bindings;
      const folder = this.state.aiFolders.find(
        (row) => row.id === existsFolderId && row.user_id === existsUserId && row.status === 'active'
      );
      if (!folder) {
        return { success: true, meta: { changes: 0 } };
      }
      this.state.aiImages.push(normalizeAiImageRow({
        id,
        user_id: userId,
        folder_id: folderId,
        r2_key: r2Key,
        prompt,
        model,
        steps,
        seed,
        created_at: createdAt,
      }));
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at) VALUES')) {
      const [id, userId, folderId, r2Key, prompt, model, steps, seed, createdAt] = bindings;
      this.state.aiImages.push(normalizeAiImageRow({
        id,
        user_id: userId,
        folder_id: folderId,
        r2_key: r2Key,
        prompt,
        model,
        steps,
        seed,
        created_at: createdAt,
      }));
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO ai_text_assets (id, user_id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, metadata_json, created_at) SELECT')) {
      const [id, userId, folderId, r2Key, title, fileName, sourceModule, mimeType, sizeBytes, previewText, metadataJson, createdAt, existsFolderId, existsUserId] = bindings;
      const folder = this.state.aiFolders.find(
        (row) => row.id === existsFolderId && row.user_id === existsUserId && row.status === 'active'
      );
      if (!folder) {
        return { success: true, meta: { changes: 0 } };
      }
      this.state.aiTextAssets.push({
        id,
        user_id: userId,
        folder_id: folderId,
        r2_key: r2Key,
        title,
        file_name: fileName,
        source_module: sourceModule,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        preview_text: previewText,
        metadata_json: metadataJson,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO ai_text_assets (id, user_id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, metadata_json, created_at) VALUES')) {
      const [id, userId, folderId, r2Key, title, fileName, sourceModule, mimeType, sizeBytes, previewText, metadataJson, createdAt] = bindings;
      this.state.aiTextAssets.push({
        id,
        user_id: userId,
        folder_id: folderId,
        r2_key: r2Key,
        title,
        file_name: fileName,
        source_module: sourceModule,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        preview_text: previewText,
        metadata_json: metadataJson,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO ai_generation_log (id, user_id, created_at) VALUES')) {
      const [id, userId, createdAt] = bindings;
      this.state.aiGenerationLog.push({
        id,
        user_id: userId,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM ai_generation_log WHERE id = ?') {
      const [logId] = bindings;
      const before = this.state.aiGenerationLog.length;
      this.state.aiGenerationLog = this.state.aiGenerationLog.filter((row) => row.id !== logId);
      return { success: true, meta: { changes: before - this.state.aiGenerationLog.length } };
    }

    if (query === 'SELECT r2_key FROM ai_images WHERE id = ? AND user_id = ?') {
      const [imageId, userId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.user_id === userId);
      return row ? { r2_key: row.r2_key } : null;
    }

    if (query === 'SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE id = ? AND user_id = ?') {
      const [imageId, userId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.user_id === userId);
      return row
        ? {
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
          }
        : null;
    }

    if (query === 'SELECT r2_key FROM ai_images WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.user_id === userId)
          .map((row) => ({ r2_key: row.r2_key })),
      };
    }

    if (query === 'SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.user_id === userId)
          .map((row) => ({
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
          })),
      };
    }

    if (query === 'SELECT r2_key FROM ai_text_assets WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.user_id === userId)
          .map((row) => ({ r2_key: row.r2_key })),
      };
    }

    if (query === 'SELECT r2_key FROM ai_images WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.folder_id === folderId && row.user_id === userId)
          .map((row) => ({ r2_key: row.r2_key })),
      };
    }

    if (query === 'SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.folder_id === folderId && row.user_id === userId)
          .map((row) => ({
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
          })),
      };
    }

    if (query.startsWith('SELECT id, r2_key, thumb_key, medium_key FROM ai_images WHERE id IN (') && query.endsWith(') AND user_id = ?')) {
      const requestedIds = bindings.slice(0, -1);
      const userId = bindings[bindings.length - 1];
      return {
        results: this.state.aiImages
          .filter((row) => requestedIds.includes(row.id) && row.user_id === userId)
          .map((row) => ({
            id: row.id,
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
          })),
      };
    }

    if (query.startsWith('SELECT id FROM ai_images WHERE id IN (') && query.endsWith(') AND user_id = ?')) {
      const requestedIds = bindings.slice(0, -1);
      const userId = bindings[bindings.length - 1];
      return {
        results: this.state.aiImages
          .filter((row) => requestedIds.includes(row.id) && row.user_id === userId)
          .map((row) => ({ id: row.id })),
      };
    }

    if (query === 'SELECT r2_key FROM ai_text_assets WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.folder_id === folderId && row.user_id === userId)
          .map((row) => ({ r2_key: row.r2_key })),
      };
    }

    if (query.startsWith('SELECT id FROM ai_text_assets WHERE id IN (') && query.endsWith(') AND user_id = ?')) {
      const requestedIds = bindings.slice(0, -1);
      const userId = bindings[bindings.length - 1];
      return {
        results: this.state.aiTextAssets
          .filter((row) => requestedIds.includes(row.id) && row.user_id === userId)
          .map((row) => ({ id: row.id })),
      };
    }

    if (query.startsWith('SELECT id, r2_key FROM ai_text_assets WHERE id IN (') && query.endsWith(') AND user_id = ?')) {
      const requestedIds = bindings.slice(0, -1);
      const userId = bindings[bindings.length - 1];
      return {
        results: this.state.aiTextAssets
          .filter((row) => requestedIds.includes(row.id) && row.user_id === userId)
          .map((row) => ({
            id: row.id,
            r2_key: row.r2_key,
          })),
      };
    }

    if (query.startsWith('SELECT id, folder_id, prompt, model, steps, seed, created_at') && query.includes('FROM ai_images WHERE user_id = ?')) {
      const [userId, maybeFolderId] = bindings;
      let rows = this.state.aiImages.filter((row) => row.user_id === userId);
      if (query.includes('AND folder_id IS NULL')) {
        rows = rows.filter((row) => row.folder_id == null);
      } else if (query.includes('AND folder_id = ?')) {
        rows = rows.filter((row) => row.folder_id === maybeFolderId);
      }
      rows = rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200);
      return {
        results: rows.map((row) => ({
          id: row.id,
          folder_id: row.folder_id,
          prompt: row.prompt,
          model: row.model,
          steps: row.steps,
          seed: row.seed,
          created_at: row.created_at,
          ...(query.includes('thumb_key')
            ? {
                thumb_key: row.thumb_key,
                medium_key: row.medium_key,
                thumb_width: row.thumb_width,
                thumb_height: row.thumb_height,
                medium_width: row.medium_width,
                medium_height: row.medium_height,
                derivatives_status: row.derivatives_status,
                derivatives_version: row.derivatives_version,
              }
            : {}),
        })),
      };
    }

    if (query.startsWith('SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at FROM ai_text_assets WHERE user_id = ?')) {
      const [userId, maybeFolderId] = bindings;
      let rows = this.state.aiTextAssets.filter((row) => row.user_id === userId);
      if (query.includes('AND folder_id IS NULL')) {
        rows = rows.filter((row) => row.folder_id == null);
      } else if (query.includes('AND folder_id = ?')) {
        rows = rows.filter((row) => row.folder_id === maybeFolderId);
      }
      rows = rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200);
      return {
        results: rows.map((row) => ({
          id: row.id,
          folder_id: row.folder_id,
          title: row.title,
          file_name: row.file_name,
          source_module: row.source_module,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes,
          preview_text: row.preview_text,
          created_at: row.created_at,
        })),
      };
    }

    if (
      query === 'SELECT thumb_key AS derivative_key, thumb_mime_type AS mime_type, derivatives_status, derivatives_attempted_at, derivatives_lease_expires_at, r2_key FROM ai_images WHERE id = ? AND user_id = ?' ||
      query === 'SELECT medium_key AS derivative_key, medium_mime_type AS mime_type, derivatives_status, derivatives_attempted_at, derivatives_lease_expires_at, r2_key FROM ai_images WHERE id = ? AND user_id = ?'
    ) {
      const [imageId, userId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.user_id === userId);
      if (!row) return null;
      if (query.startsWith('SELECT thumb_key')) {
        return {
          derivative_key: row.thumb_key,
          mime_type: row.thumb_mime_type,
          derivatives_status: row.derivatives_status,
          derivatives_attempted_at: row.derivatives_attempted_at,
          derivatives_lease_expires_at: row.derivatives_lease_expires_at,
          r2_key: row.r2_key,
        };
      }
      return {
        derivative_key: row.medium_key,
        mime_type: row.medium_mime_type,
        derivatives_status: row.derivatives_status,
        derivatives_attempted_at: row.derivatives_attempted_at,
        derivatives_lease_expires_at: row.derivatives_lease_expires_at,
        r2_key: row.r2_key,
      };
    }

    if (query === 'UPDATE ai_images SET derivatives_error = ?, derivatives_attempted_at = ? WHERE id = ? AND user_id = ?') {
      const [derivativesError, attemptedAt, imageId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (row.id === imageId && row.user_id === userId) {
          row.derivatives_error = derivativesError;
          row.derivatives_attempted_at = attemptedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (
      query.startsWith('SELECT id, user_id, r2_key, created_at, thumb_key, medium_key, derivatives_status, derivatives_version, derivatives_attempted_at, derivatives_lease_expires_at FROM ai_images WHERE (')
      && query.includes('ORDER BY created_at DESC, id DESC LIMIT ?')
    ) {
      let index = 0;
      const targetVersion = bindings[index++];
      const now = bindings[index++];
      const includeFailed = !query.includes("derivatives_status != 'failed'");
      let attemptedBefore = null;
      if (query.includes('(derivatives_attempted_at IS NULL OR derivatives_attempted_at <= ?)')) {
        attemptedBefore = bindings[index++];
      }
      let cursor = null;
      if (query.includes('(created_at < ? OR (created_at = ? AND id < ?))')) {
        const cursorCreatedAt = bindings[index++];
        index += 1;
        cursor = {
          createdAt: cursorCreatedAt,
          id: bindings[index++],
        };
      }
      const limit = bindings[index];
      let rows = this.state.aiImages.filter((row) => {
        const needsWork =
          (row.derivatives_version || 0) < targetVersion ||
          row.derivatives_status !== 'ready' ||
          row.thumb_key == null ||
          row.medium_key == null;
        const processingExpired =
          row.derivatives_status !== 'processing' ||
          row.derivatives_lease_expires_at == null ||
          row.derivatives_lease_expires_at < now;
        const failedAllowed = includeFailed || row.derivatives_status !== 'failed';
        const attemptAllowed =
          !attemptedBefore ||
          row.derivatives_attempted_at == null ||
          row.derivatives_attempted_at <= attemptedBefore;
        return needsWork && processingExpired && failedAllowed && attemptAllowed;
      });
      if (cursor) {
        rows = rows.filter(
          (row) =>
            row.created_at < cursor.createdAt ||
            (row.created_at === cursor.createdAt && row.id < cursor.id)
        );
      }
      rows = rows
        .slice()
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
        .slice(0, limit);
      return {
        results: rows.map((row) => ({
          id: row.id,
          user_id: row.user_id,
          r2_key: row.r2_key,
          created_at: row.created_at,
          thumb_key: row.thumb_key,
          medium_key: row.medium_key,
          derivatives_status: row.derivatives_status,
          derivatives_version: row.derivatives_version,
          derivatives_attempted_at: row.derivatives_attempted_at,
          derivatives_lease_expires_at: row.derivatives_lease_expires_at,
        })),
      };
    }

    if (query === 'SELECT id, user_id, r2_key, thumb_key, medium_key, derivatives_status, derivatives_version, derivatives_processing_token, derivatives_lease_expires_at FROM ai_images WHERE id = ? AND user_id = ?') {
      const [imageId, userId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.user_id === userId);
      return row
        ? {
            id: row.id,
            user_id: row.user_id,
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
            derivatives_status: row.derivatives_status,
            derivatives_version: row.derivatives_version,
            derivatives_processing_token: row.derivatives_processing_token,
            derivatives_lease_expires_at: row.derivatives_lease_expires_at,
          }
        : null;
    }

    if (query.startsWith("UPDATE ai_images SET derivatives_status = 'processing', derivatives_error = NULL, derivatives_started_at = CASE")) {
      const [leaseNow, startedAt, attemptedAt, processingToken, leaseExpiresAt, imageId, userId, leaseCheckNow, targetVersion] = bindings;
      let changes = 0;
      for (const row of this.state.aiImages) {
        const readyCurrent =
          row.derivatives_status === 'ready' &&
          row.thumb_key &&
          row.medium_key &&
          (row.derivatives_version || 0) >= targetVersion;
        const leaseActive =
          row.derivatives_status === 'processing' &&
          row.derivatives_lease_expires_at &&
          row.derivatives_lease_expires_at > leaseCheckNow;
        if (row.id === imageId && row.user_id === userId && !leaseActive && !readyCurrent) {
          row.derivatives_status = 'processing';
          row.derivatives_error = null;
          row.derivatives_started_at =
            row.derivatives_status === 'processing' && row.derivatives_lease_expires_at > leaseNow
              ? row.derivatives_started_at
              : startedAt;
          row.derivatives_attempted_at = attemptedAt;
          row.derivatives_processing_token = processingToken;
          row.derivatives_lease_expires_at = leaseExpiresAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query.startsWith("UPDATE ai_images SET derivatives_status = ?, derivatives_error = ?, derivatives_attempted_at = ?, derivatives_processing_token = NULL, derivatives_lease_expires_at = NULL WHERE id = ? AND user_id = ? AND derivatives_processing_token = ?")) {
      const [status, derivativesError, attemptedAt, imageId, userId, processingToken] = bindings;
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (row.id === imageId && row.user_id === userId && row.derivatives_processing_token === processingToken) {
          row.derivatives_status = status;
          row.derivatives_error = derivativesError;
          row.derivatives_attempted_at = attemptedAt;
          row.derivatives_processing_token = null;
          row.derivatives_lease_expires_at = null;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query.startsWith("UPDATE ai_images SET thumb_key = ?, medium_key = ?, thumb_mime_type = ?, medium_mime_type = ?, thumb_width = ?, thumb_height = ?, medium_width = ?, medium_height = ?, derivatives_status = 'ready', derivatives_error = NULL, derivatives_version = ?, derivatives_ready_at = ?, derivatives_attempted_at = ?, derivatives_processing_token = NULL, derivatives_lease_expires_at = NULL WHERE id = ? AND user_id = ? AND derivatives_processing_token = ?")) {
      const [
        thumbKey,
        mediumKey,
        thumbMimeType,
        mediumMimeType,
        thumbWidth,
        thumbHeight,
        mediumWidth,
        mediumHeight,
        derivativesVersion,
        derivativesReadyAt,
        derivativesAttemptedAt,
        imageId,
        userId,
        processingToken,
      ] = bindings;
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (row.id === imageId && row.user_id === userId && row.derivatives_processing_token === processingToken) {
          row.thumb_key = thumbKey;
          row.medium_key = mediumKey;
          row.thumb_mime_type = thumbMimeType;
          row.medium_mime_type = mediumMimeType;
          row.thumb_width = thumbWidth;
          row.thumb_height = thumbHeight;
          row.medium_width = mediumWidth;
          row.medium_height = mediumHeight;
          row.derivatives_status = 'ready';
          row.derivatives_error = null;
          row.derivatives_version = derivativesVersion;
          row.derivatives_ready_at = derivativesReadyAt;
          row.derivatives_attempted_at = derivativesAttemptedAt;
          row.derivatives_processing_token = null;
          row.derivatives_lease_expires_at = null;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'DELETE FROM ai_images WHERE id = ?') {
      const [imageId] = bindings;
      const before = this.state.aiImages.length;
      this.state.aiImages = this.state.aiImages.filter((row) => row.id !== imageId);
      return { success: true, meta: { changes: before - this.state.aiImages.length } };
    }

    if (query === 'DELETE FROM ai_images WHERE id = ? AND user_id = ?') {
      const [imageId, userId] = bindings;
      const before = this.state.aiImages.length;
      this.state.aiImages = this.state.aiImages.filter((row) => !(row.id === imageId && row.user_id === userId));
      return { success: true, meta: { changes: before - this.state.aiImages.length } };
    }

    if (query === 'SELECT r2_key, file_name, mime_type FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.user_id === userId);
      return row
        ? {
            r2_key: row.r2_key,
            file_name: row.file_name,
            mime_type: row.mime_type,
          }
        : null;
    }

    if (query === 'SELECT r2_key FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.user_id === userId);
      return row ? { r2_key: row.r2_key } : null;
    }

    if (query === 'DELETE FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const before = this.state.aiTextAssets.length;
      this.state.aiTextAssets = this.state.aiTextAssets.filter((row) => !(row.id === assetId && row.user_id === userId));
      return { success: true, meta: { changes: before - this.state.aiTextAssets.length } };
    }

    if (query === "UPDATE ai_folders SET status = 'deleting' WHERE id = ? AND user_id = ? AND status IN ('active', 'deleting')") {
      const [folderId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiFolders) {
        if (row.id === folderId && row.user_id === userId && (row.status === 'active' || row.status === 'deleting')) {
          row.status = 'deleting';
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_folders SET status = 'active' WHERE id = ? AND user_id = ? AND status = 'deleting'") {
      const [folderId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiFolders) {
        if (row.id === folderId && row.user_id === userId && row.status === 'deleting') {
          row.status = 'active';
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'DELETE FROM ai_images WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      const before = this.state.aiImages.length;
      this.state.aiImages = this.state.aiImages.filter((row) => !(row.folder_id === folderId && row.user_id === userId));
      return { success: true, meta: { changes: before - this.state.aiImages.length } };
    }

    if (query === 'DELETE FROM ai_text_assets WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      const before = this.state.aiTextAssets.length;
      this.state.aiTextAssets = this.state.aiTextAssets.filter((row) => !(row.folder_id === folderId && row.user_id === userId));
      return { success: true, meta: { changes: before - this.state.aiTextAssets.length } };
    }

    if (query === 'DELETE FROM ai_images WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.aiImages.length;
      this.state.aiImages = this.state.aiImages.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.aiImages.length } };
    }

    if (query === 'DELETE FROM ai_text_assets WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.aiTextAssets.length;
      this.state.aiTextAssets = this.state.aiTextAssets.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.aiTextAssets.length } };
    }

    if (query === 'DELETE FROM ai_folders WHERE id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      const before = this.state.aiFolders.length;
      this.state.aiFolders = this.state.aiFolders.filter((row) => !(row.id === folderId && row.user_id === userId));
      return { success: true, meta: { changes: before - this.state.aiFolders.length } };
    }

    if (query === 'DELETE FROM ai_folders WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.aiFolders.length;
      this.state.aiFolders = this.state.aiFolders.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.aiFolders.length } };
    }

    if (
      query.startsWith('WITH requested(id) AS (VALUES')
      && query.includes('UPDATE ai_images SET folder_id = ?')
    ) {
      const requestedCount = (query.match(/\(\?\)/g) || []).length;
      const requestedIds = bindings.slice(0, requestedCount);
      const folderId = bindings[requestedCount];
      const userId = bindings[requestedCount + 1];
      const ownershipUserId = bindings[requestedCount + 2];
      const folderUserId = bindings[requestedCount + 4];
      const folderActive = this.state.aiFolders.some(
        (row) => row.id === folderId && row.user_id === folderUserId && row.status === 'active'
      );
      const matches = this.state.aiImages.filter((row) => requestedIds.includes(row.id) && row.user_id === ownershipUserId);
      if (!folderActive || matches.length !== requestedIds.length) {
        this._lastChanges = 0;
        return { success: true, meta: { changes: 0 } };
      }
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (requestedIds.includes(row.id) && row.user_id === userId) {
          row.folder_id = folderId;
          changes += 1;
        }
      }
      this._lastChanges = changes;
      return { success: true, meta: { changes } };
    }

    if (
      query.startsWith('WITH requested(id) AS (VALUES')
      && query.includes('UPDATE ai_images SET folder_id = NULL')
    ) {
      const requestedCount = (query.match(/\(\?\)/g) || []).length;
      const requestedIds = bindings.slice(0, requestedCount);
      const userId = bindings[requestedCount];
      const ownershipUserId = bindings[requestedCount + 1];
      const matches = this.state.aiImages.filter((row) => requestedIds.includes(row.id) && row.user_id === ownershipUserId);
      if (matches.length !== requestedIds.length) {
        this._lastChanges = 0;
        return { success: true, meta: { changes: 0 } };
      }
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (requestedIds.includes(row.id) && row.user_id === userId) {
          row.folder_id = null;
          changes += 1;
        }
      }
      this._lastChanges = changes;
      return { success: true, meta: { changes } };
    }

    if (
      query.startsWith('WITH requested(id) AS (VALUES')
      && query.includes('UPDATE ai_text_assets SET folder_id = ?')
    ) {
      const requestedCount = (query.match(/\(\?\)/g) || []).length;
      const requestedIds = bindings.slice(0, requestedCount);
      const folderId = bindings[requestedCount];
      const userId = bindings[requestedCount + 1];
      const ownershipUserId = bindings[requestedCount + 2];
      const folderUserId = bindings[requestedCount + 4];
      const folderActive = this.state.aiFolders.some(
        (row) => row.id === folderId && row.user_id === folderUserId && row.status === 'active'
      );
      const matches = this.state.aiTextAssets.filter((row) => requestedIds.includes(row.id) && row.user_id === ownershipUserId);
      if (!folderActive || matches.length !== requestedIds.length) {
        this._lastChanges = 0;
        return { success: true, meta: { changes: 0 } };
      }
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (requestedIds.includes(row.id) && row.user_id === userId) {
          row.folder_id = folderId;
          changes += 1;
        }
      }
      this._lastChanges = changes;
      return { success: true, meta: { changes } };
    }

    if (
      query.startsWith('WITH requested(id) AS (VALUES')
      && query.includes('UPDATE ai_text_assets SET folder_id = NULL')
    ) {
      const requestedCount = (query.match(/\(\?\)/g) || []).length;
      const requestedIds = bindings.slice(0, requestedCount);
      const userId = bindings[requestedCount];
      const ownershipUserId = bindings[requestedCount + 1];
      const matches = this.state.aiTextAssets.filter((row) => requestedIds.includes(row.id) && row.user_id === ownershipUserId);
      if (matches.length !== requestedIds.length) {
        this._lastChanges = 0;
        return { success: true, meta: { changes: 0 } };
      }
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (requestedIds.includes(row.id) && row.user_id === userId) {
          row.folder_id = null;
          changes += 1;
        }
      }
      this._lastChanges = changes;
      return { success: true, meta: { changes } };
    }

    if (query.startsWith('SELECT CASE WHEN') && query.includes("json_extract('[]', '$[')") && query.includes('folder_id')) {
      let bindingIndex = 0;
      let passed = true;

      if (query.includes('FROM ai_images WHERE user_id = ?')) {
        const imageIdCount = countInlinePlaceholders(
          query,
          /FROM ai_images WHERE user_id = \?(?: AND folder_id = \?| AND folder_id IS NULL) AND id IN \(([^)]+)\)/
        );
        const userId = bindings[bindingIndex++];
        let folderId = null;
        const imageUsesFolderId = query.includes('FROM ai_images WHERE user_id = ? AND folder_id = ?');
        if (imageUsesFolderId) folderId = bindings[bindingIndex++];
        const imageIds = bindings.slice(bindingIndex, bindingIndex + imageIdCount);
        bindingIndex += imageIdCount;
        const expectedCount = bindings[bindingIndex++];
        const matches = this.state.aiImages.filter((row) => {
          if (row.user_id !== userId || !imageIds.includes(row.id)) return false;
          return imageUsesFolderId ? row.folder_id === folderId : row.folder_id == null;
        });
        passed = passed && matches.length === expectedCount;
      }

      if (query.includes('FROM ai_text_assets WHERE user_id = ?')) {
        const fileIdCount = countInlinePlaceholders(
          query,
          /FROM ai_text_assets WHERE user_id = \?(?: AND folder_id = \?| AND folder_id IS NULL) AND id IN \(([^)]+)\)/
        );
        const userId = bindings[bindingIndex++];
        let folderId = null;
        const fileUsesFolderId = query.includes('FROM ai_text_assets WHERE user_id = ? AND folder_id = ?');
        if (fileUsesFolderId) folderId = bindings[bindingIndex++];
        const fileIds = bindings.slice(bindingIndex, bindingIndex + fileIdCount);
        bindingIndex += fileIdCount;
        const expectedCount = bindings[bindingIndex++];
        const matches = this.state.aiTextAssets.filter((row) => {
          if (row.user_id !== userId || !fileIds.includes(row.id)) return false;
          return fileUsesFolderId ? row.folder_id === folderId : row.folder_id == null;
        });
        passed = passed && matches.length === expectedCount;
      }

      if (!passed) {
        throw new Error("bad JSON path: '$['");
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (query.startsWith('SELECT CASE WHEN') && query.includes("json_extract('[]', '$[')") && !query.includes('folder_id')) {
      let bindingIndex = 0;
      let passed = true;

      if (query.includes('FROM ai_images WHERE user_id = ?')) {
        const imageIdCount = countInlinePlaceholders(
          query,
          /FROM ai_images WHERE user_id = \? AND id IN \(([^)]+)\)/
        );
        const userId = bindings[bindingIndex++];
        const imageIds = bindings.slice(bindingIndex, bindingIndex + imageIdCount);
        bindingIndex += imageIdCount;
        const matches = this.state.aiImages.filter((row) => row.user_id === userId && imageIds.includes(row.id));
        passed = passed && matches.length === 0;
      }

      if (query.includes('FROM ai_text_assets WHERE user_id = ?')) {
        const fileIdCount = countInlinePlaceholders(
          query,
          /FROM ai_text_assets WHERE user_id = \? AND id IN \(([^)]+)\)/
        );
        const userId = bindings[bindingIndex++];
        const fileIds = bindings.slice(bindingIndex, bindingIndex + fileIdCount);
        bindingIndex += fileIdCount;
        const matches = this.state.aiTextAssets.filter((row) => row.user_id === userId && fileIds.includes(row.id));
        passed = passed && matches.length === 0;
      }

      if (!passed) {
        throw new Error("bad JSON path: '$['");
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (query.startsWith('WITH matches AS ( SELECT r2_key, thumb_key, medium_key FROM ai_images WHERE ') && query.includes('INSERT INTO r2_cleanup_queue (r2_key, status, created_at)')) {
      let rows = [];
      let createdAtStart = 0;
      if (query.includes('WHERE id = ? AND user_id = ?')) {
        const [imageId, userId, createdAt] = bindings;
        rows = this.state.aiImages.filter((row) => row.id === imageId && row.user_id === userId);
        createdAtStart = 2;
      } else if (query.includes('WHERE folder_id = ? AND user_id = ?')) {
        const [folderId, userId, createdAt] = bindings;
        rows = this.state.aiImages.filter((row) => row.folder_id === folderId && row.user_id === userId);
        createdAtStart = 2;
      } else if (query.includes('WHERE user_id = ?')) {
        const [userId, createdAt] = bindings;
        rows = this.state.aiImages.filter((row) => row.user_id === userId);
        createdAtStart = 1;
      }
      const createdAt = bindings[createdAtStart];
      const keys = rows.flatMap((row) => listAiImageKeys(row));
      for (const key of keys) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: keys.length } };
    }

    if (
      query.startsWith('WITH requested(id) AS (VALUES')
      && query.includes('SELECT r2_key, thumb_key, medium_key')
      && query.includes('INSERT INTO r2_cleanup_queue')
    ) {
      const requestedCount = (query.match(/\(\?\)/g) || []).length;
      const requestedIds = bindings.slice(0, requestedCount);
      const userId = bindings[requestedCount];
      const createdAt = bindings[requestedCount + 2];
      const rows = this.state.aiImages.filter((row) => requestedIds.includes(row.id) && row.user_id === userId);
      const keys = rows.flatMap((row) => listAiImageKeys(row));
      for (const key of keys) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: keys.length } };
    }

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) SELECT r2_key, 'pending', ? FROM ai_images WHERE id = ? AND user_id = ?")) {
      const [createdAt, imageId, userId] = bindings;
      const rows = this.state.aiImages.filter((row) => row.id === imageId && row.user_id === userId);
      for (const row of rows) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: row.r2_key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: rows.length } };
    }

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) SELECT r2_key, 'pending', ? FROM ai_images WHERE folder_id = ? AND user_id = ?")) {
      const [createdAt, folderId, userId] = bindings;
      const rows = this.state.aiImages.filter((row) => row.folder_id === folderId && row.user_id === userId);
      for (const row of rows) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: row.r2_key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: rows.length } };
    }

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) SELECT r2_key, 'pending', ? FROM ai_images WHERE user_id = ?")) {
      const [createdAt, userId] = bindings;
      const rows = this.state.aiImages.filter((row) => row.user_id === userId);
      for (const row of rows) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: row.r2_key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: rows.length } };
    }

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) SELECT r2_key, 'pending', ? FROM ai_text_assets WHERE id = ? AND user_id = ?")) {
      const [createdAt, assetId, userId] = bindings;
      const rows = this.state.aiTextAssets.filter((row) => row.id === assetId && row.user_id === userId);
      for (const row of rows) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: row.r2_key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: rows.length } };
    }

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) SELECT r2_key, 'pending', ? FROM ai_text_assets WHERE folder_id = ? AND user_id = ?")) {
      const [createdAt, folderId, userId] = bindings;
      const rows = this.state.aiTextAssets.filter((row) => row.folder_id === folderId && row.user_id === userId);
      for (const row of rows) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: row.r2_key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: rows.length } };
    }

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) SELECT r2_key, 'pending', ? FROM ai_text_assets WHERE user_id = ?")) {
      const [createdAt, userId] = bindings;
      const rows = this.state.aiTextAssets.filter((row) => row.user_id === userId);
      for (const row of rows) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: row.r2_key,
          status: 'pending',
          created_at: createdAt,
          attempts: 0,
          last_attempt_at: null,
        });
      }
      return { success: true, meta: { changes: rows.length } };
    }

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) VALUES ")) {
      let changes = 0;
      for (let index = 0; index < bindings.length; index += 2) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: bindings[index],
          status: 'pending',
          created_at: bindings[index + 1],
          attempts: 0,
          last_attempt_at: null,
        });
        changes += 1;
      }
      this._lastChanges = changes;
      return { success: true, meta: { changes } };
    }

    if (query === "SELECT id, r2_key FROM r2_cleanup_queue WHERE status = 'pending' AND attempts < 5 ORDER BY created_at ASC LIMIT 50") {
      const rows = this.state.r2CleanupQueue
        .filter((row) => row.status === 'pending' && row.attempts < 5)
        .slice()
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .slice(0, 50)
        .map((row) => ({ id: row.id, r2_key: row.r2_key }));
      return { results: rows };
    }

    if (query === "SELECT id, r2_key, attempts FROM r2_cleanup_queue WHERE status = 'pending' AND attempts >= 5 AND last_attempt_at IS NOT NULL") {
      const rows = this.state.r2CleanupQueue
        .filter((row) => row.status === 'pending' && row.attempts >= 5 && row.last_attempt_at != null)
        .map((row) => ({ id: row.id, r2_key: row.r2_key, attempts: row.attempts }));
      return { results: rows };
    }

    if (query.startsWith('DELETE FROM r2_cleanup_queue WHERE id IN (')) {
      const ids = new Set(bindings);
      const before = this.state.r2CleanupQueue.length;
      this.state.r2CleanupQueue = this.state.r2CleanupQueue.filter((row) => !ids.has(row.id));
      return { success: true, meta: { changes: before - this.state.r2CleanupQueue.length } };
    }

    if (query.startsWith('UPDATE r2_cleanup_queue SET attempts = attempts + 1, last_attempt_at = ? WHERE id IN (')) {
      const [attemptedAt, ...ids] = bindings;
      let changes = 0;
      for (const row of this.state.r2CleanupQueue) {
        if (ids.includes(row.id)) {
          row.attempts += 1;
          row.last_attempt_at = attemptedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query.startsWith("UPDATE r2_cleanup_queue SET status = 'dead', last_attempt_at = ? WHERE id IN (")) {
      const [attemptedAt, ...ids] = bindings;
      let changes = 0;
      for (const row of this.state.r2CleanupQueue) {
        if (ids.includes(row.id)) {
          row.status = 'dead';
          row.last_attempt_at = attemptedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (
      query.startsWith('WITH requested(id) AS (VALUES')
      && query.includes('DELETE FROM ai_images')
      && query.includes('SELECT COUNT(*) FROM ai_images WHERE user_id = ?')
    ) {
      const requestedCount = (query.match(/\(\?\)/g) || []).length;
      const requestedIds = bindings.slice(0, requestedCount);
      const userId = bindings[requestedCount];
      const ownershipUserId = bindings[requestedCount + 1];
      const matches = this.state.aiImages.filter((row) => requestedIds.includes(row.id) && row.user_id === ownershipUserId);
      if (matches.length !== requestedIds.length) {
        this._lastChanges = 0;
        return { success: true, meta: { changes: 0 } };
      }
      const before = this.state.aiImages.length;
      this.state.aiImages = this.state.aiImages.filter((row) => !(requestedIds.includes(row.id) && row.user_id === userId));
      const changes = before - this.state.aiImages.length;
      this._lastChanges = changes;
      return { success: true, meta: { changes } };
    }

    if (
      query.startsWith('WITH requested(id) AS (VALUES')
      && query.includes('DELETE FROM ai_text_assets')
      && query.includes('SELECT COUNT(*) FROM ai_text_assets WHERE user_id = ?')
    ) {
      const requestedCount = (query.match(/\(\?\)/g) || []).length;
      const requestedIds = bindings.slice(0, requestedCount);
      const userId = bindings[requestedCount];
      const ownershipUserId = bindings[requestedCount + 1];
      const matches = this.state.aiTextAssets.filter((row) => requestedIds.includes(row.id) && row.user_id === ownershipUserId);
      if (matches.length !== requestedIds.length) {
        this._lastChanges = 0;
        return { success: true, meta: { changes: 0 } };
      }
      const before = this.state.aiTextAssets.length;
      this.state.aiTextAssets = this.state.aiTextAssets.filter((row) => !(requestedIds.includes(row.id) && row.user_id === userId));
      const changes = before - this.state.aiTextAssets.length;
      this._lastChanges = changes;
      return { success: true, meta: { changes } };
    }

    if (query.startsWith('DELETE FROM r2_cleanup_queue WHERE r2_key IN (') && query.endsWith(") AND status = 'pending'")) {
      const keys = new Set(bindings);
      const before = this.state.r2CleanupQueue.length;
      this.state.r2CleanupQueue = this.state.r2CleanupQueue.filter(
        (row) => !(row.status === 'pending' && keys.has(row.r2_key))
      );
      return { success: true, meta: { changes: before - this.state.r2CleanupQueue.length } };
    }

    if (query === 'SELECT COUNT(*) AS cnt FROM ai_generation_log WHERE user_id = ? AND created_at >= ?') {
      const [userId, dayStart] = bindings;
      const cnt = this.state.aiGenerationLog.filter((row) => row.user_id === userId && row.created_at >= dayStart).length;
      return { cnt };
    }

    if (query === "DELETE FROM ai_daily_quota_usage WHERE user_id = ? AND day_start = ? AND status = 'reserved' AND expires_at < ?") {
      const [userId, dayStart, now] = bindings;
      const before = this.state.aiDailyQuotaUsage.length;
      this.state.aiDailyQuotaUsage = this.state.aiDailyQuotaUsage.filter(
        (row) => !(row.user_id === userId && row.day_start === dayStart && row.status === 'reserved' && row.expires_at < now)
      );
      return { success: true, meta: { changes: before - this.state.aiDailyQuotaUsage.length } };
    }

    if (query === "DELETE FROM ai_daily_quota_usage WHERE day_start < ? OR (status = 'reserved' AND expires_at < ?)") {
      const [dayStart, now] = bindings;
      const before = this.state.aiDailyQuotaUsage.length;
      this.state.aiDailyQuotaUsage = this.state.aiDailyQuotaUsage.filter(
        (row) => !(row.day_start < dayStart || (row.status === 'reserved' && row.expires_at < now))
      );
      return { success: true, meta: { changes: before - this.state.aiDailyQuotaUsage.length } };
    }

    if (query.startsWith('SELECT COUNT(*) AS cnt FROM ai_daily_quota_usage WHERE user_id = ?')) {
      const [userId, dayStart, now] = bindings;
      const cnt = this.state.aiDailyQuotaUsage.filter(
        (row) =>
          row.user_id === userId &&
          row.day_start === dayStart &&
          (row.status === 'consumed' || (row.status === 'reserved' && row.expires_at >= now))
      ).length;
      return { cnt };
    }

    if (query === "INSERT OR IGNORE INTO ai_daily_quota_usage (id, user_id, day_start, slot, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'reserved', ?, ?)") {
      const [id, userId, dayStart, slot, createdAt, expiresAt] = bindings;
      const existing = this.state.aiDailyQuotaUsage.find(
        (row) => row.user_id === userId && row.day_start === dayStart && row.slot === slot
      );
      if (existing) {
        return { success: true, meta: { changes: 0 } };
      }
      this.state.aiDailyQuotaUsage.push({
        id,
        user_id: userId,
        day_start: dayStart,
        slot,
        status: 'reserved',
        created_at: createdAt,
        expires_at: expiresAt,
        consumed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "DELETE FROM ai_daily_quota_usage WHERE id = ? AND status = 'reserved'") {
      const [reservationId] = bindings;
      const before = this.state.aiDailyQuotaUsage.length;
      this.state.aiDailyQuotaUsage = this.state.aiDailyQuotaUsage.filter(
        (row) => !(row.id === reservationId && row.status === 'reserved')
      );
      return { success: true, meta: { changes: before - this.state.aiDailyQuotaUsage.length } };
    }

    if (query === "UPDATE ai_daily_quota_usage SET status = 'consumed', expires_at = NULL, consumed_at = ? WHERE id = ? AND status = 'reserved'") {
      const [consumedAt, reservationId] = bindings;
      let changes = 0;
      for (const row of this.state.aiDailyQuotaUsage) {
        if (row.id === reservationId && row.status === 'reserved') {
          row.status = 'consumed';
          row.expires_at = null;
          row.consumed_at = consumedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    throw new Error(`Unsupported query in test harness: ${query}`);
  }
}

function createAuthTestEnv(seed = {}) {
  const aiRun = typeof seed.aiRun === 'function' ? seed.aiRun : async () => null;
  const DB = new MockD1(seed);
  const PRIVATE_MEDIA = new MockBucket(seed.privateMedia);
  const USER_IMAGES = new MockBucket(seed.userImages);
  const AI_IMAGE_DERIVATIVES_QUEUE = seed.aiImageDerivativesQueue || new MockQueueProducer();
  const IMAGES = seed.IMAGES || new MockImagesBinding(seed.imagesBinding);
  return {
    APP_BASE_URL: 'https://bitbi.ai',
    RESEND_FROM_EMAIL: 'BITBI <noreply@contact.bitbi.ai>',
    SESSION_SECRET: 'test-session-secret',
    PBKDF2_ITERATIONS: '100000',
    DB,
    PRIVATE_MEDIA,
    USER_IMAGES,
    AI_IMAGE_DERIVATIVES_QUEUE,
    IMAGES,
    AI: {
      async run(...args) {
        return aiRun(...args);
      },
    },
  };
}

function createExecutionContext() {
  const pending = [];
  return {
    execCtx: {
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
    },
    async flush() {
      await Promise.all(pending.splice(0));
    },
  };
}

async function seedSession(env, userId) {
  const token = `session-${userId}`;
  const tokenHash = await sha256Hex(`${token}:${env.SESSION_SECRET}`);
  env.DB.state.sessions.push({
    id: `sess-${userId}`,
    user_id: userId,
    token_hash: tokenHash,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    last_seen_at: nowIso(),
  });
  return token;
}

async function loadWorker(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  const mod = await import(pathToFileURL(filePath).href);
  return mod.default || mod;
}

module.exports = {
  MockBucket,
  MockD1,
  MockImagesBinding,
  MockQueueProducer,
  createAuthTestEnv,
  createExecutionContext,
  deepClone,
  loadWorker,
  nowIso,
  seedSession,
  sha256Hex,
};
