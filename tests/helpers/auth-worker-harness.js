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
    visibility: 'private',
    published_at: null,
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
    this.failPutKeys = new Set();
    this.failPutWith = null;
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
      if (value.failPut) this.failPutKeys.add(key);
      if (value.failPutWith && !this.failPutWith) this.failPutWith = value.failPutWith;
    }
  }

  async put(key, body, options = {}) {
    this.putCalls.push({ key, options });
    if (this.failPutWith) {
      throw this.failPutWith instanceof Error ? this.failPutWith : new Error(String(this.failPutWith));
    }
    if (this.failPutKeys.has(key)) {
      throw new Error(`Mock put failure for ${key}`);
    }
    this.objects.set(key, {
      body,
      httpMetadata: options.httpMetadata || {},
      size: body?.byteLength ?? (typeof body === 'string' ? body.length : 0),
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

class MockDurableRateLimiterNamespace {
  constructor(seed = {}) {
    this.fetchCalls = [];
    this.failWith = seed.failWith || null;
    this.instances = new Map();
    for (const counter of seed.counters || []) {
      const instance = this._getInstance(`${counter.scope}:${counter.limiter_key}`);
      instance.windowStartMs = Number(counter.window_start_ms) || null;
      instance.count = Number(counter.count) || 0;
      instance.expiresAtMs = Date.parse(counter.expires_at || '') || null;
    }
  }

  idFromName(name) {
    return String(name);
  }

  get(id) {
    const instanceId = String(id);
    const instance = this._getInstance(instanceId);
    return {
      fetch: async (url, init = {}) => {
        if (this.failWith) {
          throw this.failWith instanceof Error ? this.failWith : new Error(String(this.failWith));
        }

        this.fetchCalls.push({
          id: instanceId,
          url: String(url),
          method: init?.method || 'GET',
          body: init?.body || null,
        });

        const request = new Request(String(url), init);
        const pathname = new URL(request.url).pathname;
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ ok: false, error: 'Method not allowed.' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json', Allow: 'POST' },
          });
        }

        let body = null;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (pathname.endsWith('/nonce')) {
          const ttlMs = Number(body?.ttlMs);
          if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
            return new Response(JSON.stringify({ ok: false, error: 'Invalid nonce replay request.' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          const nowMs = Date.now();
          if (Number.isInteger(instance.expiresAtMs) && instance.expiresAtMs > nowMs) {
            return new Response(JSON.stringify({
              ok: true,
              replayed: true,
              expires_at_ms: instance.expiresAtMs,
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          instance.expiresAtMs = nowMs + ttlMs;
          instance.nonceUsed = true;
          return new Response(JSON.stringify({
            ok: true,
            replayed: false,
            expires_at_ms: instance.expiresAtMs,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const maxRequests = Number(body?.maxRequests);
        const windowMs = Number(body?.windowMs);
        if (!Number.isInteger(maxRequests) || maxRequests <= 0 || !Number.isInteger(windowMs) || windowMs <= 0) {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid rate limit request.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const nowMs = Date.now();
        const windowStartMs = nowMs - (nowMs % windowMs);
        const expiresAtMs = windowStartMs + windowMs;

        if (instance.windowStartMs === windowStartMs && instance.expiresAtMs === expiresAtMs) {
          instance.count += 1;
        } else {
          instance.windowStartMs = windowStartMs;
          instance.expiresAtMs = expiresAtMs;
          instance.count = 1;
        }

        return new Response(JSON.stringify({
          ok: true,
          limited: instance.count > maxRequests,
          count: instance.count,
          window_start_ms: instance.windowStartMs,
          expires_at_ms: instance.expiresAtMs,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    };
  }

  _getInstance(id) {
    if (!this.instances.has(id)) {
      this.instances.set(id, {
        windowStartMs: null,
        count: 0,
        expiresAtMs: null,
        nonceUsed: false,
      });
    }
    return this.instances.get(id);
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
    this.missingTables = new Set(Array.isArray(seed.missingTables) ? seed.missingTables : []);
    this.runCalls = [];
    this.state = {
      users: [],
      sessions: [],
      emailVerificationTokens: [],
      passwordResetTokens: [],
      adminMfaCredentials: [],
      adminMfaRecoveryCodes: [],
      adminMfaFailedAttempts: [],
      linkedWallets: [],
      siweChallenges: [],
      profiles: [],
      favorites: [],
      adminAuditLog: [],
      rateLimitCounters: [],
      aiFolders: [],
      aiImages: [],
      aiTextAssets: [],
      aiVideoJobs: [],
      aiGenerationLog: [],
      aiDailyQuotaUsage: [],
      userActivityLog: [],
      r2CleanupQueue: [],
      ...deepClone(seed),
    };
    this.state.profiles = (this.state.profiles || []).map((row) => ({
      has_avatar: row.has_avatar ?? null,
      avatar_updated_at: row.avatar_updated_at ?? null,
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

    if (mode === 'run') {
      this.runCalls.push({
        query,
        bindings: deepClone(bindings),
      });
    }

    if (this.missingTables.has('rate_limit_counters') && query.includes('rate_limit_counters')) {
      throw new Error('no such table: rate_limit_counters');
    }
    if (this.missingTables.has('admin_mfa_credentials') && query.includes('admin_mfa_credentials')) {
      throw new Error('no such table: admin_mfa_credentials');
    }
    if (this.missingTables.has('admin_mfa_recovery_codes') && query.includes('admin_mfa_recovery_codes')) {
      throw new Error('no such table: admin_mfa_recovery_codes');
    }
    if (this.missingTables.has('admin_mfa_failed_attempts') && query.includes('admin_mfa_failed_attempts')) {
      throw new Error('no such table: admin_mfa_failed_attempts');
    }
    if (this.missingTables.has('ai_video_jobs') && query.includes('ai_video_jobs')) {
      throw new Error('no such table: ai_video_jobs');
    }
    if (this.missingTables.has('admin_audit_log') && query.includes('admin_audit_log')) {
      throw new Error('no such table: admin_audit_log');
    }
    if (this.missingTables.has('user_activity_log') && query.includes('user_activity_log')) {
      throw new Error('no such table: user_activity_log');
    }

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

    if (query === 'UPDATE sessions SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)') {
      const [lastSeenAt, sessionId, staleBefore] = bindings;
      const row = this.state.sessions.find((item) => item.id === sessionId);
      if (!row) return { success: true, meta: { changes: 0 } };
      if (!row.last_seen_at || row.last_seen_at < staleBefore) {
        row.last_seen_at = lastSeenAt;
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }

    if (query.startsWith('SELECT id, email, password_hash, created_at, status, role, email_verified_at FROM users WHERE email = ?')) {
      const [email] = bindings;
      return this.state.users.find((row) => row.email === email) || null;
    }

    if (query === 'SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1') {
      const [userId] = bindings;
      return this.state.users.find((row) => row.id === userId) || null;
    }

    if (query === 'UPDATE users SET role = ?, updated_at = ? WHERE id = ?') {
      const [role, updatedAt, userId] = bindings;
      const row = this.state.users.find((item) => item.id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.role = role;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE users SET status = ?, updated_at = ? WHERE id = ?') {
      const [status, updatedAt, userId] = bindings;
      const row = this.state.users.find((item) => item.id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = status;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
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

    if (
      query.startsWith('INSERT INTO user_activity_log (id, user_id, action, meta_json, ip_address, created_at) VALUES')
      || query.startsWith('INSERT OR IGNORE INTO user_activity_log (id, user_id, action, meta_json, ip_address, created_at) VALUES')
    ) {
      const [id, userId, action, metaJson, ipAddress, createdAt] = bindings;
      const existing = this.state.userActivityLog.find((row) => row.id === id);
      if (existing) {
        return { success: true, meta: { changes: query.startsWith('INSERT OR IGNORE') ? 0 : 0 } };
      }
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

    if (query === 'SELECT id, user_id, action, meta_json, ip_address, created_at FROM user_activity_log WHERE created_at < ? ORDER BY created_at ASC, id ASC LIMIT ?') {
      const [cutoffIso, limit] = bindings;
      const rows = this.state.userActivityLog
        .filter((row) => row.created_at < cutoffIso)
        .sort((a, b) => {
          if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
          return a.id.localeCompare(b.id);
        })
        .slice(0, Number(limit) || 0);
      return { results: rows.map((row) => ({ ...row })) };
    }

    if (query.startsWith('DELETE FROM user_activity_log WHERE id IN (')) {
      const idSet = new Set(bindings);
      const before = this.state.userActivityLog.length;
      this.state.userActivityLog = this.state.userActivityLog.filter((row) => !idSet.has(row.id));
      return { success: true, meta: { changes: before - this.state.userActivityLog.length } };
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

    if (query === 'SELECT 1 FROM rate_limit_counters LIMIT 1') {
      return mode === 'all' ? { results: [{ 1: 1 }] } : { 1: 1 };
    }

    if (query === 'SELECT 1 FROM admin_mfa_credentials LIMIT 1') {
      return mode === 'all' ? { results: [{ 1: 1 }] } : { 1: 1 };
    }

    if (query === 'SELECT 1 FROM admin_mfa_recovery_codes LIMIT 1') {
      return mode === 'all' ? { results: [{ 1: 1 }] } : { 1: 1 };
    }

    if (query === 'SELECT 1 FROM admin_mfa_failed_attempts LIMIT 1') {
      return mode === 'all' ? { results: [{ 1: 1 }] } : { 1: 1 };
    }

    if (query === 'SELECT admin_user_id, secret_ciphertext, secret_iv, pending_secret_ciphertext, pending_secret_iv, enabled_at, last_accepted_timestep, created_at, updated_at FROM admin_mfa_credentials WHERE admin_user_id = ? LIMIT 1') {
      const [adminUserId] = bindings;
      return this.state.adminMfaCredentials.find((row) => row.admin_user_id === adminUserId) || null;
    }

    if (query === 'SELECT COUNT(*) AS unused_count FROM admin_mfa_recovery_codes WHERE admin_user_id = ? AND used_at IS NULL') {
      const [adminUserId] = bindings;
      return {
        unused_count: this.state.adminMfaRecoveryCodes.filter(
          (row) => row.admin_user_id === adminUserId && row.used_at == null
        ).length,
      };
    }

    if (query === 'INSERT INTO admin_mfa_credentials ( admin_user_id, secret_ciphertext, secret_iv, pending_secret_ciphertext, pending_secret_iv, enabled_at, last_accepted_timestep, created_at, updated_at ) VALUES (?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)') {
      const [adminUserId, pendingCiphertext, pendingIv, createdAt, updatedAt] = bindings;
      this.state.adminMfaCredentials.push({
        admin_user_id: adminUserId,
        secret_ciphertext: null,
        secret_iv: null,
        pending_secret_ciphertext: pendingCiphertext,
        pending_secret_iv: pendingIv,
        enabled_at: null,
        last_accepted_timestep: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE admin_mfa_credentials SET pending_secret_ciphertext = ?, pending_secret_iv = ?, updated_at = ? WHERE admin_user_id = ?') {
      const [pendingCiphertext, pendingIv, updatedAt, adminUserId] = bindings;
      const row = this.state.adminMfaCredentials.find((item) => item.admin_user_id === adminUserId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.pending_secret_ciphertext = pendingCiphertext;
      row.pending_secret_iv = pendingIv;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM admin_mfa_recovery_codes WHERE admin_user_id = ?') {
      const [adminUserId] = bindings;
      const before = this.state.adminMfaRecoveryCodes.length;
      this.state.adminMfaRecoveryCodes = this.state.adminMfaRecoveryCodes.filter(
        (row) => row.admin_user_id !== adminUserId
      );
      return { success: true, meta: { changes: before - this.state.adminMfaRecoveryCodes.length } };
    }

    if (query === 'INSERT INTO admin_mfa_recovery_codes (id, admin_user_id, code_hash, created_at, used_at) VALUES (?, ?, ?, ?, NULL)') {
      const [id, adminUserId, codeHash, createdAt] = bindings;
      this.state.adminMfaRecoveryCodes.push({
        id,
        admin_user_id: adminUserId,
        code_hash: codeHash,
        created_at: createdAt,
        used_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE admin_mfa_credentials SET secret_ciphertext = pending_secret_ciphertext, secret_iv = pending_secret_iv, pending_secret_ciphertext = NULL, pending_secret_iv = NULL, enabled_at = ?, last_accepted_timestep = ?, updated_at = ? WHERE admin_user_id = ?') {
      const [enabledAt, timestep, updatedAt, adminUserId] = bindings;
      const row = this.state.adminMfaCredentials.find((item) => item.admin_user_id === adminUserId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.secret_ciphertext = row.pending_secret_ciphertext;
      row.secret_iv = row.pending_secret_iv;
      row.pending_secret_ciphertext = null;
      row.pending_secret_iv = null;
      row.enabled_at = enabledAt;
      row.last_accepted_timestep = timestep;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE admin_mfa_credentials SET last_accepted_timestep = ?, updated_at = ? WHERE admin_user_id = ?') {
      const [timestep, updatedAt, adminUserId] = bindings;
      const row = this.state.adminMfaCredentials.find((item) => item.admin_user_id === adminUserId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.last_accepted_timestep = timestep;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT id, code_hash, used_at FROM admin_mfa_recovery_codes WHERE admin_user_id = ?') {
      const [adminUserId] = bindings;
      return {
        results: this.state.adminMfaRecoveryCodes
          .filter((row) => row.admin_user_id === adminUserId)
          .map((row) => ({
            id: row.id,
            code_hash: row.code_hash,
            used_at: row.used_at ?? null,
          })),
      };
    }

    if (query === 'UPDATE admin_mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL') {
      const [usedAt, id] = bindings;
      const row = this.state.adminMfaRecoveryCodes.find((item) => item.id === id && item.used_at == null);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.used_at = usedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM admin_mfa_credentials WHERE admin_user_id = ?') {
      const [adminUserId] = bindings;
      const before = this.state.adminMfaCredentials.length;
      this.state.adminMfaCredentials = this.state.adminMfaCredentials.filter(
        (row) => row.admin_user_id !== adminUserId
      );
      return { success: true, meta: { changes: before - this.state.adminMfaCredentials.length } };
    }

    if (query === 'SELECT admin_user_id, failed_count, first_failed_at, last_failed_at, locked_until, updated_at FROM admin_mfa_failed_attempts WHERE admin_user_id = ? LIMIT 1') {
      const [adminUserId] = bindings;
      return this.state.adminMfaFailedAttempts.find((row) => row.admin_user_id === adminUserId) || null;
    }

    if (query.startsWith('INSERT INTO admin_mfa_failed_attempts ( admin_user_id, failed_count, first_failed_at, last_failed_at, locked_until, updated_at ) VALUES')) {
      const [adminUserId, failedCount, firstFailedAt, lastFailedAt, lockedUntil, updatedAt] = bindings;
      let row = this.state.adminMfaFailedAttempts.find((item) => item.admin_user_id === adminUserId);
      if (!row) {
        row = {
          admin_user_id: adminUserId,
          failed_count: failedCount,
          first_failed_at: firstFailedAt,
          last_failed_at: lastFailedAt,
          locked_until: lockedUntil,
          updated_at: updatedAt,
        };
        this.state.adminMfaFailedAttempts.push(row);
      } else {
        row.failed_count = failedCount;
        row.first_failed_at = firstFailedAt;
        row.last_failed_at = lastFailedAt;
        row.locked_until = lockedUntil;
        row.updated_at = updatedAt;
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM admin_mfa_failed_attempts WHERE admin_user_id = ?') {
      const [adminUserId] = bindings;
      const before = this.state.adminMfaFailedAttempts.length;
      this.state.adminMfaFailedAttempts = this.state.adminMfaFailedAttempts.filter(
        (row) => row.admin_user_id !== adminUserId
      );
      return { success: true, meta: { changes: before - this.state.adminMfaFailedAttempts.length } };
    }

    if (query === 'DELETE FROM siwe_challenges WHERE used_at IS NOT NULL OR expires_at < ?') {
      const [now] = bindings;
      const before = this.state.siweChallenges.length;
      this.state.siweChallenges = this.state.siweChallenges.filter(
        (row) => row.used_at == null && row.expires_at >= now
      );
      return { success: true, meta: { changes: before - this.state.siweChallenges.length } };
    }

    if (query === 'SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1') {
      const [userId] = bindings;
      return this.state.users.find((row) => row.id === userId) || null;
    }

    if (
      query.startsWith('SELECT id, email, role, status, created_at, updated_at, email_verified_at, verification_method FROM users')
      && query.includes('ORDER BY created_at DESC, id DESC LIMIT ?')
    ) {
      let index = 0;
      let search = null;
      let cursor = null;
      if (query.includes('WHERE email LIKE ?')) {
        search = String(bindings[index++] || '').replace(/^%|%$/g, '');
      }
      if (query.includes('(created_at < ? OR (created_at = ? AND id < ?))')) {
        const createdAt = bindings[index++];
        index += 1;
        cursor = {
          created_at: createdAt,
          id: bindings[index++],
        };
      }
      const limit = bindings[index];
      let rows = this.state.users.slice();
      if (search) {
        rows = rows.filter((row) => String(row.email || '').includes(search));
      }
      if (cursor) {
        rows = rows.filter((row) => (
          String(row.created_at || '') < cursor.created_at
          || (
            String(row.created_at || '') === cursor.created_at
            && String(row.id || '') < String(cursor.id || '')
          )
        ));
      }
      return {
        results: rows
          .sort((a, b) => (
            String(b.created_at || '').localeCompare(String(a.created_at || ''))
            || String(b.id || '').localeCompare(String(a.id || ''))
          ))
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            email: row.email,
            role: row.role,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at ?? null,
            email_verified_at: row.email_verified_at ?? null,
            verification_method: row.verification_method ?? null,
        })),
      };
    }

    if (
      query === 'SELECT u.id, u.email, p.display_name, p.avatar_updated_at FROM profiles p INNER JOIN users u ON u.id = p.user_id WHERE COALESCE(p.has_avatar, 0) = 1 AND p.avatar_updated_at IS NOT NULL ORDER BY p.avatar_updated_at DESC, p.user_id DESC LIMIT 4'
    ) {
      const results = (this.state.profiles || [])
        .filter((row) => Number(row.has_avatar || 0) === 1 && row.avatar_updated_at)
        .slice()
        .sort((a, b) => (
          String(b.avatar_updated_at || '').localeCompare(String(a.avatar_updated_at || ''))
          || String(b.user_id || '').localeCompare(String(a.user_id || ''))
        ))
        .slice(0, 4)
        .map((profile) => {
          const user = this.state.users.find((row) => row.id === profile.user_id);
          return {
            id: profile.user_id,
            email: user?.email ?? null,
            display_name: profile.display_name ?? null,
            avatar_updated_at: profile.avatar_updated_at,
          };
        });
      return { results };
    }

    if (query.startsWith('SELECT COUNT(*) AS totalUsers, COALESCE(SUM(CASE WHEN role = \'admin\' THEN 1 ELSE 0 END), 0) AS admins,')) {
      const users = this.state.users || [];
      const nowMs = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      let admins = 0;
      let activeUsers = 0;
      let disabledUsers = 0;
      let verifiedUsers = 0;
      let recentRegistrations = 0;
      for (const row of users) {
        if (row.role === 'admin') admins += 1;
        if (row.status === 'active') activeUsers += 1;
        if (row.status === 'disabled') disabledUsers += 1;
        if (row.email_verified_at && row.verification_method !== 'legacy_auto') verifiedUsers += 1;
        const createdMs = Date.parse(String(row.created_at || ''));
        if (Number.isFinite(createdMs) && (nowMs - createdMs) <= sevenDaysMs) {
          recentRegistrations += 1;
        }
      }
      return {
        totalUsers: users.length,
        admins,
        activeUsers,
        disabledUsers,
        verifiedUsers,
        recentRegistrations,
      };
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

    if (query.startsWith('INSERT INTO siwe_challenges (id, nonce, intent, user_id, address_normalized, domain, uri, chain_id, statement, issued_at, expires_at, used_at, requested_ip, created_at) VALUES')) {
      const [id, nonce, intent, userId, domain, uri, chainId, statement, issuedAt, expiresAt, requestedIp, createdAt] = bindings;
      this.state.siweChallenges.push({
        id,
        nonce,
        intent,
        user_id: userId,
        address_normalized: null,
        domain,
        uri,
        chain_id: chainId,
        statement,
        issued_at: issuedAt,
        expires_at: expiresAt,
        used_at: null,
        requested_ip: requestedIp,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT id, nonce, intent, user_id, address_normalized, domain, uri, chain_id, statement, issued_at, expires_at, used_at, requested_ip, created_at FROM siwe_challenges WHERE nonce = ? LIMIT 1') {
      const [nonce] = bindings;
      return this.state.siweChallenges.find((row) => row.nonce === nonce) || null;
    }

    if (query === 'UPDATE siwe_challenges SET used_at = ?, address_normalized = ? WHERE id = ? AND used_at IS NULL') {
      const [usedAt, addressNormalized, challengeId] = bindings;
      const row = this.state.siweChallenges.find((item) => item.id === challengeId && item.used_at == null);
      if (!row) {
        return { success: true, meta: { changes: 0 } };
      }
      row.used_at = usedAt;
      row.address_normalized = addressNormalized;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT id, user_id, address_normalized, address_display, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at FROM linked_wallets WHERE user_id = ? LIMIT 1') {
      const [userId] = bindings;
      return this.state.linkedWallets.find((row) => row.user_id === userId) || null;
    }

    if (query === 'SELECT id, user_id, address_normalized, address_display, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at FROM linked_wallets WHERE address_normalized = ? LIMIT 1') {
      const [addressNormalized] = bindings;
      return this.state.linkedWallets.find((row) => row.address_normalized === addressNormalized) || null;
    }

    if (query.startsWith('INSERT INTO linked_wallets (id, user_id, address_normalized, address_display, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at) VALUES')) {
      const [id, userId, addressNormalized, addressDisplay, chainId, linkedAt, createdAt, updatedAt] = bindings;
      this.state.linkedWallets.push({
        id,
        user_id: userId,
        address_normalized: addressNormalized,
        address_display: addressDisplay,
        chain_id: chainId,
        is_primary: 1,
        linked_at: linkedAt,
        last_login_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE linked_wallets SET address_display = ?, chain_id = ?, is_primary = 1, updated_at = ? WHERE id = ?') {
      const [addressDisplay, chainId, updatedAt, id] = bindings;
      const row = this.state.linkedWallets.find((item) => item.id === id);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.address_display = addressDisplay;
      row.chain_id = chainId;
      row.is_primary = 1;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT lw.id AS link_id, lw.user_id AS user_id, lw.address_normalized AS address_normalized, lw.address_display AS address_display, lw.chain_id AS chain_id, lw.is_primary AS is_primary, lw.linked_at AS linked_at, lw.last_login_at AS last_login_at, u.email AS email, u.created_at AS created_at, u.status AS status, u.role AS role, u.verification_method AS verification_method FROM linked_wallets lw INNER JOIN users u ON u.id = lw.user_id WHERE lw.address_normalized = ? LIMIT 1')) {
      const [addressNormalized] = bindings;
      const linkedWallet = this.state.linkedWallets.find((row) => row.address_normalized === addressNormalized);
      if (!linkedWallet) return null;
      const user = this.state.users.find((row) => row.id === linkedWallet.user_id);
      if (!user) return null;
      return {
        link_id: linkedWallet.id,
        user_id: linkedWallet.user_id,
        address_normalized: linkedWallet.address_normalized,
        address_display: linkedWallet.address_display,
        chain_id: linkedWallet.chain_id,
        is_primary: linkedWallet.is_primary,
        linked_at: linkedWallet.linked_at,
        last_login_at: linkedWallet.last_login_at,
        email: user.email,
        created_at: user.created_at,
        status: user.status,
        role: user.role,
        verification_method: user.verification_method ?? null,
      };
    }

    if (query === 'UPDATE linked_wallets SET last_login_at = ?, updated_at = ? WHERE id = ?') {
      const [lastLoginAt, updatedAt, id] = bindings;
      const row = this.state.linkedWallets.find((item) => item.id === id);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.last_login_at = lastLoginAt;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM linked_wallets WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.linkedWallets.length;
      this.state.linkedWallets = this.state.linkedWallets.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.linkedWallets.length } };
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
          avatar_updated_at: null,
          created_at: createdAt,
          updated_at: updatedAt,
        });
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO profiles (user_id, display_name, bio, website, youtube_url, has_avatar, avatar_updated_at, created_at, updated_at) VALUES')) {
      const [userId, hasAvatar, avatarUpdatedAt, createdAt, updatedAt] = bindings;
      const existing = this.state.profiles.find((row) => row.user_id === userId);
      if (existing) {
        existing.has_avatar = hasAvatar;
        existing.avatar_updated_at = hasAvatar ? (avatarUpdatedAt ?? existing.avatar_updated_at ?? null) : null;
        existing.updated_at = updatedAt;
      } else {
        this.state.profiles.push({
          user_id: userId,
          display_name: '',
          bio: '',
          website: '',
          youtube_url: '',
          has_avatar: hasAvatar,
          avatar_updated_at: hasAvatar ? (avatarUpdatedAt ?? null) : null,
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
      this.state.linkedWallets = this.state.linkedWallets.filter((row) => row.user_id !== userId);
      this.state.siweChallenges = this.state.siweChallenges.filter((row) => row.user_id !== userId);
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

    if (
      query.startsWith('INSERT INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at) VALUES')
      || query.startsWith('INSERT OR IGNORE INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at) VALUES')
    ) {
      const [id, adminUserId, action, targetUserId, metaJson, createdAt] = bindings;
      const existing = this.state.adminAuditLog.find((row) => row.id === id);
      if (existing) {
        return { success: true, meta: { changes: query.startsWith('INSERT OR IGNORE') ? 0 : 0 } };
      }
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

    if (query === 'SELECT id, admin_user_id, action, target_user_id, meta_json, created_at FROM admin_audit_log WHERE created_at < ? ORDER BY created_at ASC, id ASC LIMIT ?') {
      const [cutoffIso, limit] = bindings;
      const rows = this.state.adminAuditLog
        .filter((row) => row.created_at < cutoffIso)
        .sort((a, b) => {
          if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
          return a.id.localeCompare(b.id);
        })
        .slice(0, Number(limit) || 0);
      return { results: rows.map((row) => ({ ...row })) };
    }

    if (query.startsWith('DELETE FROM admin_audit_log WHERE id IN (')) {
      const idSet = new Set(bindings);
      const before = this.state.adminAuditLog.length;
      this.state.adminAuditLog = this.state.adminAuditLog.filter((row) => !idSet.has(row.id));
      return { success: true, meta: { changes: before - this.state.adminAuditLog.length } };
    }

    if (query.startsWith('SELECT a.id, a.action, a.meta_json, a.created_at, a.admin_user_id, au.email AS admin_email, a.target_user_id, tu.email AS target_email FROM admin_audit_log a LEFT JOIN users au ON au.id = a.admin_user_id LEFT JOIN users tu ON tu.id = a.target_user_id')) {
      let limit = Number(bindings.at(-1)) || 0;
      let cursorTime = null;
      let cursorId = null;
      let search = null;

      if (query.includes('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')) {
        [cursorTime, , cursorId] = bindings;
      }
      if (query.includes('(au.email LIKE ? OR tu.email LIKE ? OR a.action LIKE ? OR a.meta_json LIKE ?)')) {
        const searchIndex = cursorTime ? 3 : 0;
        const like = bindings[searchIndex];
        search = typeof like === 'string' ? like.replace(/^%|%$/g, '') : null;
      }

      let rows = this.state.adminAuditLog.map((row) => {
        const admin = this.state.users.find((user) => user.id === row.admin_user_id);
        const target = this.state.users.find((user) => user.id === row.target_user_id);
        return {
          id: row.id,
          action: row.action,
          meta_json: row.meta_json,
          created_at: row.created_at,
          admin_user_id: row.admin_user_id,
          admin_email: admin?.email || null,
          target_user_id: row.target_user_id,
          target_email: target?.email || null,
        };
      });

      if (cursorTime && cursorId) {
        rows = rows.filter((row) => row.created_at < cursorTime || (row.created_at === cursorTime && row.id < cursorId));
      }
      if (search) {
        const needle = search.toLowerCase();
        rows = rows.filter((row) =>
          String(row.admin_email || '').toLowerCase().includes(needle) ||
          String(row.target_email || '').toLowerCase().includes(needle) ||
          String(row.action || '').toLowerCase().includes(needle) ||
          String(row.meta_json || '').toLowerCase().includes(needle)
        );
      }

      rows.sort((a, b) => {
        if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
        return b.id.localeCompare(a.id);
      });

      return { results: rows.slice(0, limit).map((row) => ({ ...row })) };
    }

    if (query === 'SELECT action, COUNT(*) AS cnt FROM admin_audit_log GROUP BY action') {
      const counts = new Map();
      for (const row of this.state.adminAuditLog) {
        counts.set(row.action, (counts.get(row.action) || 0) + 1);
      }
      return {
        results: Array.from(counts.entries()).map(([action, cnt]) => ({ action, cnt })),
      };
    }

    if (query.startsWith('SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at, u.email AS user_email FROM user_activity_log a LEFT JOIN users u ON u.id = a.user_id')) {
      let limit = Number(bindings.at(-1)) || 0;
      let cursorTime = null;
      let cursorId = null;
      let search = null;

      if (query.includes('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')) {
        [cursorTime, , cursorId] = bindings;
      }
      if (query.includes('(u.email LIKE ? OR a.action LIKE ? OR a.meta_json LIKE ?)')) {
        const searchIndex = cursorTime ? 3 : 0;
        const like = bindings[searchIndex];
        search = typeof like === 'string' ? like.replace(/^%|%$/g, '') : null;
      }

      let rows = this.state.userActivityLog.map((row) => {
        const user = this.state.users.find((entry) => entry.id === row.user_id);
        return {
          id: row.id,
          user_id: row.user_id,
          action: row.action,
          meta_json: row.meta_json,
          ip_address: row.ip_address,
          created_at: row.created_at,
          user_email: user?.email || null,
        };
      });

      if (cursorTime && cursorId) {
        rows = rows.filter((row) => row.created_at < cursorTime || (row.created_at === cursorTime && row.id < cursorId));
      }
      if (search) {
        const needle = search.toLowerCase();
        rows = rows.filter((row) =>
          String(row.user_email || '').toLowerCase().includes(needle) ||
          String(row.action || '').toLowerCase().includes(needle) ||
          String(row.meta_json || '').toLowerCase().includes(needle)
        );
      }

      rows.sort((a, b) => {
        if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
        return b.id.localeCompare(a.id);
      });

      return { results: rows.slice(0, limit).map((row) => ({ ...row })) };
    }

    if (query === "SELECT id, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'") {
      const [folderId, userId] = bindings;
      return this.state.aiFolders.find((row) => row.id === folderId && row.user_id === userId && row.status === 'active') || null;
    }

    if (query === "SELECT id, name, slug FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'") {
      const [folderId, userId] = bindings;
      const row = this.state.aiFolders.find((item) => item.id === folderId && item.user_id === userId && item.status === 'active');
      return row
        ? {
            id: row.id,
            name: row.name,
            slug: row.slug,
          }
        : null;
    }

    if (query === "SELECT id FROM ai_folders WHERE id = ? AND user_id = ? AND status = 'active'") {
      const [folderId, userId] = bindings;
      const row = this.state.aiFolders.find((item) => item.id === folderId && item.user_id === userId && item.status === 'active');
      return row ? { id: row.id } : null;
    }

    if (query === "UPDATE ai_folders SET name = ?, slug = ? WHERE id = ? AND user_id = ? AND status = 'active'") {
      const [name, slug, folderId, userId] = bindings;
      const conflict = this.state.aiFolders.find(
        (row) => row.user_id === userId && row.id !== folderId && row.slug === slug
      );
      if (conflict) {
        throw new Error('UNIQUE constraint failed: ai_folders.user_id, ai_folders.slug');
      }
      let changes = 0;
      for (const row of this.state.aiFolders) {
        if (row.id === folderId && row.user_id === userId && row.status === 'active') {
          row.name = name;
          row.slug = slug;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
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

    if (query === 'SELECT id, visibility, published_at FROM ai_images WHERE id = ? AND user_id = ?') {
      const [imageId, userId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.user_id === userId);
      return row
        ? {
            id: row.id,
            visibility: row.visibility,
            published_at: row.published_at,
          }
        : null;
    }

    if (query === 'SELECT id, prompt FROM ai_images WHERE id = ? AND user_id = ?') {
      const [imageId, userId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.user_id === userId);
      return row
        ? {
            id: row.id,
            prompt: row.prompt,
          }
        : null;
    }

    if (query === 'UPDATE ai_images SET prompt = ? WHERE id = ? AND user_id = ?') {
      const [prompt, imageId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (row.id === imageId && row.user_id === userId) {
          row.prompt = prompt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'UPDATE ai_images SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?') {
      const [visibility, publishedAt, imageId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (row.id === imageId && row.user_id === userId) {
          row.visibility = visibility;
          row.published_at = publishedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
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

    if (query === 'SELECT r2_key, poster_r2_key FROM ai_text_assets WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.user_id === userId)
          .map((row) => ({
            r2_key: row.r2_key,
            poster_r2_key: row.poster_r2_key ?? null,
          })),
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

    if (query === 'SELECT r2_key, poster_r2_key FROM ai_text_assets WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.folder_id === folderId && row.user_id === userId)
          .map((row) => ({ r2_key: row.r2_key, poster_r2_key: row.poster_r2_key ?? null })),
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

    if (query.startsWith('SELECT id, r2_key, poster_r2_key FROM ai_text_assets WHERE id IN (') && query.endsWith(') AND user_id = ?')) {
      const requestedIds = bindings.slice(0, -1);
      const userId = bindings[bindings.length - 1];
      return {
        results: this.state.aiTextAssets
          .filter((row) => requestedIds.includes(row.id) && row.user_id === userId)
          .map((row) => ({
            id: row.id,
            r2_key: row.r2_key,
            poster_r2_key: row.poster_r2_key ?? null,
          })),
      };
    }

    if (
      query.includes('UNION ALL')
      && query.includes('FROM ai_images')
      && query.includes('FROM ai_text_assets')
      && query.includes('asset_kind_rank')
      && query.includes('ORDER BY created_at DESC, asset_kind_rank DESC, id DESC LIMIT ?')
    ) {
      let index = 0;
      const imageUserId = bindings[index++];
      let imageFolderId = null;
      if (query.includes('FROM ai_images WHERE user_id = ? AND folder_id = ?')) {
        imageFolderId = bindings[index++];
      }
      const textUserId = bindings[index++];
      let textFolderId = null;
      if (query.includes('FROM ai_text_assets WHERE user_id = ? AND folder_id = ?')) {
        textFolderId = bindings[index++];
      }
      let cursor = null;
      if (query.includes('asset_kind_rank < ?')) {
        const createdAt = bindings[index++];
        index += 1;
        const rank = Number(bindings[index++]);
        index += 1;
        cursor = {
          created_at: createdAt,
          rank,
          id: bindings[index++],
        };
      }
      const limit = bindings[index];

      let rows = this.state.aiImages
        .filter((row) => row.user_id === imageUserId)
        .filter((row) => {
          if (query.includes('FROM ai_images WHERE user_id = ? AND folder_id IS NULL')) {
            return row.folder_id == null;
          }
          if (query.includes('FROM ai_images WHERE user_id = ? AND folder_id = ?')) {
            return row.folder_id === imageFolderId;
          }
          return true;
        })
        .map((row) => ({
          id: row.id,
          folder_id: row.folder_id,
          prompt: row.prompt,
          model: row.model,
          steps: row.steps,
          seed: row.seed,
          created_at: row.created_at,
          visibility: row.visibility,
          published_at: row.published_at,
          thumb_key: row.thumb_key,
          medium_key: row.medium_key,
          thumb_width: row.thumb_width,
          thumb_height: row.thumb_height,
          medium_width: row.medium_width,
          medium_height: row.medium_height,
          derivatives_status: row.derivatives_status,
          derivatives_version: row.derivatives_version,
          title: null,
          file_name: null,
          source_module: null,
          mime_type: null,
          size_bytes: null,
          preview_text: null,
          poster_r2_key: null,
          poster_width: null,
          poster_height: null,
          asset_kind_rank: 2,
        }));

      rows = rows.concat(
        this.state.aiTextAssets
          .filter((row) => row.user_id === textUserId)
          .filter((row) => {
            if (query.includes('FROM ai_text_assets WHERE user_id = ? AND folder_id IS NULL')) {
              return row.folder_id == null;
            }
            if (query.includes('FROM ai_text_assets WHERE user_id = ? AND folder_id = ?')) {
              return row.folder_id === textFolderId;
            }
            return true;
          })
          .map((row) => ({
            id: row.id,
            folder_id: row.folder_id,
            prompt: null,
            model: null,
            steps: null,
            seed: null,
            created_at: row.created_at,
            visibility: row.visibility || 'private',
            published_at: row.published_at ?? null,
            thumb_key: null,
            medium_key: null,
            thumb_width: null,
            thumb_height: null,
            medium_width: null,
            medium_height: null,
            derivatives_status: null,
            derivatives_version: null,
            title: row.title,
            file_name: row.file_name,
            source_module: row.source_module,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
            preview_text: row.preview_text,
            poster_r2_key: row.poster_r2_key ?? null,
            poster_width: row.poster_width ?? null,
            poster_height: row.poster_height ?? null,
            asset_kind_rank: 1,
          }))
      );

      if (cursor) {
        rows = rows.filter((row) => (
          String(row.created_at || '') < cursor.created_at
          || (
            String(row.created_at || '') === cursor.created_at
            && (
              Number(row.asset_kind_rank || 0) < cursor.rank
              || (
                Number(row.asset_kind_rank || 0) === cursor.rank
                && String(row.id || '') < String(cursor.id || '')
              )
            )
          )
        ));
      }

      rows = rows
        .sort((a, b) => (
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
          || Number(b.asset_kind_rank || 0) - Number(a.asset_kind_rank || 0)
          || String(b.id || '').localeCompare(String(a.id || ''))
        ))
        .slice(0, limit);

      return { results: rows };
    }

    if (query.startsWith('SELECT id, folder_id, prompt, model, steps, seed, created_at') && query.includes('FROM ai_images WHERE user_id = ?')) {
      let index = 0;
      const userId = bindings[index++];
      let folderId = null;
      if (query.includes('AND folder_id = ?')) {
        folderId = bindings[index++];
      }
      let cursor = null;
      if (query.includes('AND ( created_at < ? OR ( created_at = ? AND id < ? ) )')) {
        const createdAt = bindings[index++];
        index += 1;
        cursor = {
          created_at: createdAt,
          id: bindings[index++],
        };
      }
      const limit = query.endsWith('LIMIT ?') ? bindings[index] : 200;

      let rows = this.state.aiImages.filter((row) => row.user_id === userId);
      if (query.includes('AND folder_id IS NULL')) {
        rows = rows.filter((row) => row.folder_id == null);
      } else if (query.includes('AND folder_id = ?')) {
        rows = rows.filter((row) => row.folder_id === folderId);
      }
      if (cursor) {
        rows = rows.filter((row) => (
          String(row.created_at || '') < cursor.created_at
          || (
            String(row.created_at || '') === cursor.created_at
            && String(row.id || '') < String(cursor.id || '')
          )
        ));
      }
      rows = rows
        .slice()
        .sort((a, b) => (
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
          || String(b.id || '').localeCompare(String(a.id || ''))
        ))
        .slice(0, limit);
      return {
        results: rows.map((row) => ({
          id: row.id,
          folder_id: row.folder_id,
          prompt: row.prompt,
          model: row.model,
          steps: row.steps,
          seed: row.seed,
          created_at: row.created_at,
          ...(query.includes('visibility')
            ? {
                visibility: row.visibility,
                published_at: row.published_at,
              }
            : {}),
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

    if (
      query.includes('FROM ai_images LEFT JOIN profiles ON profiles.user_id = ai_images.user_id')
      && query.includes("WHERE ai_images.visibility = 'public'")
      && query.includes('ai_images.derivatives_status = \'ready\'')
      && query.includes('ai_images.thumb_key IS NOT NULL')
      && query.includes('ai_images.medium_key IS NOT NULL')
    ) {
      let index = 0;
      let cursor = null;
      if (query.includes('order_at < ?')) {
        const orderAt = bindings[index++];
        index += 1;
        const createdAt = bindings[index++];
        index += 1;
        cursor = {
          order_at: orderAt,
          created_at: createdAt,
          id: bindings[index++],
        };
      }
      const limit = bindings[index];
      let rows = this.state.aiImages
        .filter((row) =>
          row.visibility === 'public'
          && row.derivatives_status === 'ready'
          && row.thumb_key != null
          && row.medium_key != null
        )
        .map((row) => ({
          ...row,
          order_at: row.published_at || row.created_at || '',
        }));
      if (cursor) {
        rows = rows.filter((row) => (
          String(row.order_at || '') < cursor.order_at
          || (
            String(row.order_at || '') === cursor.order_at
            && (
              String(row.created_at || '') < cursor.created_at
              || (
                String(row.created_at || '') === cursor.created_at
                && String(row.id || '') < String(cursor.id || '')
              )
            )
          )
        ));
      }
      rows = rows
        .sort((a, b) => {
          const aOrder = String(a.order_at || '');
          const bOrder = String(b.order_at || '');
          return bOrder.localeCompare(aOrder) || String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id || '').localeCompare(String(a.id || ''));
        })
        .slice(0, limit);
      return {
        results: rows.map((row) => ({
          id: row.id,
          created_at: row.created_at,
          published_at: row.published_at,
          order_at: row.order_at,
          r2_key: row.r2_key,
          thumb_key: row.thumb_key,
          medium_key: row.medium_key,
          owner_display_name: this.state.profiles.find((profile) => profile.user_id === row.user_id)?.display_name ?? null,
          owner_has_avatar: this.state.profiles.find((profile) => profile.user_id === row.user_id)?.has_avatar ?? null,
          owner_avatar_updated_at: this.state.profiles.find((profile) => profile.user_id === row.user_id)?.avatar_updated_at ?? null,
          thumb_width: row.thumb_width,
          thumb_height: row.thumb_height,
          medium_width: row.medium_width,
          medium_height: row.medium_height,
          derivatives_version: row.derivatives_version,
          derivatives_ready_at: row.derivatives_ready_at,
        })),
      };
    }

    if (query === "SELECT created_at, published_at, r2_key, thumb_key, medium_key, thumb_mime_type, medium_mime_type, derivatives_version, derivatives_ready_at FROM ai_images WHERE id = ? AND visibility = 'public'") {
      const [imageId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.visibility === 'public');
      return row
        ? {
            created_at: row.created_at,
            published_at: row.published_at,
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
            thumb_mime_type: row.thumb_mime_type,
            medium_mime_type: row.medium_mime_type,
            derivatives_version: row.derivatives_version,
            derivatives_ready_at: row.derivatives_ready_at,
          }
        : null;
    }

    if (query === "SELECT ai_images.user_id, profiles.has_avatar, profiles.avatar_updated_at FROM ai_images LEFT JOIN profiles ON profiles.user_id = ai_images.user_id WHERE ai_images.id = ? AND ai_images.visibility = 'public'") {
      const [imageId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.visibility === 'public');
      if (!row) return null;
      const profile = this.state.profiles.find((item) => item.user_id === row.user_id);
      return {
        user_id: row.user_id,
        has_avatar: profile?.has_avatar ?? null,
        avatar_updated_at: profile?.avatar_updated_at ?? null,
      };
    }

    if (
      query.includes('FROM ai_text_assets')
      && query.includes('LEFT JOIN profiles ON profiles.user_id = ai_text_assets.user_id')
      && query.includes("WHERE ai_text_assets.visibility = 'public'")
      && query.includes("AND ai_text_assets.source_module = 'video'")
    ) {
      let index = 0;
      let cursor = null;
      if (query.includes('order_at < ?')) {
        const orderAt = bindings[index++];
        index += 1;
        const createdAt = bindings[index++];
        index += 1;
        cursor = {
          order_at: orderAt,
          created_at: createdAt,
          id: bindings[index++],
        };
      }
      const limit = bindings[index];
      let rows = this.state.aiTextAssets
        .filter((row) => row.visibility === 'public' && row.source_module === 'video')
        .map((row) => ({
          ...row,
          order_at: row.published_at || row.created_at || '',
        }));
      if (cursor) {
        rows = rows.filter((row) => (
          String(row.order_at || '') < cursor.order_at
          || (
            String(row.order_at || '') === cursor.order_at
            && (
              String(row.created_at || '') < cursor.created_at
              || (
                String(row.created_at || '') === cursor.created_at
                && String(row.id || '') < String(cursor.id || '')
              )
            )
          )
        ));
      }
      rows = rows
        .sort((a, b) => {
          const aOrder = String(a.order_at || '');
          const bOrder = String(b.order_at || '');
          return bOrder.localeCompare(aOrder) || String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id || '').localeCompare(String(a.id || ''));
        })
        .slice(0, limit);
      return {
        results: rows.map((row) => ({
          id: row.id,
          title: row.title,
          mime_type: row.mime_type,
          metadata_json: row.metadata_json,
          created_at: row.created_at,
          published_at: row.published_at,
          order_at: row.order_at,
          r2_key: row.r2_key,
          poster_r2_key: row.poster_r2_key ?? null,
          poster_width: row.poster_width ?? null,
          poster_height: row.poster_height ?? null,
          owner_display_name: this.state.profiles.find((profile) => profile.user_id === row.user_id)?.display_name ?? null,
          owner_has_avatar: this.state.profiles.find((profile) => profile.user_id === row.user_id)?.has_avatar ?? null,
          owner_avatar_updated_at: this.state.profiles.find((profile) => profile.user_id === row.user_id)?.avatar_updated_at ?? null,
        })),
      };
    }

    if (query === "SELECT created_at, published_at, r2_key, mime_type, poster_r2_key FROM ai_text_assets WHERE id = ? AND visibility = 'public' AND source_module = 'video'") {
      const [assetId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.visibility === 'public' && item.source_module === 'video');
      return row
        ? {
            created_at: row.created_at,
            published_at: row.published_at,
            r2_key: row.r2_key,
            mime_type: row.mime_type,
            poster_r2_key: row.poster_r2_key ?? null,
          }
        : null;
    }

    if (query === "SELECT ai_text_assets.user_id, profiles.has_avatar, profiles.avatar_updated_at FROM ai_text_assets LEFT JOIN profiles ON profiles.user_id = ai_text_assets.user_id WHERE ai_text_assets.id = ? AND ai_text_assets.visibility = 'public' AND ai_text_assets.source_module = 'video'") {
      const [assetId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.visibility === 'public' && item.source_module === 'video');
      if (!row) return null;
      const profile = this.state.profiles.find((item) => item.user_id === row.user_id);
      return {
        user_id: row.user_id,
        has_avatar: profile?.has_avatar ?? null,
        avatar_updated_at: profile?.avatar_updated_at ?? null,
      };
    }

    if (query.includes('SELECT id, folder_id, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at') && query.includes('FROM ai_text_assets WHERE user_id = ?')) {
      let index = 0;
      const userId = bindings[index++];
      let folderId = null;
      if (query.includes('AND folder_id = ?')) {
        folderId = bindings[index++];
      }
      let cursor = null;
      if (query.includes('AND ( created_at < ? OR ( created_at = ? AND id < ? ) )')) {
        const createdAt = bindings[index++];
        index += 1;
        cursor = {
          created_at: createdAt,
          id: bindings[index++],
        };
      }
      const limit = query.endsWith('LIMIT ?') ? bindings[index] : 200;
      let rows = this.state.aiTextAssets.filter((row) => row.user_id === userId);
      if (query.includes('AND folder_id IS NULL')) {
        rows = rows.filter((row) => row.folder_id == null);
      } else if (query.includes('AND folder_id = ?')) {
        rows = rows.filter((row) => row.folder_id === folderId);
      }
      if (cursor) {
        rows = rows.filter((row) => (
          String(row.created_at || '') < cursor.created_at
          || (
            String(row.created_at || '') === cursor.created_at
            && String(row.id || '') < String(cursor.id || '')
          )
        ));
      }
      rows = rows
        .slice()
        .sort((a, b) => (
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
          || String(b.id || '').localeCompare(String(a.id || ''))
        ))
        .slice(0, limit);
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
          visibility: row.visibility || 'private',
          published_at: row.published_at ?? null,
          poster_r2_key: row.poster_r2_key ?? null,
          poster_width: row.poster_width ?? null,
          poster_height: row.poster_height ?? null,
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

    if (query === 'SELECT id, title, file_name, mime_type, source_module FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.user_id === userId);
      return row
        ? {
            id: row.id,
            title: row.title,
            file_name: row.file_name,
            mime_type: row.mime_type,
            source_module: row.source_module,
          }
        : null;
    }

    if (query === 'UPDATE ai_text_assets SET title = ?, file_name = ? WHERE id = ? AND user_id = ?') {
      const [title, fileName, assetId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (row.id === assetId && row.user_id === userId) {
          row.title = title;
          row.file_name = fileName;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'SELECT r2_key, poster_r2_key FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.user_id === userId);
      return row ? { r2_key: row.r2_key, poster_r2_key: row.poster_r2_key ?? null } : null;
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

    if (query.startsWith("INSERT INTO r2_cleanup_queue (r2_key, status, created_at) SELECT poster_r2_key, 'pending', ? FROM ai_text_assets WHERE folder_id = ? AND user_id = ? AND poster_r2_key IS NOT NULL")) {
      const [createdAt, folderId, userId] = bindings;
      const rows = this.state.aiTextAssets.filter((row) => row.folder_id === folderId && row.user_id === userId && row.poster_r2_key);
      for (const row of rows) {
        this.state.r2CleanupQueue.push({
          id: this._cleanupSeq++,
          r2_key: row.poster_r2_key,
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

    if (query === "DELETE FROM r2_cleanup_queue WHERE r2_key = ? AND status = 'pending'") {
      const [key] = bindings;
      const before = this.state.r2CleanupQueue.length;
      this.state.r2CleanupQueue = this.state.r2CleanupQueue.filter(
        (row) => !(row.status === 'pending' && row.r2_key === key)
      );
      return { success: true, meta: { changes: before - this.state.r2CleanupQueue.length } };
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

    if (query.startsWith('INSERT INTO ai_video_jobs (')) {
      const [
        id,
        user_id,
        scope,
        status,
        provider,
        model,
        prompt,
        input_json,
        request_hash,
        provider_task_id,
        idempotency_key,
        attempt_count,
        max_attempts,
        next_attempt_at,
        locked_until,
        output_r2_key,
        output_url,
        error_code,
        error_message,
        created_at,
        updated_at,
        completed_at,
        expires_at,
      ] = bindings;
      if (
        idempotency_key
        && this.state.aiVideoJobs.some((row) => row.user_id === user_id && row.scope === scope && row.idempotency_key === idempotency_key)
      ) {
        throw new Error('UNIQUE constraint failed: ai_video_jobs.user_id, ai_video_jobs.scope, ai_video_jobs.idempotency_key');
      }
      this.state.aiVideoJobs.push({
        id,
        user_id,
        scope,
        status,
        provider,
        model,
        prompt,
        input_json,
        request_hash,
        provider_task_id,
        idempotency_key,
        attempt_count,
        max_attempts,
        next_attempt_at,
        locked_until,
        output_r2_key,
        output_url,
        error_code,
        error_message,
        created_at,
        updated_at,
        completed_at,
        expires_at,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT id, user_id, scope, status, provider, model, prompt, input_json, request_hash, provider_task_id, idempotency_key, attempt_count, max_attempts, next_attempt_at, locked_until, output_r2_key, output_url, error_code, error_message, created_at, updated_at, completed_at, expires_at FROM ai_video_jobs WHERE user_id = ? AND scope = ? AND idempotency_key = ?') {
      const [userId, scope, idempotencyKey] = bindings;
      return deepClone(this.state.aiVideoJobs.find((row) => row.user_id === userId && row.scope === scope && row.idempotency_key === idempotencyKey) || null);
    }

    if (query === "SELECT id, user_id, scope, status, provider, model, prompt, input_json, request_hash, provider_task_id, idempotency_key, attempt_count, max_attempts, next_attempt_at, locked_until, output_r2_key, output_url, error_code, error_message, created_at, updated_at, completed_at, expires_at FROM ai_video_jobs WHERE id = ? AND user_id = ? AND scope = 'admin'") {
      const [jobId, userId] = bindings;
      return deepClone(this.state.aiVideoJobs.find((row) => row.id === jobId && row.user_id === userId && row.scope === 'admin') || null);
    }

    if (query === 'SELECT ai_video_jobs.id AS id, ai_video_jobs.user_id AS user_id, ai_video_jobs.scope AS scope, ai_video_jobs.status AS status, ai_video_jobs.provider AS provider, ai_video_jobs.model AS model, ai_video_jobs.prompt AS prompt, ai_video_jobs.input_json AS input_json, ai_video_jobs.request_hash AS request_hash, ai_video_jobs.provider_task_id AS provider_task_id, ai_video_jobs.idempotency_key AS idempotency_key, ai_video_jobs.attempt_count AS attempt_count, ai_video_jobs.max_attempts AS max_attempts, ai_video_jobs.next_attempt_at AS next_attempt_at, ai_video_jobs.locked_until AS locked_until, ai_video_jobs.output_r2_key AS output_r2_key, ai_video_jobs.output_url AS output_url, ai_video_jobs.error_code AS error_code, ai_video_jobs.error_message AS error_message, ai_video_jobs.created_at AS created_at, ai_video_jobs.updated_at AS updated_at, ai_video_jobs.completed_at AS completed_at, ai_video_jobs.expires_at AS expires_at, users.email AS user_email FROM ai_video_jobs INNER JOIN users ON users.id = ai_video_jobs.user_id WHERE ai_video_jobs.id = ?') {
      const [jobId] = bindings;
      const row = this.state.aiVideoJobs.find((item) => item.id === jobId);
      if (!row) return null;
      const user = this.state.users.find((item) => item.id === row.user_id);
      if (!user) return null;
      return deepClone({ ...row, user_email: user.email });
    }

    if (query === "UPDATE ai_video_jobs SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?") {
      const [errorCode, errorMessage, updatedAt, completedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.status = 'failed';
        row.error_code = errorCode;
        row.error_message = errorMessage;
        row.updated_at = updatedAt;
        row.completed_at = completedAt;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_video_jobs SET status = 'failed', error_code = ?, error_message = ?, locked_until = NULL, updated_at = ?, completed_at = ? WHERE id = ?") {
      const [errorCode, errorMessage, updatedAt, completedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.status = 'failed';
        row.error_code = errorCode;
        row.error_message = errorMessage;
        row.locked_until = null;
        row.updated_at = updatedAt;
        row.completed_at = completedAt;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_video_jobs SET status = 'starting', attempt_count = attempt_count + 1, locked_until = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'starting', 'provider_pending', 'processing') AND (locked_until IS NULL OR locked_until < ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?)") {
      const [lockedUntil, updatedAt, jobId, now, nextAttemptNow] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (
          row.id === jobId
          && ['queued', 'starting', 'provider_pending', 'processing'].includes(row.status)
          && (!row.locked_until || row.locked_until < now)
          && (!row.next_attempt_at || row.next_attempt_at <= nextAttemptNow)
        ) {
          row.status = 'starting';
          row.attempt_count = Number(row.attempt_count || 0) + 1;
          row.locked_until = lockedUntil;
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_video_jobs SET status = 'succeeded', output_url = ?, error_code = NULL, error_message = NULL, locked_until = NULL, updated_at = ?, completed_at = ? WHERE id = ?") {
      const [outputUrl, updatedAt, completedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.status = 'succeeded';
        row.output_url = outputUrl;
        row.error_code = null;
        row.error_message = null;
        row.locked_until = null;
        row.updated_at = updatedAt;
        row.completed_at = completedAt;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_video_jobs SET status = 'queued', error_code = ?, error_message = ?, next_attempt_at = ?, locked_until = NULL, updated_at = ? WHERE id = ?") {
      const [errorCode, errorMessage, nextAttemptAt, updatedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.status = 'queued';
        row.error_code = errorCode;
        row.error_message = errorMessage;
        row.next_attempt_at = nextAttemptAt;
        row.locked_until = null;
        row.updated_at = updatedAt;
        changes += 1;
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
  const AUDIT_ARCHIVE = seed.disableAuditArchiveBinding ? undefined : new MockBucket(seed.auditArchive);
  const ACTIVITY_INGEST_QUEUE = seed.disableActivityIngestQueueBinding
    ? undefined
    : (seed.activityIngestQueue || new MockQueueProducer());
  const AI_IMAGE_DERIVATIVES_QUEUE = seed.aiImageDerivativesQueue || new MockQueueProducer();
  const AI_VIDEO_JOBS_QUEUE = seed.disableAiVideoJobsQueueBinding
    ? undefined
    : (seed.aiVideoJobsQueue || new MockQueueProducer());
  const IMAGES = seed.IMAGES || new MockImagesBinding(seed.imagesBinding);
  const PUBLIC_RATE_LIMITER = Object.prototype.hasOwnProperty.call(seed, 'PUBLIC_RATE_LIMITER')
    ? seed.PUBLIC_RATE_LIMITER
    : (seed.disablePublicRateLimiterBinding
        ? undefined
        : new MockDurableRateLimiterNamespace({
            counters: seed.publicRateLimitCounters,
            failWith: seed.publicRateLimiterFailWith,
          }));
  return {
    APP_BASE_URL: 'https://bitbi.ai',
    BITBI_ENV: seed.BITBI_ENV || 'test',
    RESEND_FROM_EMAIL: 'BITBI <noreply@contact.bitbi.ai>',
    SESSION_SECRET: seed.SESSION_SECRET === undefined ? 'test-session-secret' : seed.SESSION_SECRET,
    AI_SERVICE_AUTH_SECRET: seed.AI_SERVICE_AUTH_SECRET === undefined
      ? 'test-ai-service-auth-secret'
      : seed.AI_SERVICE_AUTH_SECRET,
    PBKDF2_ITERATIONS: '100000',
    DB,
    PRIVATE_MEDIA,
    USER_IMAGES,
    AUDIT_ARCHIVE,
    ACTIVITY_INGEST_QUEUE,
    AI_IMAGE_DERIVATIVES_QUEUE,
    AI_VIDEO_JOBS_QUEUE,
    IMAGES,
    PUBLIC_RATE_LIMITER,
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
  MockDurableRateLimiterNamespace,
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
