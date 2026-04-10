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

function nowIso() {
  return new Date().toISOString();
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
    this.objects.set(key, {
      body,
      httpMetadata: options.httpMetadata || {},
      size: body?.byteLength ?? 0,
      uploaded: new Date(),
    });
  }

  async get(key) {
    return this.objects.get(key) || null;
  }

  async delete(key) {
    if (this.failDeleteKeys.has(key)) {
      throw new Error(`Mock delete failure for ${key}`);
    }
    this.objects.delete(key);
  }

  async list({ prefix = '', limit = 1000 } = {}) {
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
    this._cleanupSeq = (this.state.r2CleanupQueue || []).length + 1;
  }

  prepare(query) {
    return new BoundStatement(this, query);
  }

  async batch(statements) {
    const snapshot = deepClone(this.state);
    const seq = this._cleanupSeq;
    const results = [];
    try {
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    } catch (error) {
      this.state = snapshot;
      this._cleanupSeq = seq;
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

    if (query === 'DELETE FROM email_verification_tokens WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.emailVerificationTokens.length;
      this.state.emailVerificationTokens = this.state.emailVerificationTokens.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.emailVerificationTokens.length } };
    }

    if (query === 'DELETE FROM password_reset_tokens WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.passwordResetTokens.length;
      this.state.passwordResetTokens = this.state.passwordResetTokens.filter((row) => row.user_id !== userId);
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

    if (query.startsWith('INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at) SELECT')) {
      const [id, userId, folderId, r2Key, prompt, model, steps, seed, createdAt, existsFolderId, existsUserId] = bindings;
      const folder = this.state.aiFolders.find(
        (row) => row.id === existsFolderId && row.user_id === existsUserId && row.status === 'active'
      );
      if (!folder) {
        return { success: true, meta: { changes: 0 } };
      }
      this.state.aiImages.push({
        id,
        user_id: userId,
        folder_id: folderId,
        r2_key: r2Key,
        prompt,
        model,
        steps,
        seed,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, created_at) VALUES')) {
      const [id, userId, folderId, r2Key, prompt, model, steps, seed, createdAt] = bindings;
      this.state.aiImages.push({
        id,
        user_id: userId,
        folder_id: folderId,
        r2_key: r2Key,
        prompt,
        model,
        steps,
        seed,
        created_at: createdAt,
      });
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

    if (query === 'SELECT r2_key FROM ai_images WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.user_id === userId)
          .map((row) => ({ r2_key: row.r2_key })),
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

    if (query === 'SELECT r2_key FROM ai_text_assets WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.folder_id === folderId && row.user_id === userId)
          .map((row) => ({ r2_key: row.r2_key })),
      };
    }

    if (query.startsWith('SELECT id, folder_id, prompt, model, steps, seed, created_at FROM ai_images WHERE user_id = ?')) {
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
  return {
    APP_BASE_URL: 'https://bitbi.ai',
    RESEND_FROM_EMAIL: 'BITBI <noreply@contact.bitbi.ai>',
    SESSION_SECRET: 'test-session-secret',
    PBKDF2_ITERATIONS: '100000',
    DB,
    PRIVATE_MEDIA,
    USER_IMAGES,
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
  createAuthTestEnv,
  createExecutionContext,
  deepClone,
  loadWorker,
  nowIso,
  seedSession,
  sha256Hex,
};
