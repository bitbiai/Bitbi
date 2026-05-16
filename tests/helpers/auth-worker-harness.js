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

function splitTopLevelCommaList(value) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (value[i + 1] === quote) {
          current += value[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')' && depth > 0) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractParenthesizedAt(query, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < query.length; i += 1) {
    const ch = query[i];
    if (quote) {
      if (ch === quote) {
        if (query[i + 1] === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          body: query.slice(openIndex + 1, i),
          endIndex: i,
        };
      }
    }
  }
  return null;
}

function findTopLevelFrom(query, startIndex) {
  let depth = 0;
  let quote = null;
  for (let i = startIndex; i < query.length; i += 1) {
    const ch = query[i];
    if (quote) {
      if (ch === quote) {
        if (query[i + 1] === quote) {
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')' && depth > 0) depth -= 1;
    if (depth === 0 && query.slice(i, i + 6) === ' FROM ') return i;
  }
  return -1;
}

function validateCreditInsertArity(query) {
  const match = query.match(/^INSERT INTO (member_credit_ledger|member_usage_events|credit_ledger|usage_events) \(/);
  if (!match) return;
  const columnsOpen = query.indexOf('(', match[0].length - 1);
  const columns = extractParenthesizedAt(query, columnsOpen);
  if (!columns) return;
  const columnCount = splitTopLevelCommaList(columns.body).length;
  const suffix = query.slice(columns.endIndex + 1).trim();
  let valueCount = null;
  if (suffix.startsWith('VALUES')) {
    const valuesOpen = query.indexOf('(', columns.endIndex + 1);
    const values = extractParenthesizedAt(query, valuesOpen);
    valueCount = values ? splitTopLevelCommaList(values.body).length : null;
  } else if (suffix.startsWith('SELECT')) {
    const selectStart = query.indexOf('SELECT', columns.endIndex + 1) + 'SELECT'.length;
    const fromIndex = findTopLevelFrom(query, selectStart);
    valueCount = fromIndex > selectStart
      ? splitTopLevelCommaList(query.slice(selectStart, fromIndex).trim()).length
      : null;
  }
  if (valueCount != null && valueCount !== columnCount) {
    throw new Error(`D1_ERROR: ${valueCount} values for ${columnCount} columns: SQLITE_ERROR`);
  }
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
    size_bytes: null,
    ...row,
  };
}

function normalizeAiVideoJobRow(row = {}) {
  return {
    budget_policy_json: null,
    budget_policy_status: null,
    budget_policy_fingerprint: null,
    budget_policy_version: null,
    ...row,
  };
}

function latestCreditLedgerEntry(rows, organizationId) {
  let latest = null;
  let latestIndex = -1;
  for (const [index, row] of (rows || []).entries()) {
    if (row.organization_id !== organizationId) continue;
    if (!latest) {
      latest = row;
      latestIndex = index;
      continue;
    }
    const createdCompare = String(row.created_at || "").localeCompare(String(latest.created_at || ""));
    if (createdCompare > 0 || (createdCompare === 0 && index > latestIndex)) {
      latest = row;
      latestIndex = index;
    }
  }
  return latest;
}

function latestMemberCreditLedgerEntry(rows, userId) {
  let latest = null;
  let latestIndex = -1;
  for (const [index, row] of (rows || []).entries()) {
    if (row.user_id !== userId) continue;
    if (!latest) {
      latest = row;
      latestIndex = index;
      continue;
    }
    const createdCompare = String(row.created_at || "").localeCompare(String(latest.created_at || ""));
    if (createdCompare > 0 || (createdCompare === 0 && index > latestIndex)) {
      latest = row;
      latestIndex = index;
    }
  }
  return latest;
}

function activeAiUsageReservedCredits(rows, organizationId, now, { excludeId = null } = {}) {
  return (rows || [])
    .filter((row) =>
      row.organization_id === organizationId &&
      row.billing_status === 'reserved' &&
      ['reserved', 'provider_running', 'finalizing'].includes(row.status) &&
      String(row.expires_at || '') > String(now || '') &&
      (!excludeId || row.id !== excludeId)
    )
    .reduce((sum, row) => sum + Number(row.credit_cost || 0), 0);
}

function activeMemberAiUsageReservedCredits(rows, userId, now, { excludeId = null } = {}) {
  return (rows || [])
    .filter((row) =>
      row.user_id === userId &&
      row.billing_status === 'reserved' &&
      ['reserved', 'provider_running', 'finalizing'].includes(row.status) &&
      String(row.expires_at || '') > String(now || '') &&
      (!excludeId || row.id !== excludeId)
    )
    .reduce((sum, row) => sum + Number(row.credit_cost || 0), 0);
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
    this.headCalls = [];
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

  async get(key, options = {}) {
    this.getCalls.push(key);
    const object = this.objects.get(key);
    if (!object) return null;
    const range = options?.range;
    if (!range) return object;

    const start = Math.max(0, Number(range.offset) || 0);
    const length = Math.max(0, Number(range.length) || 0);
    const end = length > 0 ? start + length : undefined;
    let body = object.body;
    if (body instanceof ArrayBuffer) {
      body = body.slice(start, end);
    } else if (body instanceof Uint8Array) {
      body = body.slice(start, end);
    } else if (typeof body === 'string') {
      body = body.slice(start, end);
    }
    return {
      ...object,
      body,
      size: body?.byteLength ?? (typeof body === 'string' ? body.length : length),
    };
  }

  async head(key) {
    this.headCalls.push(key);
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      key,
      httpMetadata: value.httpMetadata || {},
      size: value.size,
      uploaded: value.uploaded,
    };
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
    this.sendCalls = [];
    this.failWith = null;
  }

  async send(body, options = undefined) {
    if (this.failWith) {
      throw this.failWith instanceof Error ? this.failWith : new Error(String(this.failWith));
    }
    this.sendCalls.push({ body: deepClone(body), options: options ? deepClone(options) : undefined });
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
    this.failUsageEventInsert = Boolean(seed.failUsageEventInsert);
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
      activitySearchIndex: [],
      rateLimitCounters: [],
      aiFolders: [],
      aiImages: [],
      aiTextAssets: [],
      userAssetStorageUsage: [],
      aiVideoJobs: [],
      aiVideoJobPoisonMessages: [],
      aiGenerationLog: [],
      aiDailyQuotaUsage: [],
      userActivityLog: [],
      r2CleanupQueue: [],
      dataLifecycleRequests: [],
      dataLifecycleRequestItems: [],
      dataExportArchives: [],
      organizations: [],
      organizationMemberships: [],
      plans: [{
        id: 'plan_free',
        code: 'free',
        name: 'Free',
        status: 'active',
        billing_interval: 'none',
        monthly_credit_grant: 100,
        metadata_json: '{}',
        created_at: '2026-04-26T00:00:00.000Z',
        updated_at: '2026-04-26T00:00:00.000Z',
      }],
      organizationSubscriptions: [],
      entitlements: [
        { id: 'ent_free_ai_text_generate', plan_id: 'plan_free', feature_key: 'ai.text.generate', enabled: 1, value_kind: 'boolean', value_numeric: null, value_text: null, created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z' },
        { id: 'ent_free_ai_image_generate', plan_id: 'plan_free', feature_key: 'ai.image.generate', enabled: 1, value_kind: 'boolean', value_numeric: null, value_text: null, created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z' },
        { id: 'ent_free_ai_video_generate', plan_id: 'plan_free', feature_key: 'ai.video.generate', enabled: 1, value_kind: 'boolean', value_numeric: null, value_text: null, created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z' },
        { id: 'ent_free_ai_storage_private', plan_id: 'plan_free', feature_key: 'ai.storage.private', enabled: 1, value_kind: 'boolean', value_numeric: null, value_text: null, created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z' },
        { id: 'ent_free_org_members_max', plan_id: 'plan_free', feature_key: 'org.members.max', enabled: 1, value_kind: 'number', value_numeric: 5, value_text: null, created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z' },
        { id: 'ent_free_credits_monthly', plan_id: 'plan_free', feature_key: 'credits.monthly', enabled: 1, value_kind: 'number', value_numeric: 100, value_text: null, created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-26T00:00:00.000Z' },
        { id: 'ent_free_credits_balance_max', plan_id: 'plan_free', feature_key: 'credits.balance.max', enabled: 1, value_kind: 'number', value_numeric: 100000, value_text: null, created_at: '2026-04-26T00:00:00.000Z', updated_at: '2026-04-27T00:00:00.000Z' },
      ],
      billingCustomers: [],
      billingProviderEvents: [],
      billingEventActions: [],
      billingCheckoutSessions: [],
      billingMemberCheckoutSessions: [],
      billingMemberSubscriptions: [],
      billingMemberSubscriptionCheckoutSessions: [],
      newsPulseItems: [],
      openClawIngestNonces: [],
      creditLedger: [],
      usageEvents: [],
      memberCreditLedger: [],
      memberUsageEvents: [],
      memberCreditBuckets: [],
      memberCreditBucketEvents: [],
      aiUsageAttempts: [],
      memberAiUsageAttempts: [],
      ...deepClone(seed),
    };
    this.state.profiles = (this.state.profiles || []).map((row) => ({
      has_avatar: row.has_avatar ?? null,
      avatar_updated_at: row.avatar_updated_at ?? null,
      ...row,
    }));
    this.state.aiImages = (this.state.aiImages || []).map((row) => normalizeAiImageRow(row));
    this.state.aiVideoJobs = (this.state.aiVideoJobs || []).map((row) => normalizeAiVideoJobRow(row));
    this.state.aiTextAssets = (this.state.aiTextAssets || []).map((row) => ({
      visibility: 'private',
      published_at: null,
      poster_r2_key: null,
      poster_width: null,
      poster_height: null,
      poster_size_bytes: null,
      metadata_json: '{}',
      ...row,
    }));
    this.state.userAssetStorageUsage = (this.state.userAssetStorageUsage || []).map((row) => ({
      used_bytes: 0,
      updated_at: nowIso(),
      ...row,
    }));
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
    if (this.missingTables.has('ai_video_job_poison_messages') && query.includes('ai_video_job_poison_messages')) {
      throw new Error('no such table: ai_video_job_poison_messages');
    }
    if (this.missingTables.has('admin_audit_log') && query.includes('admin_audit_log')) {
      throw new Error('no such table: admin_audit_log');
    }
    if (this.missingTables.has('user_activity_log') && query.includes('user_activity_log')) {
      throw new Error('no such table: user_activity_log');
    }
    if (this.missingTables.has('activity_search_index') && query.includes('activity_search_index')) {
      throw new Error('no such table: activity_search_index');
    }
    if (this.missingTables.has('data_lifecycle_requests') && query.includes('data_lifecycle_requests')) {
      throw new Error('no such table: data_lifecycle_requests');
    }
    if (this.missingTables.has('data_lifecycle_request_items') && query.includes('data_lifecycle_request_items')) {
      throw new Error('no such table: data_lifecycle_request_items');
    }
    if (this.missingTables.has('data_export_archives') && query.includes('data_export_archives')) {
      throw new Error('no such table: data_export_archives');
    }
    if (this.missingTables.has('organizations') && query.includes('organizations')) {
      throw new Error('no such table: organizations');
    }
    if (this.missingTables.has('organization_memberships') && query.includes('organization_memberships')) {
      throw new Error('no such table: organization_memberships');
    }
    if (this.missingTables.has('plans') && query.includes('plans')) {
      throw new Error('no such table: plans');
    }
    if (this.missingTables.has('organization_subscriptions') && query.includes('organization_subscriptions')) {
      throw new Error('no such table: organization_subscriptions');
    }
    if (this.missingTables.has('entitlements') && query.includes('entitlements')) {
      throw new Error('no such table: entitlements');
    }
    if (this.missingTables.has('credit_ledger') && query.includes('credit_ledger')) {
      throw new Error('no such table: credit_ledger');
    }
    if (this.missingTables.has('usage_events') && query.includes('usage_events')) {
      throw new Error('no such table: usage_events');
    }
    if (this.missingTables.has('member_credit_ledger') && query.includes('member_credit_ledger')) {
      throw new Error('no such table: member_credit_ledger');
    }
    if (this.missingTables.has('member_usage_events') && query.includes('member_usage_events')) {
      throw new Error('no such table: member_usage_events');
    }
    if (this.missingTables.has('member_credit_buckets') && query.includes('member_credit_buckets')) {
      throw new Error('no such table: member_credit_buckets');
    }
    if (this.missingTables.has('member_credit_bucket_events') && query.includes('member_credit_bucket_events')) {
      throw new Error('no such table: member_credit_bucket_events');
    }
    if (this.missingTables.has('billing_member_subscriptions') && query.includes('billing_member_subscriptions')) {
      throw new Error('no such table: billing_member_subscriptions');
    }
    if (this.missingTables.has('billing_member_subscription_checkout_sessions') && query.includes('billing_member_subscription_checkout_sessions')) {
      throw new Error('no such table: billing_member_subscription_checkout_sessions');
    }

    validateCreditInsertArity(query);

    if (this.missingTables.has('ai_usage_attempts') && /\bai_usage_attempts\b/.test(query)) {
      throw new Error('no such table: ai_usage_attempts');
    }
    if (this.missingTables.has('member_ai_usage_attempts') && query.includes('member_ai_usage_attempts')) {
      throw new Error('no such table: member_ai_usage_attempts');
    }
    if (this.missingTables.has('user_asset_storage_usage') && query.includes('user_asset_storage_usage')) {
      throw new Error('no such table: user_asset_storage_usage');
    }
    if (this.missingTables.has('billing_provider_events') && query.includes('billing_provider_events')) {
      throw new Error('no such table: billing_provider_events');
    }
    if (this.missingTables.has('billing_event_actions') && query.includes('billing_event_actions')) {
      throw new Error('no such table: billing_event_actions');
    }
    if (this.missingTables.has('billing_member_checkout_sessions') && query.includes('billing_member_checkout_sessions')) {
      throw new Error('no such table: billing_member_checkout_sessions');
    }
    if (this.missingTables.has('news_pulse_items') && query.includes('news_pulse_items')) {
      throw new Error('no such table: news_pulse_items');
    }
    if (this.missingTables.has('openclaw_ingest_nonces') && query.includes('openclaw_ingest_nonces')) {
      throw new Error('no such table: openclaw_ingest_nonces');
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

    if (query === 'UPDATE sessions SET token_hash = ? WHERE id = ? AND token_hash = ?') {
      const [nextTokenHash, sessionId, previousTokenHash] = bindings;
      const row = this.state.sessions.find((item) => item.id === sessionId && item.token_hash === previousTokenHash);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.token_hash = nextTokenHash;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, email, password_hash, created_at, status, role, email_verified_at FROM users WHERE email = ?')) {
      const [email] = bindings;
      return this.state.users.find((row) => row.email === email) || null;
    }

    if (query === 'SELECT id, email, role, status, created_at, updated_at FROM users WHERE id = ? LIMIT 1') {
      const [userId] = bindings;
      const row = this.state.users.find((entry) => entry.id === userId);
      return row ? deepClone({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
      }) : null;
    }

    if (query === 'UPDATE users SET role = ?, updated_at = ? WHERE id = ?') {
      const [role, updatedAt, userId] = bindings;
      const row = this.state.users.find((item) => item.id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.role = role;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE users SET password_hash = ? WHERE id = ?') {
      const [passwordHash, userId] = bindings;
      const row = this.state.users.find((item) => item.id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.password_hash = passwordHash;
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

    if (
      query.startsWith('INSERT INTO activity_search_index ( source_table, source_event_id, actor_user_id, actor_email_norm, target_user_id, target_email_norm, action_norm, entity_type, entity_id, summary, created_at ) VALUES')
      || query.startsWith('INSERT OR IGNORE INTO activity_search_index ( source_table, source_event_id, actor_user_id, actor_email_norm, target_user_id, target_email_norm, action_norm, entity_type, entity_id, summary, created_at ) VALUES')
    ) {
      const [
        sourceTable,
        sourceEventId,
        actorUserId,
        actorEmailNorm,
        targetUserId,
        targetEmailNorm,
        actionNorm,
        entityType,
        entityId,
        summary,
        createdAt,
      ] = bindings;
      const existing = this.state.activitySearchIndex.find((row) =>
        row.source_table === sourceTable && row.source_event_id === sourceEventId
      );
      if (existing) {
        return { success: true, meta: { changes: query.startsWith('INSERT OR IGNORE') ? 0 : 0 } };
      }
      this.state.activitySearchIndex.push({
        source_table: sourceTable,
        source_event_id: sourceEventId,
        actor_user_id: actorUserId,
        actor_email_norm: actorEmailNorm,
        target_user_id: targetUserId,
        target_email_norm: targetEmailNorm,
        action_norm: actionNorm,
        entity_type: entityType,
        entity_id: entityId,
        summary,
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

    if (query.startsWith('DELETE FROM activity_search_index WHERE source_table = ? AND source_event_id IN (')) {
      const [sourceTable, ...ids] = bindings;
      const idSet = new Set(ids);
      const before = this.state.activitySearchIndex.length;
      this.state.activitySearchIndex = this.state.activitySearchIndex.filter((row) =>
        row.source_table !== sourceTable || !idSet.has(row.source_event_id)
      );
      return { success: true, meta: { changes: before - this.state.activitySearchIndex.length } };
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

    if (query === 'SELECT id, email, role, status, created_at FROM users WHERE id = ? LIMIT 1') {
      const [userId] = bindings;
      const row = this.state.users.find((entry) => entry.id === userId);
      return row ? deepClone({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        created_at: row.created_at,
      }) : null;
    }

    if (query === 'SELECT id FROM organizations WHERE slug = ? LIMIT 1') {
      const [slug] = bindings;
      const row = this.state.organizations.find((entry) => entry.slug === slug);
      return row ? { id: row.id } : null;
    }

    if (query === "SELECT id FROM organizations WHERE id = ? AND status = 'active' LIMIT 1") {
      const [organizationId] = bindings;
      const row = this.state.organizations.find((entry) =>
        entry.id === organizationId && entry.status === 'active'
      );
      return row ? { id: row.id } : null;
    }

    if (query.startsWith('SELECT id, name, slug, status, created_by_user_id, create_request_hash, created_at, updated_at FROM organizations WHERE created_by_user_id = ? AND create_idempotency_key = ?')) {
      const [userId, key] = bindings;
      return deepClone(this.state.organizations.find((row) =>
        row.created_by_user_id === userId && row.create_idempotency_key === key
      ) || null);
    }

    if (query.startsWith('INSERT INTO organizations ( id, name, slug, status, created_by_user_id, create_idempotency_key,')) {
      const [
        id,
        name,
        slug,
        status,
        createdByUserId,
        createIdempotencyKey,
        createRequestHash,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.state.organizations.some((row) => row.id === id || row.slug === slug)) {
        throw new Error('UNIQUE constraint failed: organizations');
      }
      this.state.organizations.push({
        id,
        name,
        slug,
        status,
        created_by_user_id: createdByUserId,
        create_idempotency_key: createIdempotencyKey,
        create_request_hash: createRequestHash,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO organization_memberships ( id, organization_id, user_id, role, status, created_by_user_id,')) {
      const [
        id,
        organizationId,
        userId,
        role,
        status,
        createdByUserId,
        createIdempotencyKey,
        createRequestHash,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.state.organizationMemberships.some((row) =>
        row.id === id || (row.organization_id === organizationId && row.user_id === userId)
      )) {
        throw new Error('UNIQUE constraint failed: organization_memberships');
      }
      this.state.organizationMemberships.push({
        id,
        organization_id: organizationId,
        user_id: userId,
        role,
        status,
        created_by_user_id: createdByUserId,
        create_idempotency_key: createIdempotencyKey,
        create_request_hash: createRequestHash,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status, om.create_request_hash, om.created_at, om.updated_at FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id WHERE om.organization_id = ? AND om.created_by_user_id = ?')) {
      const [organizationId, createdByUserId, key] = bindings;
      const row = this.state.organizationMemberships.find((entry) =>
        entry.organization_id === organizationId &&
        entry.created_by_user_id === createdByUserId &&
        entry.create_idempotency_key === key
      );
      if (!row) return null;
      const user = this.state.users.find((entry) => entry.id === row.user_id);
      return { ...deepClone(row), email: user?.email || null };
    }

    if (query.startsWith('SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status, om.created_at, om.updated_at FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id INNER JOIN organizations o ON o.id = om.organization_id')) {
      const [organizationId, userId] = bindings;
      const org = this.state.organizations.find((entry) =>
        entry.id === organizationId && entry.status === 'active'
      );
      const row = org
        ? this.state.organizationMemberships.find((entry) =>
          entry.organization_id === organizationId &&
          entry.user_id === userId &&
          entry.status === 'active'
        )
        : null;
      if (!row) return null;
      const user = this.state.users.find((entry) => entry.id === row.user_id);
      return { ...deepClone(row), email: user?.email || null };
    }

    if (query.startsWith('SELECT o.id, o.name, o.slug, o.status, o.created_by_user_id, o.created_at, o.updated_at, om.role, (SELECT COUNT(*) FROM organization_memberships active_members')) {
      if (query.includes('FROM organization_memberships om INNER JOIN organizations o ON o.id = om.organization_id')) {
        const [userId, limit] = bindings;
        const rows = this.state.organizationMemberships
          .filter((membership) => membership.user_id === userId && membership.status === 'active')
          .map((membership) => {
            const org = this.state.organizations.find((entry) =>
              entry.id === membership.organization_id && entry.status === 'active'
            );
            if (!org) return null;
            return {
              ...deepClone(org),
              role: membership.role,
              member_count: this.state.organizationMemberships.filter((entry) =>
                entry.organization_id === org.id && entry.status === 'active'
              ).length,
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
          .slice(0, Number(limit));
        return { results: rows };
      }
      if (query.includes('FROM organizations o INNER JOIN organization_memberships om ON om.organization_id = o.id')) {
        const [organizationId, userId] = bindings;
        const membership = this.state.organizationMemberships.find((entry) =>
          entry.organization_id === organizationId &&
          entry.user_id === userId &&
          entry.status === 'active'
        );
        const org = membership
          ? this.state.organizations.find((entry) => entry.id === organizationId && entry.status === 'active')
          : null;
        if (!org) return null;
        return {
          ...deepClone(org),
          role: membership.role,
          member_count: this.state.organizationMemberships.filter((entry) =>
            entry.organization_id === org.id && entry.status === 'active'
          ).length,
        };
      }
    }

    if (query.startsWith('SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status, om.created_at, om.updated_at FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id WHERE om.organization_id = ? AND om.status =')) {
      const [organizationId, limit] = bindings;
      const rows = this.state.organizationMemberships
        .filter((row) => row.organization_id === organizationId && row.status === 'active')
        .map((row) => ({
          ...deepClone(row),
          email: this.state.users.find((user) => user.id === row.user_id)?.email || null,
        }))
        .sort((a, b) => {
          const rank = { owner: 1, admin: 2, member: 3, viewer: 4 };
          return (rank[a.role] || 9) - (rank[b.role] || 9)
            || a.created_at.localeCompare(b.created_at)
            || a.user_id.localeCompare(b.user_id);
        })
        .slice(0, Number(limit));
      return { results: rows };
    }

    if (query.startsWith('SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status, om.created_at, om.updated_at FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id WHERE om.organization_id = ? AND om.user_id = ?')) {
      const [organizationId, userId] = bindings;
      const row = this.state.organizationMemberships.find((entry) =>
        entry.organization_id === organizationId && entry.user_id === userId
      );
      if (!row) return null;
      const user = this.state.users.find((entry) => entry.id === row.user_id);
      return { ...deepClone(row), email: user?.email || null };
    }

    if (query.startsWith('SELECT o.id, o.name, o.slug, o.status, o.created_by_user_id, u.email AS created_by_email, o.created_at, o.updated_at, (SELECT COUNT(*) FROM organization_memberships active_members')) {
      if (query.includes('WHERE o.id = ?')) {
        const [organizationId] = bindings;
        const org = this.state.organizations.find((entry) => entry.id === organizationId);
        if (!org) return null;
        const creator = this.state.users.find((entry) => entry.id === org.created_by_user_id);
        return {
          ...deepClone(org),
          created_by_email: creator?.email || null,
          member_count: this.state.organizationMemberships.filter((entry) =>
            entry.organization_id === org.id && entry.status === 'active'
          ).length,
        };
      }
      const hasSearch = query.includes('WHERE o.name LIKE ? OR o.slug LIKE ?');
      const search = hasSearch ? String(bindings[0] || '').replace(/^%|%$/g, '') : null;
      const limit = bindings[hasSearch ? 2 : 0];
      let rows = this.state.organizations.slice();
      if (search) {
        const normalizedSearch = search.toLowerCase();
        rows = rows.filter((org) =>
          String(org.name || '').toLowerCase().includes(normalizedSearch) ||
          String(org.slug || '').toLowerCase().includes(normalizedSearch)
        );
      }
      rows = rows
        .map((org) => {
          const creator = this.state.users.find((entry) => entry.id === org.created_by_user_id);
          return {
            ...deepClone(org),
            created_by_email: creator?.email || null,
            member_count: this.state.organizationMemberships.filter((entry) =>
              entry.organization_id === org.id && entry.status === 'active'
            ).length,
          };
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
        .slice(0, Number(limit));
      return { results: rows };
    }

    if (query.startsWith('SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status, om.created_at, om.updated_at FROM organization_memberships om INNER JOIN users u ON u.id = om.user_id WHERE om.organization_id = ? ORDER BY')) {
      const [organizationId] = bindings;
      const rows = this.state.organizationMemberships
        .filter((row) => row.organization_id === organizationId)
        .map((row) => ({
          ...deepClone(row),
          email: this.state.users.find((user) => user.id === row.user_id)?.email || null,
        }))
        .sort((a, b) => {
          const rank = { owner: 1, admin: 2, member: 3, viewer: 4 };
          return (rank[a.role] || 9) - (rank[b.role] || 9)
            || a.created_at.localeCompare(b.created_at)
            || a.user_id.localeCompare(b.user_id);
        })
        .slice(0, 100);
      return { results: rows };
    }

    if (query === "SELECT id, code, name, status, billing_interval, monthly_credit_grant, created_at, updated_at FROM plans WHERE code = ? AND status = 'active' LIMIT 1") {
      const [code] = bindings;
      return deepClone(this.state.plans.find((row) => row.code === code && row.status === 'active') || null);
    }

    if (query.startsWith('SELECT id, organization_id, plan_id, status, source, provider, current_period_start, current_period_end, cancel_at, created_at, updated_at FROM organization_subscriptions WHERE organization_id = ?')) {
      const [organizationId] = bindings;
      return deepClone(this.state.organizationSubscriptions
        .filter((row) => row.organization_id === organizationId && row.status === 'active')
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] || null);
    }

    if (query === 'SELECT id, code, name, status, billing_interval, monthly_credit_grant, created_at, updated_at FROM plans WHERE id = ? LIMIT 1') {
      const [planId] = bindings;
      return deepClone(this.state.plans.find((row) => row.id === planId) || null);
    }

    if (query.startsWith('SELECT id, plan_id, feature_key, enabled, value_kind, value_numeric, value_text, created_at, updated_at FROM entitlements WHERE plan_id = ?')) {
      const [planId] = bindings;
      return {
        results: deepClone(this.state.entitlements
          .filter((row) => row.plan_id === planId)
          .sort((a, b) => a.feature_key.localeCompare(b.feature_key))),
      };
    }

    if (query.startsWith('SELECT balance_after FROM credit_ledger WHERE organization_id = ?')) {
      const [organizationId] = bindings;
      const latest = latestCreditLedgerEntry(this.state.creditLedger, organizationId);
      return latest ? { balance_after: latest.balance_after } : null;
    }

    if (query.startsWith('SELECT id, organization_id, amount, balance_after, entry_type, feature_key, source, request_hash, created_by_user_id, created_at FROM credit_ledger WHERE organization_id = ? AND idempotency_key = ?')) {
      const [organizationId, idempotencyKey] = bindings;
      return deepClone(this.state.creditLedger.find((row) =>
        row.organization_id === organizationId && row.idempotency_key === idempotencyKey
      ) || null);
    }

    if (query.startsWith('SELECT id, organization_id, user_id, feature_key, quantity, credits_delta, credit_ledger_id, request_hash, status, created_at FROM usage_events WHERE organization_id = ? AND idempotency_key = ?')) {
      const [organizationId, idempotencyKey] = bindings;
      return deepClone(this.state.usageEvents.find((row) =>
        row.organization_id === organizationId && row.idempotency_key === idempotencyKey
      ) || null);
    }

    if (query.startsWith('SELECT id, organization_id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, result_temp_key, result_save_reference, result_mime_type, result_model, result_prompt_length, result_steps, result_seed, balance_after, error_code, error_message, created_at, updated_at, completed_at, expires_at FROM ai_usage_attempts WHERE organization_id = ? AND idempotency_key = ?')) {
      const [organizationId, idempotencyKey] = bindings;
      return deepClone(this.state.aiUsageAttempts.find((row) =>
        row.organization_id === organizationId && row.idempotency_key === idempotencyKey
      ) || null);
    }

    if (query.startsWith('SELECT id, organization_id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, result_temp_key, result_save_reference, result_mime_type, result_model, result_prompt_length, result_steps, result_seed, balance_after, error_code, error_message, created_at, updated_at, completed_at, expires_at FROM ai_usage_attempts WHERE id = ? LIMIT 1')) {
      const [attemptId] = bindings;
      return deepClone(this.state.aiUsageAttempts.find((row) => row.id === attemptId) || null);
    }

    if (query.startsWith("SELECT metadata_json FROM ai_usage_attempts WHERE id = ? AND status = 'succeeded' AND billing_status = 'finalized' LIMIT 1")) {
      const [attemptId] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === attemptId &&
        entry.status === 'succeeded' &&
        entry.billing_status === 'finalized'
      );
      return row ? { metadata_json: row.metadata_json || '{}' } : null;
    }

    if (query === "SELECT id FROM ai_usage_attempts WHERE result_temp_key = ? AND result_status = 'stored' LIMIT 1") {
      const [tempKey] = bindings;
      return deepClone(this.state.aiUsageAttempts.find((row) =>
        row.result_temp_key === tempKey && row.result_status === 'stored'
      ) || null);
    }

    if (query.startsWith('SELECT id, organization_id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, result_temp_key, result_save_reference, result_mime_type, result_model, result_prompt_length, result_steps, result_seed, balance_after, error_code, error_message, created_at, updated_at, completed_at, expires_at FROM ai_usage_attempts WHERE (? IS NULL OR status = ?)')) {
      const [
        statusFilter,
        statusValue,
        organizationFilter,
        organizationValue,
        userFilter,
        userValue,
        featureFilter,
        featureValue,
        cursorFilter,
        cursorUpdatedAtA,
        cursorUpdatedAtB,
        cursorId,
        limit,
      ] = bindings;
      const rows = this.state.aiUsageAttempts
        .filter((row) =>
          (statusFilter == null || row.status === statusValue) &&
          (organizationFilter == null || row.organization_id === organizationValue) &&
          (userFilter == null || row.user_id === userValue) &&
          (featureFilter == null || row.feature_key === featureValue) &&
          (cursorFilter == null || row.updated_at < cursorUpdatedAtA || (row.updated_at === cursorUpdatedAtB && row.id < cursorId))
        )
        .sort((a, b) =>
          String(b.updated_at || '').localeCompare(String(a.updated_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit));
      return { results: deepClone(rows) };
    }

    if (query.startsWith("SELECT id, organization_id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, result_temp_key, result_save_reference, result_mime_type, result_model, result_prompt_length, result_steps, result_seed, balance_after, error_code, error_message, created_at, updated_at, completed_at, expires_at FROM ai_usage_attempts WHERE expires_at <= ?")) {
      const [expiresAt, limit] = bindings;
      const eligible = this.state.aiUsageAttempts
        .filter((row) => String(row.expires_at || '') <= String(expiresAt || ''))
        .filter((row) =>
          (row.billing_status === 'reserved' && ['reserved', 'provider_running', 'provider_failed', 'finalizing'].includes(row.status)) ||
          (row.status === 'succeeded' && row.billing_status === 'finalized' && row.result_status === 'stored')
        )
        .sort((a, b) =>
          String(a.expires_at || '').localeCompare(String(b.expires_at || '')) ||
          String(a.updated_at || '').localeCompare(String(b.updated_at || '')) ||
          String(a.id || '').localeCompare(String(b.id || ''))
        )
        .slice(0, Number(limit));
      return { results: deepClone(eligible) };
    }

    if (query.startsWith("INSERT INTO ai_usage_attempts ( id, organization_id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, created_at, updated_at, expires_at, metadata_json ) SELECT")) {
      const [
        id,
        organizationId,
        userId,
        featureKey,
        operationKey,
        route,
        idempotencyKey,
        requestFingerprint,
        creditCost,
        quantity,
        createdAt,
        updatedAt,
        expiresAt,
        metadataJson,
        ledgerOrganizationId,
        reservationOrganizationId,
        reservationNow,
        requiredCredits,
      ] = bindings;
      const currentBalance = Number(latestCreditLedgerEntry(this.state.creditLedger, ledgerOrganizationId)?.balance_after || 0);
      const reservedCredits = activeAiUsageReservedCredits(this.state.aiUsageAttempts, reservationOrganizationId, reservationNow);
      if (currentBalance - reservedCredits < Number(requiredCredits)) {
        return { success: true, meta: { changes: 0 } };
      }
      if (this.state.aiUsageAttempts.some((row) =>
        row.id === id || (row.organization_id === organizationId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: ai_usage_attempts');
      }
      this.state.aiUsageAttempts.push({
        id,
        organization_id: organizationId,
        user_id: userId,
        feature_key: featureKey,
        operation_key: operationKey,
        route,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
        credit_cost: creditCost,
        quantity,
        status: 'reserved',
        provider_status: 'not_started',
        billing_status: 'reserved',
        result_status: 'none',
        result_temp_key: null,
        result_save_reference: null,
        result_mime_type: null,
        result_model: null,
        result_prompt_length: null,
        result_steps: null,
        result_seed: null,
        balance_after: null,
        error_code: null,
        error_message: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
        expires_at: expiresAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'reserved', provider_status = 'not_started', billing_status = 'reserved'")) {
      const [updatedAt, expiresAt, id, requestFingerprint, ledgerOrganizationId, reservationOrganizationId, reservationNow, excludeId, requiredCredits] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) => entry.id === id && entry.request_fingerprint === requestFingerprint);
      if (!row) return { success: true, meta: { changes: 0 } };
      const currentBalance = Number(latestCreditLedgerEntry(this.state.creditLedger, ledgerOrganizationId)?.balance_after || 0);
      const reservedCredits = activeAiUsageReservedCredits(this.state.aiUsageAttempts, reservationOrganizationId, reservationNow, { excludeId });
      if (currentBalance - reservedCredits < Number(requiredCredits)) {
        return { success: true, meta: { changes: 0 } };
      }
      Object.assign(row, {
        status: 'reserved',
        provider_status: 'not_started',
        billing_status: 'reserved',
        result_status: 'none',
        result_temp_key: null,
        result_save_reference: null,
        result_mime_type: null,
        result_model: null,
        result_prompt_length: null,
        result_steps: null,
        result_seed: null,
        balance_after: null,
        error_code: null,
        error_message: null,
        updated_at: updatedAt,
        completed_at: null,
        expires_at: expiresAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'provider_running', provider_status = 'running'")) {
      const [updatedAt, id] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id && entry.status === 'reserved' && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'provider_running';
      row.provider_status = 'running';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'provider_failed', provider_status = 'failed', billing_status = 'released'")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'provider_failed',
        provider_status: 'failed',
        billing_status: 'released',
        result_status: 'none',
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'finalizing', provider_status = 'succeeded'")) {
      const [updatedAt, id] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'finalizing';
      row.provider_status = 'succeeded';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'billing_failed', provider_status = 'succeeded', billing_status = 'failed'")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'billing_failed',
        provider_status: 'succeeded',
        billing_status: 'failed',
        result_status: 'none',
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'succeeded', provider_status = 'succeeded', billing_status = 'finalized'")) {
      const [
        resultStatus,
        tempKey,
        saveReference,
        mimeType,
        model,
        promptLength,
        steps,
        seed,
        balanceAfter,
        metadataJson,
        updatedAt,
        completedAt,
        id,
      ] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id && ['finalizing', 'succeeded'].includes(entry.status)
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'succeeded',
        provider_status: 'succeeded',
        billing_status: 'finalized',
        result_status: resultStatus,
        result_temp_key: tempKey,
        result_save_reference: saveReference,
        result_mime_type: mimeType,
        result_model: model,
        result_prompt_length: promptLength,
        result_steps: steps,
        result_seed: seed,
        balance_after: balanceAfter,
        metadata_json: metadataJson,
        error_code: null,
        error_message: null,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'expired', provider_status = CASE WHEN provider_status = 'failed' THEN 'failed' ELSE 'expired' END")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id, expiresAt] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id &&
        entry.billing_status === 'reserved' &&
        ['reserved', 'provider_running', 'provider_failed'].includes(entry.status) &&
        String(entry.expires_at || '') <= String(expiresAt || '')
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'expired',
        provider_status: row.provider_status === 'failed' ? 'failed' : 'expired',
        billing_status: 'released',
        result_status: 'none',
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET status = 'billing_failed', provider_status = 'succeeded', billing_status = 'failed', result_status = 'none', result_temp_key = NULL")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id, expiresAt] = bindings;
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id &&
        entry.status === 'finalizing' &&
        entry.billing_status === 'reserved' &&
        String(entry.expires_at || '') <= String(expiresAt || '')
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'billing_failed',
        provider_status: 'succeeded',
        billing_status: 'failed',
        result_status: 'none',
        result_temp_key: null,
        result_save_reference: null,
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE ai_usage_attempts SET result_status = 'expired', result_temp_key = NULL, result_save_reference = NULL")) {
      const [updatedAt, id] = bindings;
      let expectedTempKey = null;
      let expiresAt = bindings[2];
      if (bindings.length >= 5) {
        expectedTempKey = bindings[2];
        expiresAt = bindings[4];
      } else if (bindings.length >= 4) {
        expectedTempKey = bindings[2];
        expiresAt = bindings[3];
      }
      const row = this.state.aiUsageAttempts.find((entry) =>
        entry.id === id &&
        entry.status === 'succeeded' &&
        entry.billing_status === 'finalized' &&
        entry.result_status === 'stored' &&
        (expectedTempKey == null || entry.result_temp_key === expectedTempKey) &&
        String(entry.expires_at || '') <= String(expiresAt || '')
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.result_status = 'expired';
      row.result_temp_key = null;
      row.result_save_reference = null;
      row.metadata_json = '{}';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, result_temp_key, result_save_reference, result_mime_type, result_model, result_prompt_length, result_steps, result_seed, balance_after, error_code, error_message, created_at, updated_at, completed_at, expires_at, metadata_json FROM member_ai_usage_attempts WHERE user_id = ? AND idempotency_key = ?')) {
      const [userId, idempotencyKey] = bindings;
      return deepClone(this.state.memberAiUsageAttempts.find((row) =>
        row.user_id === userId && row.idempotency_key === idempotencyKey
      ) || null);
    }

    if (query.startsWith('SELECT id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, result_temp_key, result_save_reference, result_mime_type, result_model, result_prompt_length, result_steps, result_seed, balance_after, error_code, error_message, created_at, updated_at, completed_at, expires_at, metadata_json FROM member_ai_usage_attempts WHERE id = ? LIMIT 1')) {
      const [attemptId] = bindings;
      return deepClone(this.state.memberAiUsageAttempts.find((row) => row.id === attemptId) || null);
    }

    if (query.startsWith("SELECT id FROM member_ai_usage_attempts WHERE result_temp_key = ? AND result_status = 'stored' LIMIT 1")) {
      const [tempKey] = bindings;
      return deepClone(this.state.memberAiUsageAttempts.find((row) =>
        row.result_temp_key === tempKey && row.result_status === 'stored'
      ) || null);
    }

    if (query.startsWith("INSERT INTO member_ai_usage_attempts ( id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, created_at, updated_at, expires_at, metadata_json ) SELECT")) {
      const [
        id,
        userId,
        featureKey,
        operationKey,
        route,
        idempotencyKey,
        requestFingerprint,
        creditCost,
        quantity,
        createdAt,
        updatedAt,
        expiresAt,
        metadataJson,
        ledgerUserId,
        reservationUserId,
        reservationNow,
        requiredCredits,
      ] = bindings;
      const currentBalance = Number(latestMemberCreditLedgerEntry(this.state.memberCreditLedger, ledgerUserId)?.balance_after || 0);
      const reservedCredits = activeMemberAiUsageReservedCredits(this.state.memberAiUsageAttempts, reservationUserId, reservationNow);
      if (currentBalance - reservedCredits < Number(requiredCredits)) {
        return { success: true, meta: { changes: 0 } };
      }
      if (this.state.memberAiUsageAttempts.some((row) =>
        row.id === id || (row.user_id === userId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: member_ai_usage_attempts');
      }
      this.state.memberAiUsageAttempts.push({
        id,
        user_id: userId,
        feature_key: featureKey,
        operation_key: operationKey,
        route,
        idempotency_key: idempotencyKey,
        request_fingerprint: requestFingerprint,
        credit_cost: creditCost,
        quantity,
        status: 'reserved',
        provider_status: 'not_started',
        billing_status: 'reserved',
        result_status: 'none',
        result_temp_key: null,
        result_save_reference: null,
        result_mime_type: null,
        result_model: null,
        result_prompt_length: null,
        result_steps: null,
        result_seed: null,
        balance_after: null,
        error_code: null,
        error_message: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
        expires_at: expiresAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'reserved', provider_status = 'not_started', billing_status = 'reserved'")) {
      const [updatedAt, expiresAt, id, requestFingerprint, ledgerUserId, reservationUserId, reservationNow, excludeId, requiredCredits] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) => entry.id === id && entry.request_fingerprint === requestFingerprint);
      if (!row) return { success: true, meta: { changes: 0 } };
      const currentBalance = Number(latestMemberCreditLedgerEntry(this.state.memberCreditLedger, ledgerUserId)?.balance_after || 0);
      const reservedCredits = activeMemberAiUsageReservedCredits(this.state.memberAiUsageAttempts, reservationUserId, reservationNow, { excludeId });
      if (currentBalance - reservedCredits < Number(requiredCredits)) {
        return { success: true, meta: { changes: 0 } };
      }
      Object.assign(row, {
        status: 'reserved',
        provider_status: 'not_started',
        billing_status: 'reserved',
        result_status: 'none',
        result_temp_key: null,
        result_save_reference: null,
        result_mime_type: null,
        result_model: null,
        result_prompt_length: null,
        result_steps: null,
        result_seed: null,
        balance_after: null,
        error_code: null,
        error_message: null,
        updated_at: updatedAt,
        completed_at: null,
        expires_at: expiresAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'provider_running', provider_status = 'running'")) {
      const [updatedAt, id] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id && entry.status === 'reserved' && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'provider_running';
      row.provider_status = 'running';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'provider_failed', provider_status = 'failed', billing_status = 'released'")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'provider_failed',
        provider_status: 'failed',
        billing_status: 'released',
        result_status: 'none',
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'finalizing', provider_status = 'succeeded'")) {
      const [updatedAt, id] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'finalizing';
      row.provider_status = 'succeeded';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'billing_failed', provider_status = 'succeeded', billing_status = 'failed'")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id && entry.billing_status === 'reserved'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'billing_failed',
        provider_status: 'succeeded',
        billing_status: 'failed',
        result_status: 'none',
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'succeeded', provider_status = 'succeeded', billing_status = 'finalized'")) {
      const [
        resultStatus,
        tempKey,
        saveReference,
        mimeType,
        model,
        promptLength,
        steps,
        seed,
        balanceAfter,
        metadataJson,
        updatedAt,
        completedAt,
        id,
      ] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id && ['finalizing', 'succeeded'].includes(entry.status)
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'succeeded',
        provider_status: 'succeeded',
        billing_status: 'finalized',
        result_status: resultStatus,
        result_temp_key: tempKey,
        result_save_reference: saveReference,
        result_mime_type: mimeType,
        result_model: model,
        result_prompt_length: promptLength,
        result_steps: steps,
        result_seed: seed,
        balance_after: balanceAfter,
        metadata_json: metadataJson,
        error_code: null,
        error_message: null,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET metadata_json = ?, updated_at = ? WHERE id = ?")) {
      const [metadataJson, updatedAt, id] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) => entry.id === id);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.metadata_json = metadataJson;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE member_ai_usage_attempts SET result_status = ?, result_temp_key = NULL, result_save_reference = NULL')) {
      const [resultStatus, metadataJson, errorCode, errorMessage, updatedAt, id] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id && entry.status === 'succeeded' && entry.billing_status === 'finalized'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        result_status: resultStatus,
        result_temp_key: null,
        result_save_reference: null,
        metadata_json: metadataJson,
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, user_id, feature_key, operation_key, route, idempotency_key, request_fingerprint, credit_cost, quantity, status, provider_status, billing_status, result_status, result_temp_key, result_save_reference, result_mime_type, result_model, result_prompt_length, result_steps, result_seed, balance_after, error_code, error_message, created_at, updated_at, completed_at, expires_at, metadata_json FROM member_ai_usage_attempts WHERE expires_at <= ?')) {
      const [expiresAt, limit] = bindings;
      const rows = this.state.memberAiUsageAttempts
        .filter((row) =>
          String(row.expires_at || '') <= String(expiresAt || '') &&
          (
            (row.billing_status === 'reserved' && ['reserved', 'provider_running', 'provider_failed', 'finalizing'].includes(row.status)) ||
            (row.status === 'succeeded' && row.billing_status === 'finalized' && row.result_status === 'stored')
          )
        )
        .sort((a, b) =>
          String(a.expires_at).localeCompare(String(b.expires_at)) ||
          String(a.updated_at).localeCompare(String(b.updated_at)) ||
          String(a.id).localeCompare(String(b.id))
        )
        .slice(0, Number(limit || 25));
      return { results: deepClone(rows) };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'expired', provider_status = CASE WHEN provider_status = 'failed' THEN 'failed' ELSE 'expired' END")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id, expiresAt] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id &&
        entry.billing_status === 'reserved' &&
        ['reserved', 'provider_running', 'provider_failed'].includes(entry.status) &&
        String(entry.expires_at || '') <= String(expiresAt || '')
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'expired',
        provider_status: row.provider_status === 'failed' ? 'failed' : 'expired',
        billing_status: 'released',
        result_status: 'none',
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET status = 'billing_failed', provider_status = 'succeeded', billing_status = 'failed', result_status = 'none', result_temp_key = NULL")) {
      const [errorCode, errorMessage, updatedAt, completedAt, id, expiresAt] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id &&
        entry.status === 'finalizing' &&
        entry.billing_status === 'reserved' &&
        String(entry.expires_at || '') <= String(expiresAt || '')
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, {
        status: 'billing_failed',
        provider_status: 'succeeded',
        billing_status: 'failed',
        result_status: 'none',
        result_temp_key: null,
        result_save_reference: null,
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE member_ai_usage_attempts SET result_status = 'expired', result_temp_key = NULL, result_save_reference = NULL")) {
      const [metadataJson, updatedAt, id, expectedTempKey, , expiresAt] = bindings;
      const row = this.state.memberAiUsageAttempts.find((entry) =>
        entry.id === id &&
        entry.status === 'succeeded' &&
        entry.billing_status === 'finalized' &&
        entry.result_status === 'stored' &&
        (expectedTempKey == null || entry.result_temp_key === expectedTempKey) &&
        String(entry.expires_at || '') <= String(expiresAt || '')
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.result_status = 'expired';
      row.result_temp_key = null;
      row.result_save_reference = null;
      row.metadata_json = metadataJson;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO credit_ledger ( id, organization_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json ) VALUES')) {
      const [
        id,
        organizationId,
        amount,
        balanceAfter,
        entryType,
        featureKey,
        source,
        idempotencyKey,
        requestHash,
        createdByUserId,
        createdAt,
        metadataJson,
      ] = bindings;
      if (this.state.creditLedger.some((row) =>
        row.id === id || (row.organization_id === organizationId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: credit_ledger');
      }
      this.state.creditLedger.push({
        id,
        organization_id: organizationId,
        amount,
        balance_after: balanceAfter,
        entry_type: entryType,
        feature_key: featureKey,
        source,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        created_by_user_id: createdByUserId,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO credit_ledger ( id, organization_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json ) SELECT')) {
      const [
        id,
        organizationId,
        amount,
        creditAmount,
        entryType,
        featureKey,
        source,
        idempotencyKey,
        requestHash,
        createdByUserId,
        createdAt,
        metadataJson,
        lookupOrganizationId,
        requiredCredits,
      ] = bindings;
      const latest = latestCreditLedgerEntry(this.state.creditLedger, lookupOrganizationId);
      const currentBalance = Number(latest?.balance_after || 0);
      if (currentBalance < Number(requiredCredits)) {
        return { success: true, meta: { changes: 0 } };
      }
      if (this.state.creditLedger.some((row) =>
        row.id === id || (row.organization_id === organizationId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: credit_ledger');
      }
      this.state.creditLedger.push({
        id,
        organization_id: organizationId,
        amount,
        balance_after: currentBalance - Number(creditAmount),
        entry_type: entryType,
        feature_key: featureKey,
        source,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        created_by_user_id: createdByUserId,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO usage_events ( id, organization_id, user_id, feature_key, quantity, credits_delta, credit_ledger_id, idempotency_key, request_hash, status, created_at, metadata_json ) VALUES')) {
      if (this.failUsageEventInsert) {
        throw new Error('simulated usage_events insert failure');
      }
      const [
        id,
        organizationId,
        userId,
        featureKey,
        quantity,
        creditsDelta,
        creditLedgerId,
        idempotencyKey,
        requestHash,
        status,
        createdAt,
        metadataJson,
      ] = bindings;
      if (this.state.usageEvents.some((row) =>
        row.id === id || (row.organization_id === organizationId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: usage_events');
      }
      this.state.usageEvents.push({
        id,
        organization_id: organizationId,
        user_id: userId,
        feature_key: featureKey,
        quantity,
        credits_delta: creditsDelta,
        credit_ledger_id: creditLedgerId,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        status,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO usage_events ( id, organization_id, user_id, feature_key, quantity, credits_delta, credit_ledger_id, idempotency_key, request_hash, status, created_at, metadata_json ) SELECT')) {
      if (this.failUsageEventInsert) {
        throw new Error('simulated usage_events insert failure');
      }
      const [
        id,
        organizationId,
        userId,
        featureKey,
        quantity,
        creditsDelta,
        creditLedgerId,
        idempotencyKey,
        requestHash,
        status,
        createdAt,
        metadataJson,
        lookupCreditLedgerId,
      ] = bindings;
      if (!this.state.creditLedger.some((row) => row.id === lookupCreditLedgerId)) {
        return { success: true, meta: { changes: 0 } };
      }
      if (this.state.usageEvents.some((row) =>
        row.id === id || (row.organization_id === organizationId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: usage_events');
      }
      this.state.usageEvents.push({
        id,
        organization_id: organizationId,
        user_id: userId,
        feature_key: featureKey,
        quantity,
        credits_delta: creditsDelta,
        credit_ledger_id: creditLedgerId,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        status,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, organization_id, user_id, feature_key, quantity, credits_delta, credit_ledger_id, status, created_at FROM usage_events WHERE organization_id = ?')) {
      const [organizationId, limit] = bindings;
      const rows = this.state.usageEvents
        .filter((row) => row.organization_id === organizationId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
        .slice(0, Number(limit));
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT balance_after FROM member_credit_ledger WHERE user_id = ?')) {
      const [userId] = bindings;
      const latest = latestMemberCreditLedgerEntry(this.state.memberCreditLedger, userId);
      return latest ? { balance_after: latest.balance_after } : null;
    }

    if (query.startsWith('SELECT COALESCE(SUM(amount), 0) AS credits FROM member_credit_ledger WHERE user_id = ? AND amount > 0')) {
      const [userId] = bindings;
      const credits = this.state.memberCreditLedger
        .filter((row) => row.user_id === userId && Number(row.amount || 0) > 0)
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return { credits };
    }

    if (query.startsWith("SELECT COALESCE(SUM(amount), 0) AS credits FROM member_credit_ledger WHERE user_id = ? AND source = 'daily_member_top_up'")) {
      const [userId] = bindings;
      const credits = this.state.memberCreditLedger
        .filter((row) => row.user_id === userId && row.source === 'daily_member_top_up')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return { credits };
    }

    if (query.startsWith("SELECT COALESCE(SUM(amount), 0) AS credits FROM member_credit_ledger WHERE user_id = ? AND entry_type = 'grant' AND source = 'manual_admin_grant'")) {
      const [userId] = bindings;
      const credits = this.state.memberCreditLedger
        .filter((row) => row.user_id === userId && row.entry_type === 'grant' && row.source === 'manual_admin_grant')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return { credits };
    }

    if (query.startsWith("SELECT COALESCE(SUM(ABS(amount)), 0) AS credits FROM member_credit_ledger WHERE user_id = ? AND entry_type IN ('consume', 'debit')")) {
      const [userId] = bindings;
      const credits = this.state.memberCreditLedger
        .filter((row) => row.user_id === userId && ['consume', 'debit'].includes(row.entry_type))
        .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);
      return { credits };
    }

    if (query.startsWith('SELECT l.id, l.user_id, l.amount, l.balance_after, l.entry_type, l.feature_key, l.source, l.created_by_user_id, actor.email AS created_by_email')) {
      const [userId, limit] = bindings;
      const rows = this.state.memberCreditLedger
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.user_id === userId)
        .sort((a, b) => (
          String(b.row.created_at || '').localeCompare(String(a.row.created_at || '')) ||
          b.index - a.index
        ))
        .slice(0, Number(limit))
        .map(({ row }) => {
          const usage = this.state.memberUsageEvents.find((entry) =>
            entry.credit_ledger_id === row.id && entry.user_id === row.user_id
          );
          const actor = this.state.users.find((entry) => entry.id === row.created_by_user_id);
          return {
            ...deepClone(row),
            created_by_email: actor?.email || null,
            usage_id: usage?.id || null,
            usage_feature_key: usage?.feature_key || null,
            quantity: usage?.quantity ?? null,
            credits_delta: usage?.credits_delta ?? null,
            usage_status: usage?.status || null,
            usage_metadata_json: usage?.metadata_json || null,
          };
        });
      return { results: rows };
    }

    if (query.startsWith('SELECT id, user_id, amount, balance_after, entry_type, feature_key, source, request_hash, created_by_user_id, created_at FROM member_credit_ledger WHERE user_id = ? AND idempotency_key = ?')) {
      const [userId, idempotencyKey] = bindings;
      return deepClone(this.state.memberCreditLedger.find((row) =>
        row.user_id === userId && row.idempotency_key === idempotencyKey
      ) || null);
    }

    if (query.startsWith('SELECT id, user_id, feature_key, quantity, credits_delta, credit_ledger_id, request_hash, status, created_at FROM member_usage_events WHERE user_id = ? AND idempotency_key = ?')) {
      const [userId, idempotencyKey] = bindings;
      return deepClone(this.state.memberUsageEvents.find((row) =>
        row.user_id === userId && row.idempotency_key === idempotencyKey
      ) || null);
    }

    if (query.startsWith('INSERT INTO member_credit_ledger ( id, user_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json ) SELECT') && query.includes('CASE WHEN latest.balance_after <')) {
      const [
        id,
        userId,
        allowanceForAmount,
        allowanceForDelta,
        allowanceForBalance,
        allowanceBalanceAfter,
        entryType,
        featureKey,
        source,
        idempotencyKey,
        requestHash,
        createdByUserId,
        createdAt,
        metadataJson,
        lookupUserId,
      ] = bindings;
      if (this.state.memberCreditLedger.some((row) =>
        row.id === id || (row.user_id === userId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: member_credit_ledger');
      }
      const latest = latestMemberCreditLedgerEntry(this.state.memberCreditLedger, lookupUserId);
      const currentBalance = Number(latest?.balance_after || 0);
      const amount = currentBalance < Number(allowanceForAmount)
        ? Number(allowanceForDelta) - currentBalance
        : 0;
      const balanceAfter = currentBalance < Number(allowanceForBalance)
        ? Number(allowanceBalanceAfter)
        : currentBalance;
      this.state.memberCreditLedger.push({
        id,
        user_id: userId,
        amount,
        balance_after: balanceAfter,
        entry_type: entryType,
        feature_key: featureKey,
        source,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        created_by_user_id: createdByUserId,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO member_credit_ledger ( id, user_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json ) VALUES')) {
      const [
        id,
        userId,
        amount,
        balanceAfter,
        entryType,
        featureKey,
        source,
        idempotencyKey,
        requestHash,
        createdByUserId,
        createdAt,
        metadataJson,
      ] = bindings;
      if (this.state.memberCreditLedger.some((row) =>
        row.id === id || (row.user_id === userId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: member_credit_ledger');
      }
      this.state.memberCreditLedger.push({
        id,
        user_id: userId,
        amount,
        balance_after: balanceAfter,
        entry_type: entryType,
        feature_key: featureKey,
        source,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        created_by_user_id: createdByUserId,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO member_credit_ledger ( id, user_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json ) SELECT')) {
      const [
        id,
        userId,
        amount,
        creditAmount,
        entryType,
        featureKey,
        source,
        idempotencyKey,
        requestHash,
        createdByUserId,
        createdAt,
        metadataJson,
        lookupUserId,
        requiredCredits,
      ] = bindings;
      const latest = latestMemberCreditLedgerEntry(this.state.memberCreditLedger, lookupUserId);
      const currentBalance = Number(latest?.balance_after || 0);
      if (currentBalance < Number(requiredCredits)) {
        return { success: true, meta: { changes: 0 } };
      }
      if (this.state.memberCreditLedger.some((row) =>
        row.id === id || (idempotencyKey && row.user_id === userId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: member_credit_ledger');
      }
      this.state.memberCreditLedger.push({
        id,
        user_id: userId,
        amount,
        balance_after: currentBalance - Number(creditAmount),
        entry_type: entryType,
        feature_key: featureKey,
        source,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        created_by_user_id: createdByUserId,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO member_usage_events ( id, user_id, feature_key, quantity, credits_delta, credit_ledger_id, idempotency_key, request_hash, status, created_at, metadata_json ) SELECT')) {
      const [
        id,
        userId,
        featureKey,
        quantity,
        creditsDelta,
        creditLedgerId,
        idempotencyKey,
        requestHash,
        status,
        createdAt,
        metadataJson,
        lookupCreditLedgerId,
      ] = bindings;
      if (!this.state.memberCreditLedger.some((row) => row.id === lookupCreditLedgerId)) {
        return { success: true, meta: { changes: 0 } };
      }
      if (this.state.memberUsageEvents.some((row) =>
        row.id === id || (idempotencyKey && row.user_id === userId && row.idempotency_key === idempotencyKey)
      )) {
        throw new Error('UNIQUE constraint failed: member_usage_events');
      }
      this.state.memberUsageEvents.push({
        id,
        user_id: userId,
        feature_key: featureKey,
        quantity,
        credits_delta: creditsDelta,
        credit_ledger_id: creditLedgerId,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        status,
        created_at: createdAt,
        metadata_json: metadataJson,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, user_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, request_hash, created_by_user_id, created_at, metadata_json FROM member_credit_ledger WHERE user_id = ? ORDER BY created_at ASC')) {
      const [userId] = bindings;
      const rows = this.state.memberCreditLedger
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.user_id === userId)
        .sort((a, b) => String(a.row.created_at || '').localeCompare(String(b.row.created_at || '')) || a.index - b.index)
        .map(({ row }) => deepClone(row));
      return { results: rows };
    }

    if (query.startsWith('SELECT id, user_id, bucket_type, balance, local_subscription_id, provider_subscription_id, period_start, period_end, source, metadata_json, created_at, updated_at FROM member_credit_buckets WHERE user_id = ?')) {
      if (query.includes("AND bucket_type = 'subscription'")) {
        const [userId, providerSubscriptionId, periodStart] = bindings;
        return deepClone(this.state.memberCreditBuckets.find((row) =>
          row.user_id === userId &&
          row.bucket_type === 'subscription' &&
          row.provider_subscription_id === providerSubscriptionId &&
          row.period_start === periodStart
        ) || null);
      }
      if (query.includes('AND bucket_type = ?')) {
        const [userId, bucketType] = bindings;
        return deepClone(this.state.memberCreditBuckets.find((row) =>
          row.user_id === userId && row.bucket_type === bucketType
        ) || null);
      }
      const [userId] = bindings;
      const rows = this.state.memberCreditBuckets
        .filter((row) => row.user_id === userId)
        .sort((a, b) => {
          const order = { subscription: 0, legacy_or_bonus: 1, purchased: 2 };
          return (order[a.bucket_type] ?? 3) - (order[b.bucket_type] ?? 3)
            || String(b.period_start || '').localeCompare(String(a.period_start || ''))
            || String(a.created_at || '').localeCompare(String(b.created_at || ''))
            || String(a.id || '').localeCompare(String(b.id || ''));
        });
      return { results: deepClone(rows) };
    }

    if (query.startsWith('INSERT OR IGNORE INTO member_credit_buckets')) {
      const [
        id,
        userId,
        bucketType,
        balance,
        localSubscriptionId,
        providerSubscriptionId,
        periodStart,
        periodEnd,
        source,
        metadataJson,
        createdAt,
        updatedAt,
      ] = bindings;
      const exists = this.state.memberCreditBuckets.some((row) => {
        if (row.id === id) return true;
        if (bucketType === 'purchased' || bucketType === 'legacy_or_bonus') {
          return row.user_id === userId && row.bucket_type === bucketType;
        }
        return row.user_id === userId &&
          row.bucket_type === 'subscription' &&
          row.provider_subscription_id === providerSubscriptionId &&
          row.period_start === periodStart;
      });
      if (exists) return { success: true, meta: { changes: 0 } };
      this.state.memberCreditBuckets.push({
        id,
        user_id: userId,
        bucket_type: bucketType,
        balance: Number(balance || 0),
        local_subscription_id: localSubscriptionId,
        provider_subscription_id: providerSubscriptionId,
        period_start: periodStart,
        period_end: periodEnd,
        source,
        metadata_json: metadataJson,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE member_credit_buckets SET balance = balance + ?')) {
      if (query.includes('updated_at = ? WHERE id = ? AND user_id = ?') && !query.includes('local_subscription_id')) {
        const [amount, updatedAt, id, userId] = bindings;
        const row = this.state.memberCreditBuckets.find((entry) => entry.id === id && entry.user_id === userId);
        if (!row) return { success: true, meta: { changes: 0 } };
        row.balance = Number(row.balance || 0) + Number(amount || 0);
        row.updated_at = updatedAt;
        return { success: true, meta: { changes: 1 } };
      }
      const [amount, localSubscriptionId, providerSubscriptionId, periodStart, periodEnd, source, updatedAt, id, userId] = bindings;
      const row = this.state.memberCreditBuckets.find((entry) => entry.id === id && entry.user_id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.balance = Number(row.balance || 0) + Number(amount || 0);
      row.local_subscription_id = localSubscriptionId || row.local_subscription_id;
      row.provider_subscription_id = providerSubscriptionId || row.provider_subscription_id;
      row.period_start = periodStart || row.period_start;
      row.period_end = periodEnd || row.period_end;
      row.source = source || row.source;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE member_credit_buckets SET balance = balance - ?')) {
      const [amount, updatedAt, id, userId, minBalance] = bindings;
      const row = this.state.memberCreditBuckets.find((entry) => entry.id === id && entry.user_id === userId);
      if (!row || Number(row.balance || 0) < Number(minBalance || amount || 0)) {
        return { success: true, meta: { changes: 0 } };
      }
      row.balance = Number(row.balance || 0) - Number(amount || 0);
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT OR IGNORE INTO member_credit_bucket_events') || query.startsWith('INSERT INTO member_credit_bucket_events')) {
      const [
        id,
        userId,
        bucketIdValue,
        bucketType,
        amount,
        balanceAfter,
        memberCreditLedgerId,
        source,
        idempotencyKey,
        metadataJson,
        createdAt,
      ] = bindings;
      const exists = this.state.memberCreditBucketEvents.some((row) =>
        row.id === id || (idempotencyKey && row.bucket_id === bucketIdValue && row.idempotency_key === idempotencyKey)
      );
      if (exists) {
        if (query.startsWith('INSERT OR IGNORE')) return { success: true, meta: { changes: 0 } };
        throw new Error('UNIQUE constraint failed: member_credit_bucket_events');
      }
      this.state.memberCreditBucketEvents.push({
        id,
        user_id: userId,
        bucket_id: bucketIdValue,
        bucket_type: bucketType,
        amount: Number(amount || 0),
        balance_after: Number(balanceAfter || 0),
        member_credit_ledger_id: memberCreditLedgerId,
        source,
        idempotency_key: idempotencyKey,
        metadata_json: metadataJson,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, user_id, provider, provider_mode, provider_customer_id, provider_subscription_id, provider_price_id, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, metadata_json, created_at, updated_at FROM billing_member_subscriptions')) {
      if (query.includes("provider_subscription_id = ?") && !query.includes('WHERE user_id = ?')) {
        const [subscriptionId] = bindings;
        return deepClone(this.state.billingMemberSubscriptions.find((row) =>
          row.provider === 'stripe' &&
          row.provider_mode === 'live' &&
          row.provider_subscription_id === subscriptionId
        ) || null);
      }
      if (query.includes("status IN ('active', 'trialing')")) {
        const [userId, now] = bindings;
        const rows = this.state.billingMemberSubscriptions
          .filter((row) =>
            row.user_id === userId &&
            ['active', 'trialing'].includes(row.status) &&
            row.current_period_end &&
            row.current_period_end > now
          )
          .sort((a, b) => String(b.current_period_end || '').localeCompare(String(a.current_period_end || '')) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        return deepClone(rows[0] || null);
      }
      if (query.includes('WHERE user_id = ?')) {
        const [userId] = bindings;
        const rows = this.state.billingMemberSubscriptions
          .filter((row) => row.user_id === userId)
          .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
        return deepClone(rows[0] || null);
      }
    }

    if (query.startsWith('INSERT INTO billing_member_subscriptions')) {
      const [
        id,
        userId,
        customerId,
        subscriptionId,
        priceId,
        status,
        periodStart,
        periodEnd,
        cancelAtPeriodEnd,
        canceledAt,
        metadataJson,
        createdAt,
        updatedAt,
      ] = bindings;
      let row = this.state.billingMemberSubscriptions.find((entry) =>
        entry.provider === 'stripe' &&
        entry.provider_mode === 'live' &&
        entry.provider_subscription_id === subscriptionId
      );
      if (!row) {
        row = {
          id,
          user_id: userId,
          provider: 'stripe',
          provider_mode: 'live',
          provider_customer_id: customerId,
          provider_subscription_id: subscriptionId,
          provider_price_id: priceId,
          status,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: cancelAtPeriodEnd,
          canceled_at: canceledAt,
          metadata_json: metadataJson,
          created_at: createdAt,
          updated_at: updatedAt,
        };
        this.state.billingMemberSubscriptions.push(row);
      } else {
        row.user_id = userId;
        row.provider_customer_id = customerId || row.provider_customer_id;
        row.provider_price_id = priceId || row.provider_price_id;
        row.status = status;
        row.current_period_start = periodStart || row.current_period_start;
        row.current_period_end = periodEnd || row.current_period_end;
        row.cancel_at_period_end = cancelAtPeriodEnd;
        row.canceled_at = canceledAt || row.canceled_at;
        row.metadata_json = metadataJson;
        row.updated_at = updatedAt;
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT COALESCE(SUM(credit_cost), 0) AS reserved_credits')) {
      const [organizationId, now] = bindings;
      const reservedCredits = this.state.aiUsageAttempts
        .filter((row) =>
          row.organization_id === organizationId &&
          row.billing_status === 'reserved' &&
          String(row.expires_at || '') > String(now || '')
        )
        .reduce((sum, row) => sum + Number(row.credit_cost || 0), 0);
      return { reserved_credits: reservedCredits };
    }

    if (query.startsWith('SELECT COALESCE(SUM(credits), 0) AS credits')) {
      const [organizationId] = bindings;
      const credits = this.state.billingCheckoutSessions
        .filter((row) =>
          row.organization_id === organizationId &&
          row.provider === 'stripe' &&
          row.provider_mode === 'live' &&
          row.status === 'completed' &&
          row.credit_ledger_entry_id != null
        )
        .reduce((sum, row) => sum + Number(row.credits || 0), 0);
      return { credits };
    }

    if (query.startsWith("SELECT COALESCE(SUM(amount), 0) AS credits") && query.includes("source <> 'stripe_live_checkout'")) {
      const [organizationId] = bindings;
      const credits = this.state.creditLedger
        .filter((row) =>
          row.organization_id === organizationId &&
          row.entry_type === 'grant' &&
          row.source !== 'stripe_live_checkout'
        )
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return { credits };
    }

    if (query.startsWith("SELECT COALESCE(SUM(ABS(amount)), 0) AS credits")) {
      const [organizationId] = bindings;
      const credits = this.state.creditLedger
        .filter((row) =>
          row.organization_id === organizationId &&
          (row.entry_type === 'consume' || row.entry_type === 'debit')
        )
        .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);
      return { credits };
    }

    if (query.startsWith('SELECT id, name, slug, status, created_at, updated_at FROM organizations WHERE id = ?')) {
      const [organizationId] = bindings;
      const row = this.state.organizations.find((entry) => entry.id === organizationId);
      return row ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      } : null;
    }

    if (query.startsWith('SELECT om.role, om.status, o.status AS organization_status')) {
      const [organizationId, userId] = bindings;
      const membership = this.state.organizationMemberships.find((row) =>
        row.organization_id === organizationId && row.user_id === userId
      );
      const organization = this.state.organizations.find((row) => row.id === organizationId);
      return membership && organization ? {
        role: membership.role,
        status: membership.status,
        organization_status: organization.status,
      } : null;
    }

    if (query.startsWith('SELECT id, provider, provider_mode, provider_checkout_session_id, provider_subscription_id, user_id, plan_id, provider_price_id, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, billing_event_id, authorization_scope')) {
      if (query.includes('WHERE user_id = ? AND idempotency_key_hash = ?')) {
        const [userId, idempotencyKeyHash] = bindings;
        return deepClone(this.state.billingMemberSubscriptionCheckoutSessions.find((row) =>
          row.user_id === userId &&
          row.idempotency_key_hash === idempotencyKeyHash
        ) || null);
      }
      if (query.includes("WHERE provider = 'stripe' AND provider_checkout_session_id = ?")) {
        const [sessionId] = bindings;
        return deepClone(this.state.billingMemberSubscriptionCheckoutSessions.find((row) =>
          row.provider === 'stripe' && row.provider_checkout_session_id === sessionId
        ) || null);
      }
    }

    if (query.startsWith('INSERT INTO billing_member_subscription_checkout_sessions')) {
      const [
        id,
        provider,
        providerMode,
        checkoutSessionId,
        subscriptionId,
        userId,
        planId,
        priceId,
        amountCents,
        currency,
        status,
        idempotencyKeyHash,
        requestFingerprintHash,
        checkoutUrl,
        customerId,
        authorizationScope,
        paymentStatus,
        metadataJson,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.state.billingMemberSubscriptionCheckoutSessions.some((row) =>
        row.id === id ||
        (checkoutSessionId != null && row.provider === provider && row.provider_checkout_session_id === checkoutSessionId) ||
        (row.user_id === userId && row.idempotency_key_hash === idempotencyKeyHash)
      )) {
        throw new Error('UNIQUE constraint failed: billing_member_subscription_checkout_sessions');
      }
      this.state.billingMemberSubscriptionCheckoutSessions.push({
        id,
        provider,
        provider_mode: providerMode,
        provider_checkout_session_id: checkoutSessionId,
        provider_subscription_id: subscriptionId,
        user_id: userId,
        plan_id: planId,
        provider_price_id: priceId,
        amount_cents: amountCents,
        currency,
        status,
        idempotency_key_hash: idempotencyKeyHash,
        request_fingerprint_hash: requestFingerprintHash,
        checkout_url: checkoutUrl,
        provider_customer_id: customerId,
        billing_event_id: null,
        authorization_scope: authorizationScope,
        payment_status: paymentStatus,
        error_code: null,
        error_message: null,
        metadata_json: metadataJson,
        failed_at: null,
        expired_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE billing_member_subscription_checkout_sessions SET provider_checkout_session_id = ?')) {
      const [sessionId, subscriptionId, customerId, checkoutUrl, paymentStatus, updatedAt, id] = bindings;
      const row = this.state.billingMemberSubscriptionCheckoutSessions.find((entry) =>
        entry.id === id && entry.provider === 'stripe' && entry.provider_mode === 'live'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.provider_checkout_session_id = sessionId;
      row.provider_subscription_id = subscriptionId || row.provider_subscription_id;
      row.provider_customer_id = customerId || row.provider_customer_id;
      row.checkout_url = checkoutUrl;
      row.payment_status = paymentStatus || row.payment_status;
      row.error_code = null;
      row.error_message = null;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE billing_member_subscription_checkout_sessions SET status = 'failed'")) {
      const [errorCode, errorMessage, updatedAt, failedAt, id] = bindings;
      const row = this.state.billingMemberSubscriptionCheckoutSessions.find((entry) => entry.id === id);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'failed';
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.updated_at = updatedAt;
      row.failed_at = row.failed_at || failedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE billing_member_subscription_checkout_sessions SET status = 'completed'")) {
      const [subscriptionId, customerId, billingEventId, paymentStatus, updatedAt, completedAt, sessionId] = bindings;
      const row = this.state.billingMemberSubscriptionCheckoutSessions.find((entry) =>
        entry.provider === 'stripe' && entry.provider_checkout_session_id === sessionId
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'completed';
      row.provider_subscription_id = subscriptionId || row.provider_subscription_id;
      row.provider_customer_id = customerId || row.provider_customer_id;
      row.billing_event_id = billingEventId || row.billing_event_id;
      row.payment_status = paymentStatus || row.payment_status;
      row.error_code = null;
      row.error_message = null;
      row.updated_at = updatedAt;
      row.completed_at = row.completed_at || completedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, billing_event_id, member_credit_ledger_entry_id, authorization_scope')) {
      if (query.includes('WHERE user_id = ? AND idempotency_key_hash = ?')) {
        const [userId, idempotencyKeyHash] = bindings;
        return deepClone(this.state.billingMemberCheckoutSessions.find((row) =>
          row.user_id === userId &&
          row.idempotency_key_hash === idempotencyKeyHash
        ) || null);
      }
      if (query.includes("WHERE provider = 'stripe' AND provider_checkout_session_id = ?")) {
        const [sessionId] = bindings;
        return deepClone(this.state.billingMemberCheckoutSessions.find((row) =>
          row.provider === 'stripe' && row.provider_checkout_session_id === sessionId
        ) || null);
      }
      if (query.includes('WHERE user_id = ?') && query.includes("provider_mode = 'live'")) {
        const [userId, limit] = bindings;
        const rows = this.state.billingMemberCheckoutSessions
          .filter((row) =>
            row.user_id === userId &&
            row.provider === 'stripe' &&
            row.provider_mode === 'live'
          )
          .sort((a, b) =>
            String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
            String(b.id || '').localeCompare(String(a.id || ''))
          )
          .slice(0, Number(limit));
        return { results: deepClone(rows) };
      }
    }

    if (query.startsWith('INSERT INTO billing_member_checkout_sessions ( id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, authorization_scope, payment_status, metadata_json, created_at, updated_at ) VALUES')) {
      const [
        id,
        provider,
        providerMode,
        providerCheckoutSessionId,
        providerPaymentIntentId,
        userId,
        creditPackId,
        credits,
        amountCents,
        currency,
        status,
        idempotencyKeyHash,
        requestFingerprintHash,
        checkoutUrl,
        providerCustomerId,
        authorizationScope,
        paymentStatus,
        metadataJson,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.state.billingMemberCheckoutSessions.some((row) =>
        row.id === id ||
        (providerCheckoutSessionId != null && row.provider === provider && row.provider_checkout_session_id === providerCheckoutSessionId) ||
        (row.user_id === userId && row.idempotency_key_hash === idempotencyKeyHash)
      )) {
        throw new Error('UNIQUE constraint failed: billing_member_checkout_sessions');
      }
      this.state.billingMemberCheckoutSessions.push({
        id,
        provider,
        provider_mode: providerMode,
        provider_checkout_session_id: providerCheckoutSessionId,
        provider_payment_intent_id: providerPaymentIntentId,
        user_id: userId,
        credit_pack_id: creditPackId,
        credits,
        amount_cents: amountCents,
        currency,
        status,
        idempotency_key_hash: idempotencyKeyHash,
        request_fingerprint_hash: requestFingerprintHash,
        checkout_url: checkoutUrl,
        provider_customer_id: providerCustomerId,
        billing_event_id: null,
        member_credit_ledger_entry_id: null,
        authorization_scope: authorizationScope,
        payment_status: paymentStatus,
        error_code: null,
        error_message: null,
        metadata_json: metadataJson,
        granted_at: null,
        failed_at: null,
        expired_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE billing_member_checkout_sessions SET provider_checkout_session_id = ?')) {
      const [
        sessionId,
        paymentIntentId,
        customerId,
        checkoutUrl,
        paymentStatus,
        updatedAt,
        id,
      ] = bindings;
      const row = this.state.billingMemberCheckoutSessions.find((entry) =>
        entry.id === id && entry.provider === 'stripe' && entry.provider_mode === 'live'
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      if (this.state.billingMemberCheckoutSessions.some((entry) =>
        entry !== row &&
        entry.provider === 'stripe' &&
        entry.provider_checkout_session_id === sessionId
      )) {
        throw new Error('UNIQUE constraint failed: billing_member_checkout_sessions');
      }
      row.provider_checkout_session_id = sessionId;
      row.provider_payment_intent_id = paymentIntentId || row.provider_payment_intent_id;
      row.provider_customer_id = customerId || row.provider_customer_id;
      row.checkout_url = checkoutUrl;
      row.payment_status = paymentStatus || row.payment_status;
      row.error_code = null;
      row.error_message = null;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE billing_member_checkout_sessions SET status = 'failed'")) {
      const [errorCode, errorMessage, updatedAt, failedAt, id] = bindings;
      const row = this.state.billingMemberCheckoutSessions.find((entry) => entry.id === id);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'failed';
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.updated_at = updatedAt;
      row.failed_at = row.failed_at || failedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE billing_member_checkout_sessions SET status = 'completed', provider_payment_intent_id = COALESCE")) {
      const [
        paymentIntentId,
        customerId,
        billingEventId,
        ledgerEntryId,
        paymentStatus,
        updatedAt,
        completedAt,
        grantedLedgerEntryId,
        grantedAt,
        sessionId,
      ] = bindings;
      const row = this.state.billingMemberCheckoutSessions.find((entry) =>
        entry.provider === 'stripe' && entry.provider_checkout_session_id === sessionId
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'completed';
      row.provider_payment_intent_id = paymentIntentId || row.provider_payment_intent_id;
      row.provider_customer_id = customerId || row.provider_customer_id;
      row.billing_event_id = billingEventId || row.billing_event_id;
      row.member_credit_ledger_entry_id = ledgerEntryId || row.member_credit_ledger_entry_id;
      row.payment_status = paymentStatus || row.payment_status;
      row.error_code = null;
      row.error_message = null;
      row.updated_at = updatedAt;
      row.completed_at = row.completed_at || completedAt;
      if (grantedLedgerEntryId) row.granted_at = row.granted_at || grantedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, organization_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, billing_event_id, credit_ledger_entry_id, created_at, updated_at, completed_at FROM billing_checkout_sessions WHERE organization_id = ? AND user_id = ? AND idempotency_key_hash = ?')) {
      const [organizationId, userId, idempotencyKeyHash] = bindings;
      return deepClone(this.state.billingCheckoutSessions.find((row) =>
        row.organization_id === organizationId &&
        row.user_id === userId &&
        row.idempotency_key_hash === idempotencyKeyHash
      ) || null);
    }

    if (query.startsWith('SELECT id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, organization_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, billing_event_id, credit_ledger_entry_id, authorization_scope')) {
      const hasIdempotencyFilter = query.includes('WHERE organization_id = ? AND user_id = ? AND idempotency_key_hash = ?');
      if (hasIdempotencyFilter) {
        const [organizationId, userId, idempotencyKeyHash] = bindings;
        return deepClone(this.state.billingCheckoutSessions.find((row) =>
          row.organization_id === organizationId &&
          row.user_id === userId &&
          row.idempotency_key_hash === idempotencyKeyHash
        ) || null);
      }
      if (query.includes("WHERE provider = 'stripe' AND provider_checkout_session_id = ?")) {
        const [sessionId] = bindings;
        return deepClone(this.state.billingCheckoutSessions.find((row) =>
          row.provider === 'stripe' && row.provider_checkout_session_id === sessionId
        ) || null);
      }
      if (query.includes("WHERE organization_id = ?") && query.includes("provider_mode = 'live'")) {
        const [organizationId, limit] = bindings;
        const rows = this.state.billingCheckoutSessions
          .filter((row) =>
            row.organization_id === organizationId &&
            row.provider === 'stripe' &&
            row.provider_mode === 'live'
          )
          .sort((a, b) =>
            String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
            String(b.id || '').localeCompare(String(a.id || ''))
          )
          .slice(0, Number(limit));
        return { results: deepClone(rows) };
      }
    }

    if (query.startsWith("SELECT id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, organization_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, billing_event_id, credit_ledger_entry_id, created_at, updated_at, completed_at FROM billing_checkout_sessions WHERE provider = 'stripe' AND provider_checkout_session_id = ?")) {
      const [sessionId] = bindings;
      return deepClone(this.state.billingCheckoutSessions.find((row) =>
        row.provider === 'stripe' && row.provider_checkout_session_id === sessionId
      ) || null);
    }

    if (query.startsWith('INSERT INTO billing_checkout_sessions ( id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, organization_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, metadata_json, created_at, updated_at ) VALUES')) {
      const [
        id,
        provider,
        providerMode,
        providerCheckoutSessionId,
        providerPaymentIntentId,
        organizationId,
        userId,
        creditPackId,
        credits,
        amountCents,
        currency,
        status,
        idempotencyKeyHash,
        requestFingerprintHash,
        checkoutUrl,
        providerCustomerId,
        metadataJson,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.state.billingCheckoutSessions.some((row) =>
        row.id === id ||
        (row.provider === provider && row.provider_checkout_session_id === providerCheckoutSessionId) ||
        (row.organization_id === organizationId && row.user_id === userId && row.idempotency_key_hash === idempotencyKeyHash)
      )) {
        throw new Error('UNIQUE constraint failed: billing_checkout_sessions');
      }
      this.state.billingCheckoutSessions.push({
        id,
        provider,
        provider_mode: providerMode,
        provider_checkout_session_id: providerCheckoutSessionId,
        provider_payment_intent_id: providerPaymentIntentId,
        organization_id: organizationId,
        user_id: userId,
        credit_pack_id: creditPackId,
        credits,
        amount_cents: amountCents,
        currency,
        status,
        idempotency_key_hash: idempotencyKeyHash,
        request_fingerprint_hash: requestFingerprintHash,
        checkout_url: checkoutUrl,
        provider_customer_id: providerCustomerId,
        billing_event_id: null,
        credit_ledger_entry_id: null,
        authorization_scope: null,
        payment_status: null,
        error_code: null,
        error_message: null,
        metadata_json: metadataJson,
        granted_at: null,
        failed_at: null,
        expired_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO billing_checkout_sessions ( id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, organization_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, authorization_scope, payment_status, metadata_json, created_at, updated_at ) VALUES')) {
      const [
        id,
        provider,
        providerMode,
        providerCheckoutSessionId,
        providerPaymentIntentId,
        organizationId,
        userId,
        creditPackId,
        credits,
        amountCents,
        currency,
        status,
        idempotencyKeyHash,
        requestFingerprintHash,
        checkoutUrl,
        providerCustomerId,
        authorizationScope,
        paymentStatus,
        metadataJson,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.state.billingCheckoutSessions.some((row) =>
        row.id === id ||
        (providerCheckoutSessionId != null && row.provider === provider && row.provider_checkout_session_id === providerCheckoutSessionId) ||
        (row.organization_id === organizationId && row.user_id === userId && row.idempotency_key_hash === idempotencyKeyHash)
      )) {
        throw new Error('UNIQUE constraint failed: billing_checkout_sessions');
      }
      this.state.billingCheckoutSessions.push({
        id,
        provider,
        provider_mode: providerMode,
        provider_checkout_session_id: providerCheckoutSessionId,
        provider_payment_intent_id: providerPaymentIntentId,
        organization_id: organizationId,
        user_id: userId,
        credit_pack_id: creditPackId,
        credits,
        amount_cents: amountCents,
        currency,
        status,
        idempotency_key_hash: idempotencyKeyHash,
        request_fingerprint_hash: requestFingerprintHash,
        checkout_url: checkoutUrl,
        provider_customer_id: providerCustomerId,
        billing_event_id: null,
        credit_ledger_entry_id: null,
        authorization_scope: authorizationScope,
        payment_status: paymentStatus,
        error_code: null,
        error_message: null,
        metadata_json: metadataJson,
        granted_at: null,
        failed_at: null,
        expired_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO billing_checkout_sessions ( id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, organization_id, user_id, credit_pack_id, credits, amount_cents, currency, status, idempotency_key_hash, request_fingerprint_hash, checkout_url, provider_customer_id, billing_event_id, credit_ledger_entry_id, metadata_json, created_at, updated_at, completed_at ) VALUES')) {
      const [
        id,
        provider,
        providerMode,
        providerCheckoutSessionId,
        providerPaymentIntentId,
        organizationId,
        userId,
        creditPackId,
        credits,
        amountCents,
        currency,
        status,
        idempotencyKeyHash,
        requestFingerprintHash,
        checkoutUrl,
        providerCustomerId,
        billingEventId,
        creditLedgerEntryId,
        metadataJson,
        createdAt,
        updatedAt,
        completedAt,
      ] = bindings;
      if (this.state.billingCheckoutSessions.some((row) =>
        row.id === id ||
        (row.provider === provider && row.provider_checkout_session_id === providerCheckoutSessionId) ||
        (row.organization_id === organizationId && row.user_id === userId && row.idempotency_key_hash === idempotencyKeyHash)
      )) {
        throw new Error('UNIQUE constraint failed: billing_checkout_sessions');
      }
      this.state.billingCheckoutSessions.push({
        id,
        provider,
        provider_mode: providerMode,
        provider_checkout_session_id: providerCheckoutSessionId,
        provider_payment_intent_id: providerPaymentIntentId,
        organization_id: organizationId,
        user_id: userId,
        credit_pack_id: creditPackId,
        credits,
        amount_cents: amountCents,
        currency,
        status,
        idempotency_key_hash: idempotencyKeyHash,
        request_fingerprint_hash: requestFingerprintHash,
        checkout_url: checkoutUrl,
        provider_customer_id: providerCustomerId,
        billing_event_id: billingEventId,
        credit_ledger_entry_id: creditLedgerEntryId,
        authorization_scope: null,
        payment_status: null,
        error_code: null,
        error_message: null,
        metadata_json: metadataJson,
        granted_at: null,
        failed_at: null,
        expired_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: completedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE billing_checkout_sessions SET provider_checkout_session_id = ?')) {
      const [
        sessionId,
        paymentIntentId,
        customerId,
        checkoutUrl,
        paymentStatus,
        updatedAt,
        id,
        providerMode,
      ] = bindings;
      const row = this.state.billingCheckoutSessions.find((entry) =>
        entry.id === id && entry.provider === 'stripe' && entry.provider_mode === providerMode
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      if (this.state.billingCheckoutSessions.some((entry) =>
        entry !== row &&
        entry.provider === 'stripe' &&
        entry.provider_checkout_session_id === sessionId
      )) {
        throw new Error('UNIQUE constraint failed: billing_checkout_sessions');
      }
      row.provider_checkout_session_id = sessionId;
      row.provider_payment_intent_id = paymentIntentId || row.provider_payment_intent_id;
      row.provider_customer_id = customerId || row.provider_customer_id;
      row.checkout_url = checkoutUrl;
      row.payment_status = paymentStatus || row.payment_status;
      row.error_code = null;
      row.error_message = null;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE billing_checkout_sessions SET status = 'failed'")) {
      const [errorCode, errorMessage, updatedAt, failedAt, id] = bindings;
      const row = this.state.billingCheckoutSessions.find((entry) => entry.id === id);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'failed';
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.updated_at = updatedAt;
      row.failed_at = row.failed_at || failedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith("UPDATE billing_checkout_sessions SET status = 'completed', provider_payment_intent_id = COALESCE")) {
      const [
        paymentIntentId,
        customerId,
        billingEventId,
        ledgerEntryId,
        paymentStatus,
        updatedAt,
        completedAt,
        grantedLedgerEntryId,
        grantedAt,
        sessionId,
      ] = bindings;
      const row = this.state.billingCheckoutSessions.find((entry) =>
        entry.provider === 'stripe' && entry.provider_checkout_session_id === sessionId
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'completed';
      row.provider_payment_intent_id = paymentIntentId || row.provider_payment_intent_id;
      row.provider_customer_id = customerId || row.provider_customer_id;
      row.billing_event_id = billingEventId || row.billing_event_id;
      row.credit_ledger_entry_id = ledgerEntryId || row.credit_ledger_entry_id;
      row.payment_status = paymentStatus || row.payment_status;
      row.error_code = null;
      row.error_message = null;
      row.updated_at = updatedAt;
      row.completed_at = row.completed_at || completedAt;
      if (grantedLedgerEntryId) row.granted_at = row.granted_at || grantedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, organization_id, amount, balance_after, entry_type, feature_key, source, created_by_user_id, created_at FROM credit_ledger WHERE organization_id = ?')) {
      const [organizationId, limit] = bindings;
      const rows = this.state.creditLedger
        .filter((row) => row.organization_id === organizationId)
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit));
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, provider, provider_event_id, provider_account, provider_mode, event_type, event_created_at, received_at, processing_status, verification_status, payload_hash, payload_summary_json, organization_id, user_id, billing_customer_id, error_code, error_message, attempt_count, last_processed_at, created_at, updated_at FROM billing_provider_events WHERE provider = ? AND provider_event_id = ?')) {
      const [provider, providerEventId] = bindings;
      return deepClone(this.state.billingProviderEvents.find((row) =>
        row.provider === provider && row.provider_event_id === providerEventId
      ) || null);
    }

    if (query.startsWith('INSERT INTO billing_provider_events ( id, provider, provider_event_id, provider_account, provider_mode, event_type, event_created_at, received_at, processing_status, verification_status, dedupe_key, payload_hash, payload_summary_json, organization_id, user_id, billing_customer_id, error_code, error_message, attempt_count, last_processed_at, created_at, updated_at ) VALUES')) {
      const [
        id,
        provider,
        providerEventId,
        providerAccount,
        providerMode,
        eventType,
        eventCreatedAt,
        receivedAt,
        processingStatus,
        verificationStatus,
        dedupeKey,
        payloadHash,
        payloadSummaryJson,
        organizationId,
        userId,
        billingCustomerId,
        errorCode,
        errorMessage,
        attemptCount,
        lastProcessedAt,
        createdAt,
        updatedAt,
      ] = bindings;
      if (this.state.billingProviderEvents.some((row) =>
        row.id === id ||
        (row.provider === provider && row.provider_event_id === providerEventId) ||
        row.dedupe_key === dedupeKey
      )) {
        throw new Error('UNIQUE constraint failed: billing_provider_events');
      }
      this.state.billingProviderEvents.push({
        id,
        provider,
        provider_event_id: providerEventId,
        provider_account: providerAccount,
        provider_mode: providerMode,
        event_type: eventType,
        event_created_at: eventCreatedAt,
        received_at: receivedAt,
        processing_status: processingStatus,
        verification_status: verificationStatus,
        dedupe_key: dedupeKey,
        payload_hash: payloadHash,
        payload_summary_json: payloadSummaryJson,
        organization_id: organizationId,
        user_id: userId,
        billing_customer_id: billingCustomerId,
        error_code: errorCode,
        error_message: errorMessage,
        attempt_count: attemptCount,
        last_processed_at: lastProcessedAt,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO billing_event_actions ( id, event_id, action_type, status, dry_run, summary_json, created_at, updated_at ) VALUES')) {
      const [id, eventId, actionType, status, dryRun, summaryJson, createdAt, updatedAt] = bindings;
      if (this.state.billingEventActions.some((row) =>
        row.id === id || (row.event_id === eventId && row.action_type === actionType)
      )) {
        throw new Error('UNIQUE constraint failed: billing_event_actions');
      }
      this.state.billingEventActions.push({
        id,
        event_id: eventId,
        action_type: actionType,
        status,
        dry_run: dryRun,
        summary_json: summaryJson,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE billing_provider_events SET processing_status = ?')) {
      const [
        processingStatus,
        organizationId,
        userId,
        billingCustomerId,
        errorCode,
        errorMessage,
        lastProcessedAt,
        updatedAt,
        eventId,
      ] = bindings;
      const row = this.state.billingProviderEvents.find((entry) => entry.id === eventId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.processing_status = processingStatus;
      row.organization_id = organizationId || row.organization_id;
      row.user_id = userId || row.user_id;
      row.billing_customer_id = billingCustomerId || row.billing_customer_id;
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.last_processed_at = lastProcessedAt;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('UPDATE billing_event_actions SET status = ?')) {
      const [status, dryRun, summaryJson, updatedAt, eventId, actionType] = bindings;
      const row = this.state.billingEventActions.find((entry) =>
        entry.event_id === eventId && entry.action_type === actionType
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = status;
      row.dry_run = dryRun;
      row.summary_json = summaryJson;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, provider, provider_event_id, provider_account, provider_mode, event_type, event_created_at, received_at, processing_status, verification_status, payload_hash, payload_summary_json, organization_id, user_id, billing_customer_id, error_code, error_message, attempt_count, last_processed_at, created_at, updated_at FROM billing_provider_events WHERE id = ?')) {
      const [eventId] = bindings;
      return deepClone(this.state.billingProviderEvents.find((row) => row.id === eventId) || null);
    }

    if (query.startsWith('SELECT id, provider, provider_event_id, provider_account, provider_mode, event_type, event_created_at, received_at, processing_status, verification_status, payload_hash, payload_summary_json, organization_id, user_id, billing_customer_id, error_code, error_message, attempt_count, last_processed_at, created_at, updated_at FROM billing_provider_events WHERE (? IS NULL OR provider = ?)')) {
      const [
        providerFilter,
        providerValue,
        modeFilter,
        modeValue,
        statusFilter,
        statusValue,
        typeFilter,
        typeValue,
        organizationFilter,
        organizationValue,
        limit,
      ] = bindings;
      const rows = this.state.billingProviderEvents
        .filter((row) =>
          (providerFilter == null || row.provider === providerValue) &&
          (modeFilter == null || row.provider_mode === modeValue) &&
          (statusFilter == null || row.processing_status === statusValue) &&
          (typeFilter == null || row.event_type === typeValue) &&
          (organizationFilter == null || row.organization_id === organizationValue)
        )
        .sort((a, b) =>
          String(b.received_at || '').localeCompare(String(a.received_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit));
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, event_id, action_type, status, dry_run, summary_json, created_at, updated_at FROM billing_event_actions WHERE event_id = ?')) {
      const [eventId] = bindings;
      const rows = this.state.billingEventActions
        .filter((row) => row.event_id === eventId)
        .sort((a, b) =>
          String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
          String(a.id || '').localeCompare(String(b.id || ''))
        );
      return { results: deepClone(rows) };
    }

    if (
      query.startsWith('SELECT id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, organization_id, user_id, credit_pack_id, credits, amount_cents, currency, status, billing_event_id, credit_ledger_entry_id, authorization_scope, payment_status, granted_at, failed_at, expired_at, created_at, updated_at, completed_at FROM billing_checkout_sessions') &&
      query.includes("WHERE provider = 'stripe' AND provider_mode = 'live'")
    ) {
      const [limit] = bindings;
      const rows = this.state.billingCheckoutSessions
        .filter((row) => row.provider === 'stripe' && row.provider_mode === 'live')
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (
      query.startsWith('SELECT id, provider, provider_mode, provider_checkout_session_id, provider_payment_intent_id, user_id, credit_pack_id, credits, amount_cents, currency, status, billing_event_id, member_credit_ledger_entry_id, authorization_scope, payment_status, granted_at, failed_at, expired_at, created_at, updated_at, completed_at FROM billing_member_checkout_sessions') &&
      query.includes("WHERE provider = 'stripe' AND provider_mode = 'live'")
    ) {
      const [limit] = bindings;
      const rows = this.state.billingMemberCheckoutSessions
        .filter((row) => row.provider === 'stripe' && row.provider_mode === 'live')
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (
      query.startsWith('SELECT id, provider, provider_mode, provider_checkout_session_id, provider_subscription_id, user_id, plan_id, provider_price_id, amount_cents, currency, status, billing_event_id, authorization_scope, payment_status, failed_at, expired_at, created_at, updated_at, completed_at FROM billing_member_subscription_checkout_sessions') &&
      query.includes("WHERE provider = 'stripe' AND provider_mode = 'live'")
    ) {
      const [limit] = bindings;
      const rows = this.state.billingMemberSubscriptionCheckoutSessions
        .filter((row) => row.provider === 'stripe' && row.provider_mode === 'live')
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, organization_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, created_at FROM credit_ledger ORDER BY created_at DESC, id DESC LIMIT ?')) {
      const [limit] = bindings;
      const rows = this.state.creditLedger
        .slice()
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, user_id, amount, balance_after, entry_type, feature_key, source, idempotency_key, created_at FROM member_credit_ledger ORDER BY created_at DESC, id DESC LIMIT ?')) {
      const [limit] = bindings;
      const rows = this.state.memberCreditLedger
        .slice()
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, organization_id, user_id, feature_key, credits_delta, credit_ledger_id, idempotency_key, status, created_at FROM usage_events ORDER BY created_at DESC, id DESC LIMIT ?')) {
      const [limit] = bindings;
      const rows = this.state.usageEvents
        .slice()
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, user_id, feature_key, credits_delta, credit_ledger_id, idempotency_key, status, created_at FROM member_usage_events ORDER BY created_at DESC, id DESC LIMIT ?')) {
      const [limit] = bindings;
      const rows = this.state.memberUsageEvents
        .slice()
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (
      query.startsWith('SELECT id, user_id, provider, provider_mode, provider_customer_id, provider_subscription_id, provider_price_id, status, current_period_start, current_period_end, cancel_at_period_end, canceled_at, created_at, updated_at FROM billing_member_subscriptions') &&
      query.includes("WHERE provider = 'stripe' AND provider_mode = 'live'")
    ) {
      const [limit] = bindings;
      const rows = this.state.billingMemberSubscriptions
        .filter((row) => row.provider === 'stripe' && row.provider_mode === 'live')
        .sort((a, b) =>
          String(b.updated_at || '').localeCompare(String(a.updated_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, user_id, bucket_type, balance, local_subscription_id, provider_subscription_id, period_start, period_end, source, created_at, updated_at FROM member_credit_buckets ORDER BY updated_at DESC, id DESC LIMIT ?')) {
      const [limit] = bindings;
      const rows = this.state.memberCreditBuckets
        .slice()
        .sort((a, b) =>
          String(b.updated_at || '').localeCompare(String(a.updated_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (query.startsWith('SELECT id, user_id, bucket_id, bucket_type, amount, balance_after, member_credit_ledger_id, source, idempotency_key, created_at FROM member_credit_bucket_events ORDER BY created_at DESC, id DESC LIMIT ?')) {
      const [limit] = bindings;
      const rows = this.state.memberCreditBucketEvents
        .slice()
        .sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
          String(b.id || '').localeCompare(String(a.id || ''))
        )
        .slice(0, Number(limit) || 500);
      return { results: deepClone(rows) };
    }

    if (query === 'SELECT id, code, name, status, billing_interval, monthly_credit_grant, created_at, updated_at FROM plans ORDER BY code ASC') {
      return {
        results: deepClone(this.state.plans.sort((a, b) => a.code.localeCompare(b.code))),
      };
    }

    if (query === 'SELECT id, email, role, status, created_at, updated_at, email_verified_at, verification_method FROM users WHERE id = ? LIMIT 1') {
      const [userId] = bindings;
      const row = this.state.users.find((entry) => entry.id === userId);
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at ?? null,
        email_verified_at: row.email_verified_at ?? null,
        verification_method: row.verification_method ?? null,
      };
    }

    if (query === "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND status = 'active'") {
      return {
        cnt: this.state.users.filter((row) => row.role === 'admin' && row.status === 'active').length,
      };
    }

    if (query.startsWith('INSERT INTO data_lifecycle_requests ( id, type, subject_user_id, requested_by_user_id, requested_by_admin_id,')) {
      const [
        id,
        type,
        subjectUserId,
        requestedByUserId,
        requestedByAdminId,
        status,
        reason,
        approvalRequired,
        approvedByAdminId,
        approvedAt,
        idempotencyKey,
        requestHash,
        dryRun,
        createdAt,
        updatedAt,
        completedAt,
        expiresAt,
        errorCode,
        errorMessage,
      ] = bindings;
      const existing = this.state.dataLifecycleRequests.find((row) =>
        row.type === type &&
        row.requested_by_admin_id === requestedByAdminId &&
        row.subject_user_id === subjectUserId &&
        row.idempotency_key === idempotencyKey
      );
      if (existing) {
        throw new Error('UNIQUE constraint failed: data_lifecycle_requests.type, data_lifecycle_requests.requested_by_admin_id, data_lifecycle_requests.subject_user_id, data_lifecycle_requests.idempotency_key');
      }
      this.state.dataLifecycleRequests.push({
        id,
        type,
        subject_user_id: subjectUserId,
        requested_by_user_id: requestedByUserId,
        requested_by_admin_id: requestedByAdminId,
        status,
        reason,
        approval_required: approvalRequired,
        approved_by_admin_id: approvedByAdminId,
        approved_at: approvedAt,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        dry_run: dryRun,
        created_at: createdAt,
        updated_at: updatedAt,
        completed_at: completedAt,
        expires_at: expiresAt,
        error_code: errorCode,
        error_message: errorMessage,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (
      query.includes('FROM data_lifecycle_requests') &&
      query.includes('WHERE type = ? AND requested_by_admin_id = ? AND subject_user_id = ? AND idempotency_key = ?')
    ) {
      const [type, adminUserId, subjectUserId, idempotencyKey] = bindings;
      return deepClone(this.state.dataLifecycleRequests.find((row) =>
        row.type === type &&
        row.requested_by_admin_id === adminUserId &&
        row.subject_user_id === subjectUserId &&
        row.idempotency_key === idempotencyKey
      ) || null);
    }

    if (
      query.includes('FROM data_lifecycle_requests') &&
      query.includes('WHERE id = ?') &&
      query.includes('LIMIT 1')
    ) {
      const [requestId] = bindings;
      return deepClone(this.state.dataLifecycleRequests.find((row) => row.id === requestId) || null);
    }

    if (query === 'SELECT id, type FROM data_lifecycle_requests WHERE id = ? LIMIT 1') {
      const [requestId] = bindings;
      const row = this.state.dataLifecycleRequests.find((entry) => entry.id === requestId);
      return row ? { id: row.id, type: row.type } : null;
    }

    if (
      query.includes('FROM data_lifecycle_requests') &&
      query.includes('ORDER BY created_at DESC, id DESC LIMIT ?')
    ) {
      const [limit] = bindings;
      const rows = this.state.dataLifecycleRequests
        .slice()
        .sort((a, b) => (
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
          || String(b.id || '').localeCompare(String(a.id || ''))
        ))
        .slice(0, Number(limit) || 50);
      return { results: deepClone(rows) };
    }

    if (query === 'UPDATE data_lifecycle_requests SET status = ?, updated_at = ? WHERE id = ?') {
      const [status, updatedAt, requestId] = bindings;
      const row = this.state.dataLifecycleRequests.find((entry) => entry.id === requestId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = status;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_lifecycle_requests SET status = 'approved', approved_by_admin_id = ?, approved_at = ?, updated_at = ? WHERE id = ?") {
      const [adminUserId, approvedAt, updatedAt, requestId] = bindings;
      const row = this.state.dataLifecycleRequests.find((entry) => entry.id === requestId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'approved';
      row.approved_by_admin_id = adminUserId;
      row.approved_at = approvedAt;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT OR IGNORE INTO data_lifecycle_request_items ( id, request_id, resource_type, resource_id, table_name, r2_bucket, r2_key,')) {
      const [
        id,
        requestId,
        resourceType,
        resourceId,
        tableName,
        r2Bucket,
        r2Key,
        action,
        status,
        summaryJson,
        createdAt,
        updatedAt,
      ] = bindings;
      const existing = this.state.dataLifecycleRequestItems.find((row) => row.id === id);
      if (existing) return { success: true, meta: { changes: 0 } };
      this.state.dataLifecycleRequestItems.push({
        id,
        request_id: requestId,
        resource_type: resourceType,
        resource_id: resourceId,
        table_name: tableName,
        r2_bucket: r2Bucket,
        r2_key: r2Key,
        action,
        status,
        summary_json: summaryJson,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (
      query.includes('FROM data_lifecycle_request_items') &&
      query.includes('WHERE request_id = ?') &&
      query.includes('ORDER BY created_at ASC, id ASC')
    ) {
      const [requestId] = bindings;
      const rows = this.state.dataLifecycleRequestItems
        .filter((row) => row.request_id === requestId)
        .slice()
        .sort((a, b) => (
          String(a.created_at || '').localeCompare(String(b.created_at || ''))
          || String(a.id || '').localeCompare(String(b.id || ''))
        ));
      return { results: deepClone(rows) };
    }

    if (query === "SELECT id FROM data_lifecycle_request_items WHERE request_id = ? AND status = 'blocked' LIMIT 1") {
      const [requestId] = bindings;
      const row = this.state.dataLifecycleRequestItems.find((entry) => entry.request_id === requestId && entry.status === 'blocked');
      return row ? { id: row.id } : null;
    }

    if (query.startsWith('INSERT INTO data_export_archives ( id, request_id, subject_user_id, r2_bucket, r2_key,')) {
      const [
        id,
        requestId,
        subjectUserId,
        r2Bucket,
        r2Key,
        sha256,
        sizeBytes,
        expiresAt,
        createdAt,
        manifestVersion,
        status,
        updatedAt,
        downloadedAt,
        deletedAt,
        errorCode,
        errorMessage,
      ] = bindings;
      this.state.dataExportArchives.push({
        id,
        request_id: requestId,
        subject_user_id: subjectUserId,
        r2_bucket: r2Bucket,
        r2_key: r2Key,
        sha256,
        size_bytes: sizeBytes,
        expires_at: expiresAt,
        created_at: createdAt,
        manifest_version: manifestVersion,
        status,
        updated_at: updatedAt,
        downloaded_at: downloadedAt,
        deleted_at: deletedAt,
        error_code: errorCode,
        error_message: errorMessage,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (
      query.includes('FROM data_export_archives') &&
      query.includes("WHERE request_id = ? AND status = 'ready' AND expires_at > ?") &&
      query.includes('ORDER BY created_at DESC LIMIT 1')
    ) {
      const [requestId, now] = bindings;
      const row = this.state.dataExportArchives
        .filter((entry) => entry.request_id === requestId && entry.status === 'ready' && entry.expires_at > now)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      return deepClone(row || null);
    }

    if (
      query.includes('FROM data_export_archives') &&
      query.includes('WHERE request_id = ?') &&
      query.includes('ORDER BY created_at DESC LIMIT 1')
    ) {
      const [requestId] = bindings;
      const row = this.state.dataExportArchives
        .filter((entry) => entry.request_id === requestId)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      return deepClone(row || null);
    }

    if (
      query.includes('FROM data_export_archives') &&
      query.includes('WHERE id = ?') &&
      query.includes('LIMIT 1')
    ) {
      const [archiveId] = bindings;
      return deepClone(this.state.dataExportArchives.find((row) => row.id === archiveId) || null);
    }

    if (
      query.includes('FROM data_export_archives') &&
      query.includes('ORDER BY created_at DESC, id DESC') &&
      query.includes('LIMIT ?')
    ) {
      let index = 0;
      let rows = this.state.dataExportArchives.slice();
      if (query.includes('(created_at < ? OR (created_at = ? AND id < ?))')) {
        const createdAt = bindings[index++];
        const sameCreatedAt = bindings[index++];
        const cursorId = bindings[index++];
        rows = rows.filter((row) => (
          String(row.created_at || '') < String(createdAt || '') ||
          (String(row.created_at || '') === String(sameCreatedAt || '') && String(row.id || '') < String(cursorId || ''))
        ));
      }
      const limit = Number(bindings[index]) || 50;
      return {
        results: deepClone(rows
          .sort((a, b) => (
            String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
            String(b.id || '').localeCompare(String(a.id || ''))
          ))
          .slice(0, limit)),
      };
    }

    if (
      query.includes('FROM data_export_archives') &&
      query.includes('deleted_at IS NULL') &&
      query.includes('expires_at <= ?') &&
      query.includes('ORDER BY expires_at ASC, created_at ASC, id ASC')
    ) {
      const [now, limit] = bindings;
      const rows = this.state.dataExportArchives
        .filter((row) => !row.deleted_at)
        .filter((row) => String(row.expires_at || '') <= String(now || ''))
        .filter((row) => (
          ['ready', 'expired'].includes(row.status) ||
          (row.status === 'cleanup_failed' && row.error_code === 'archive_cleanup_r2_failed')
        ))
        .sort((a, b) => (
          String(a.expires_at || '').localeCompare(String(b.expires_at || '')) ||
          String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
          String(a.id || '').localeCompare(String(b.id || ''))
        ))
        .slice(0, Number(limit) || 25);
      return { results: deepClone(rows) };
    }

    if (query === "UPDATE data_export_archives SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?") {
      const [errorCode, errorMessage, updatedAt, archiveId] = bindings;
      const row = this.state.dataExportArchives.find((entry) => entry.id === archiveId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'failed';
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_lifecycle_requests SET status = 'export_failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?") {
      const [errorCode, errorMessage, updatedAt, requestId] = bindings;
      const row = this.state.dataLifecycleRequests.find((entry) => entry.id === requestId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'export_failed';
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_export_archives SET status = 'ready', updated_at = ? WHERE id = ?") {
      const [updatedAt, archiveId] = bindings;
      const row = this.state.dataExportArchives.find((entry) => entry.id === archiveId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'ready';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_lifecycle_requests SET status = 'export_ready', completed_at = ?, updated_at = ?, error_code = NULL, error_message = NULL WHERE id = ?") {
      const [completedAt, updatedAt, requestId] = bindings;
      const row = this.state.dataLifecycleRequests.find((entry) => entry.id === requestId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'export_ready';
      row.completed_at = completedAt;
      row.updated_at = updatedAt;
      row.error_code = null;
      row.error_message = null;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_export_archives SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'ready'") {
      const [updatedAt, archiveId] = bindings;
      const row = this.state.dataExportArchives.find((entry) => entry.id === archiveId && entry.status === 'ready');
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'expired';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_export_archives SET status = 'cleanup_failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?") {
      const [errorCode, errorMessage, updatedAt, archiveId] = bindings;
      const row = this.state.dataExportArchives.find((entry) => entry.id === archiveId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'cleanup_failed';
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_export_archives SET status = 'deleted', deleted_at = ?, updated_at = ?, error_code = NULL, error_message = NULL WHERE id = ?") {
      const [deletedAt, updatedAt, archiveId] = bindings;
      const row = this.state.dataExportArchives.find((entry) => entry.id === archiveId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'deleted';
      row.deleted_at = deletedAt;
      row.updated_at = updatedAt;
      row.error_code = null;
      row.error_message = null;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE data_export_archives SET status = 'expired', expires_at = ?, updated_at = ? WHERE subject_user_id = ? AND status = 'ready' AND expires_at > ?") {
      const [expiresAt, updatedAt, subjectUserId, now] = bindings;
      let changes = 0;
      for (const row of this.state.dataExportArchives) {
        if (row.subject_user_id === subjectUserId && row.status === 'ready' && String(row.expires_at || '') > String(now || '')) {
          row.status = 'expired';
          row.expires_at = expiresAt;
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'UPDATE data_export_archives SET downloaded_at = ?, updated_at = ? WHERE id = ?') {
      const [downloadedAt, updatedAt, archiveId] = bindings;
      const row = this.state.dataExportArchives.find((entry) => entry.id === archiveId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.downloaded_at = downloadedAt;
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM sessions WHERE user_id = ?') {
      const [userId] = bindings;
      const before = this.state.sessions.length;
      this.state.sessions = this.state.sessions.filter((row) => row.user_id !== userId);
      return { success: true, meta: { changes: before - this.state.sessions.length } };
    }

    if (query === 'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL') {
      const [usedAt, userId] = bindings;
      let changes = 0;
      for (const row of this.state.passwordResetTokens) {
        if (row.user_id === userId && row.used_at == null) {
          row.used_at = usedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL') {
      const [usedAt, userId] = bindings;
      let changes = 0;
      for (const row of this.state.emailVerificationTokens) {
        if (row.user_id === userId && row.used_at == null) {
          row.used_at = usedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'UPDATE siwe_challenges SET used_at = ? WHERE user_id = ? AND used_at IS NULL') {
      const [usedAt, userId] = bindings;
      let changes = 0;
      for (const row of this.state.siweChallenges) {
        if (row.user_id === userId && row.used_at == null) {
          row.used_at = usedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (
      query.startsWith("UPDATE data_lifecycle_request_items SET status = 'completed', updated_at = ? WHERE request_id = ?")
    ) {
      const [updatedAt, requestId] = bindings;
      let changes = 0;
      for (const row of this.state.dataLifecycleRequestItems) {
        const isSafeAction = (
          (row.table_name === 'sessions' && row.action === 'revoke') ||
          (['password_reset_tokens', 'email_verification_tokens', 'siwe_challenges'].includes(row.table_name) && row.action === 'expire_or_delete') ||
          (row.resource_type === 'data_export_archive' && row.action === 'expire')
        );
        if (row.request_id === requestId && isSafeAction) {
          row.status = 'completed';
          row.updated_at = updatedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE data_lifecycle_requests SET status = 'safe_actions_completed', updated_at = ? WHERE id = ?") {
      const [updatedAt, requestId] = bindings;
      const row = this.state.dataLifecycleRequests.find((entry) => entry.id === requestId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.status = 'safe_actions_completed';
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
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

    if (query === 'SELECT id, address_display, address_normalized, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at FROM linked_wallets WHERE user_id = ? ORDER BY created_at DESC') {
      const [userId] = bindings;
      const rows = this.state.linkedWallets
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((row) => ({
          id: row.id,
          address_display: row.address_display,
          address_normalized: row.address_normalized,
          chain_id: row.chain_id,
          is_primary: row.is_primary,
          linked_at: row.linked_at,
          last_login_at: row.last_login_at ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));
      return { results: rows };
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

    if (query === 'SELECT user_id, display_name, bio, website, youtube_url, has_avatar, avatar_updated_at, created_at, updated_at FROM profiles WHERE user_id = ? LIMIT 1') {
      const [userId] = bindings;
      return deepClone(this.state.profiles.find((row) => row.user_id === userId) || null);
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

    if (
      query === 'SELECT item_type, item_id, title, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
      || query === 'SELECT item_type, item_id, title, thumb_url, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
    ) {
      const [userId] = bindings;
      const rows = this.state.favorites
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((row) => ({
          item_type: row.item_type,
          item_id: row.item_id,
          title: row.title ?? null,
          thumb_url: row.thumb_url ?? '',
          created_at: row.created_at ?? null,
        }));
      return { results: rows };
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

    if (query === 'SELECT id, name, slug, status, created_at FROM ai_folders WHERE user_id = ? ORDER BY created_at DESC') {
      const [userId] = bindings;
      const rows = this.state.aiFolders
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          status: row.status ?? 'active',
          created_at: row.created_at,
        }));
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

    if (query === 'SELECT folder_id, COALESCE(SUM(size_bytes), 0) AS size_bytes FROM ai_images WHERE user_id = ? GROUP BY folder_id') {
      const [userId] = bindings;
      const sizes = new Map();
      for (const row of this.state.aiImages) {
        if (row.user_id !== userId) continue;
        const key = row.folder_id ?? null;
        sizes.set(key, (sizes.get(key) || 0) + Number(row.size_bytes || 0));
      }
      return {
        results: Array.from(sizes.entries()).map(([folderId, sizeBytes]) => ({
          folder_id: folderId,
          size_bytes: sizeBytes,
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

    if (query === 'SELECT folder_id, COALESCE(SUM(size_bytes), 0) + COALESCE(SUM(poster_size_bytes), 0) AS size_bytes FROM ai_text_assets WHERE user_id = ? GROUP BY folder_id') {
      const [userId] = bindings;
      const sizes = new Map();
      for (const row of this.state.aiTextAssets) {
        if (row.user_id !== userId) continue;
        const key = row.folder_id ?? null;
        sizes.set(key, (sizes.get(key) || 0) + Number(row.size_bytes || 0) + Number(row.poster_size_bytes || 0));
      }
      return {
        results: Array.from(sizes.entries()).map(([folderId, sizeBytes]) => ({
          folder_id: folderId,
          size_bytes: sizeBytes,
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

    if (query.startsWith('SELECT a.id, a.action, a.meta_json, a.created_at, a.admin_user_id, COALESCE(au.email, idx.actor_email_norm) AS admin_email, a.target_user_id, COALESCE(tu.email, idx.target_email_norm) AS target_email FROM activity_search_index idx JOIN admin_audit_log a')) {
      let limit = Number(bindings.at(-1)) || 0;
      let cursorTime = null;
      let cursorId = null;
      let searchStart = null;
      let searchEnd = null;
      let bindingIndex = 0;

      if (query.includes('(idx.created_at < ? OR (idx.created_at = ? AND idx.source_event_id < ?))')) {
        [cursorTime, , cursorId] = bindings.slice(bindingIndex, bindingIndex + 3);
        bindingIndex += 3;
      }
      if (query.includes('idx.action_norm >= ?')) {
        searchStart = bindings[bindingIndex];
        searchEnd = bindings[bindingIndex + 1];
      }

      let rows = this.state.activitySearchIndex
        .filter((indexRow) => indexRow.source_table === 'admin_audit_log')
        .map((indexRow) => {
          const row = this.state.adminAuditLog.find((entry) => entry.id === indexRow.source_event_id);
          if (!row) return null;
          const admin = this.state.users.find((user) => user.id === row.admin_user_id);
          const target = this.state.users.find((user) => user.id === row.target_user_id);
          return {
            id: row.id,
            action: row.action,
            meta_json: row.meta_json,
            created_at: row.created_at,
            admin_user_id: row.admin_user_id,
            admin_email: admin?.email || indexRow.actor_email_norm || null,
            target_user_id: row.target_user_id,
            target_email: target?.email || indexRow.target_email_norm || null,
            indexRow,
          };
        })
        .filter(Boolean);

      if (cursorTime && cursorId) {
        rows = rows.filter((row) => row.indexRow.created_at < cursorTime || (row.indexRow.created_at === cursorTime && row.indexRow.source_event_id < cursorId));
      }
      if (searchStart && searchEnd) {
        const inRange = (value) => (
          typeof value === 'string' && value >= searchStart && value < searchEnd
        );
        rows = rows.filter((row) => {
          const indexRow = row.indexRow;
          return (
            inRange(indexRow.action_norm)
            || inRange(indexRow.actor_email_norm)
            || inRange(indexRow.target_email_norm)
            || inRange(indexRow.entity_id)
          );
        });
      }

      rows.sort((a, b) => {
        if (a.indexRow.created_at !== b.indexRow.created_at) return b.indexRow.created_at.localeCompare(a.indexRow.created_at);
        return b.indexRow.source_event_id.localeCompare(a.indexRow.source_event_id);
      });

      return { results: rows.slice(0, limit).map(({ indexRow, ...row }) => ({ ...row })) };
    }

    if (query.startsWith('SELECT a.id, a.action, a.meta_json, a.created_at, a.admin_user_id, COALESCE(au.email, idx.actor_email_norm) AS admin_email, a.target_user_id, COALESCE(tu.email, idx.target_email_norm) AS target_email FROM admin_audit_log a')) {
      let limit = Number(bindings.at(-1)) || 0;
      let cursorTime = null;
      let cursorId = null;
      let searchStart = null;
      let searchEnd = null;
      let bindingIndex = 0;

      if (query.includes('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')) {
        [cursorTime, , cursorId] = bindings.slice(bindingIndex, bindingIndex + 3);
        bindingIndex += 3;
      }
      if (query.includes('idx.action_norm >= ?')) {
        searchStart = bindings[bindingIndex];
        searchEnd = bindings[bindingIndex + 1];
      }

      let rows = this.state.adminAuditLog.map((row) => {
        const admin = this.state.users.find((user) => user.id === row.admin_user_id);
        const target = this.state.users.find((user) => user.id === row.target_user_id);
        const indexRow = this.state.activitySearchIndex.find((entry) =>
          entry.source_table === 'admin_audit_log' && entry.source_event_id === row.id
        );
        return {
          id: row.id,
          action: row.action,
          meta_json: row.meta_json,
          created_at: row.created_at,
          admin_user_id: row.admin_user_id,
          admin_email: admin?.email || indexRow?.actor_email_norm || null,
          target_user_id: row.target_user_id,
          target_email: target?.email || indexRow?.target_email_norm || null,
          indexRow,
        };
      });

      if (cursorTime && cursorId) {
        rows = rows.filter((row) => row.created_at < cursorTime || (row.created_at === cursorTime && row.id < cursorId));
      }
      if (searchStart && searchEnd) {
        const inRange = (value) => (
          typeof value === 'string' && value >= searchStart && value < searchEnd
        );
        rows = rows.filter((row) => {
          const indexRow = row.indexRow;
          return !!indexRow && (
            inRange(indexRow.action_norm)
            || inRange(indexRow.actor_email_norm)
            || inRange(indexRow.target_email_norm)
            || inRange(indexRow.entity_id)
          );
        });
      }

      rows.sort((a, b) => {
        if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
        return b.id.localeCompare(a.id);
      });

      return { results: rows.slice(0, limit).map(({ indexRow, ...row }) => ({ ...row })) };
    }

    if (query === 'SELECT action, COUNT(*) AS cnt FROM admin_audit_log WHERE created_at >= ? GROUP BY action') {
      const [cutoffIso] = bindings;
      const counts = new Map();
      for (const row of this.state.adminAuditLog) {
        if (row.created_at < cutoffIso) continue;
        counts.set(row.action, (counts.get(row.action) || 0) + 1);
      }
      return {
        results: Array.from(counts.entries()).map(([action, cnt]) => ({ action, cnt })),
      };
    }

    if (query.startsWith('SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at, COALESCE(u.email, idx.actor_email_norm) AS user_email FROM activity_search_index idx JOIN user_activity_log a')) {
      let limit = Number(bindings.at(-1)) || 0;
      let cursorTime = null;
      let cursorId = null;
      let searchStart = null;
      let searchEnd = null;
      let bindingIndex = 0;

      if (query.includes('(idx.created_at < ? OR (idx.created_at = ? AND idx.source_event_id < ?))')) {
        [cursorTime, , cursorId] = bindings.slice(bindingIndex, bindingIndex + 3);
        bindingIndex += 3;
      }
      if (query.includes('idx.action_norm >= ?')) {
        searchStart = bindings[bindingIndex];
        searchEnd = bindings[bindingIndex + 1];
      }

      let rows = this.state.activitySearchIndex
        .filter((indexRow) => indexRow.source_table === 'user_activity_log')
        .map((indexRow) => {
          const row = this.state.userActivityLog.find((entry) => entry.id === indexRow.source_event_id);
          if (!row) return null;
          const user = this.state.users.find((entry) => entry.id === row.user_id);
          return {
            id: row.id,
            user_id: row.user_id,
            action: row.action,
            meta_json: row.meta_json,
            ip_address: row.ip_address,
            created_at: row.created_at,
            user_email: user?.email || indexRow.actor_email_norm || null,
            indexRow,
          };
        })
        .filter(Boolean);

      if (cursorTime && cursorId) {
        rows = rows.filter((row) => row.indexRow.created_at < cursorTime || (row.indexRow.created_at === cursorTime && row.indexRow.source_event_id < cursorId));
      }
      if (searchStart && searchEnd) {
        const inRange = (value) => (
          typeof value === 'string' && value >= searchStart && value < searchEnd
        );
        rows = rows.filter((row) => {
          const indexRow = row.indexRow;
          return (
            inRange(indexRow.action_norm)
            || inRange(indexRow.actor_email_norm)
            || inRange(indexRow.target_email_norm)
            || inRange(indexRow.entity_id)
          );
        });
      }

      rows.sort((a, b) => {
        if (a.indexRow.created_at !== b.indexRow.created_at) return b.indexRow.created_at.localeCompare(a.indexRow.created_at);
        return b.indexRow.source_event_id.localeCompare(a.indexRow.source_event_id);
      });

      return { results: rows.slice(0, limit).map(({ indexRow, ...row }) => ({ ...row })) };
    }

    if (query.startsWith('SELECT a.id, a.user_id, a.action, a.meta_json, a.ip_address, a.created_at, COALESCE(u.email, idx.actor_email_norm) AS user_email FROM user_activity_log a')) {
      let limit = Number(bindings.at(-1)) || 0;
      let cursorTime = null;
      let cursorId = null;
      let searchStart = null;
      let searchEnd = null;
      let bindingIndex = 0;

      if (query.includes('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')) {
        [cursorTime, , cursorId] = bindings.slice(bindingIndex, bindingIndex + 3);
        bindingIndex += 3;
      }
      if (query.includes('idx.action_norm >= ?')) {
        searchStart = bindings[bindingIndex];
        searchEnd = bindings[bindingIndex + 1];
      }

      let rows = this.state.userActivityLog.map((row) => {
        const user = this.state.users.find((entry) => entry.id === row.user_id);
        const indexRow = this.state.activitySearchIndex.find((entry) =>
          entry.source_table === 'user_activity_log' && entry.source_event_id === row.id
        );
        return {
          id: row.id,
          user_id: row.user_id,
          action: row.action,
          meta_json: row.meta_json,
          ip_address: row.ip_address,
          created_at: row.created_at,
          user_email: user?.email || indexRow?.actor_email_norm || null,
          indexRow,
        };
      });

      if (cursorTime && cursorId) {
        rows = rows.filter((row) => row.created_at < cursorTime || (row.created_at === cursorTime && row.id < cursorId));
      }
      if (searchStart && searchEnd) {
        const inRange = (value) => (
          typeof value === 'string' && value >= searchStart && value < searchEnd
        );
        rows = rows.filter((row) => {
          const indexRow = row.indexRow;
          return !!indexRow && (
            inRange(indexRow.action_norm)
            || inRange(indexRow.actor_email_norm)
            || inRange(indexRow.target_email_norm)
            || inRange(indexRow.entity_id)
          );
        });
      }

      rows.sort((a, b) => {
        if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
        return b.id.localeCompare(a.id);
      });

      return { results: rows.slice(0, limit).map(({ indexRow, ...row }) => ({ ...row })) };
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

    if (query.startsWith('INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, size_bytes, created_at) SELECT')) {
      const [id, userId, folderId, r2Key, prompt, model, steps, seed, sizeBytes, createdAt, existsFolderId, existsUserId] = bindings;
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
        size_bytes: sizeBytes,
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

    if (query.startsWith('INSERT INTO ai_images (id, user_id, folder_id, r2_key, prompt, model, steps, seed, size_bytes, created_at) VALUES')) {
      const [id, userId, folderId, r2Key, prompt, model, steps, seed, sizeBytes, createdAt] = bindings;
      this.state.aiImages.push(normalizeAiImageRow({
        id,
        user_id: userId,
        folder_id: folderId,
        r2_key: r2Key,
        prompt,
        model,
        steps,
        seed,
        size_bytes: sizeBytes,
        created_at: createdAt,
      }));
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT id, r2_key, size_bytes FROM ai_images WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.user_id === userId)
          .map((row) => ({
            id: row.id,
            r2_key: row.r2_key,
            size_bytes: row.size_bytes ?? null,
          })),
      };
    }

    if (query === 'SELECT id, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.user_id === userId)
          .map((row) => ({
            id: row.id,
            r2_key: row.r2_key,
            poster_r2_key: row.poster_r2_key ?? null,
            size_bytes: row.size_bytes ?? null,
            poster_size_bytes: row.poster_size_bytes ?? null,
          })),
      };
    }

    if (query === 'UPDATE ai_images SET size_bytes = ? WHERE id = ? AND user_id = ? AND size_bytes IS NULL') {
      const [sizeBytes, imageId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiImages) {
        if (row.id === imageId && row.user_id === userId && row.size_bytes == null) {
          row.size_bytes = sizeBytes;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'UPDATE ai_text_assets SET poster_size_bytes = ? WHERE id = ? AND user_id = ? AND poster_size_bytes IS NULL') {
      const [sizeBytes, assetId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (row.id === assetId && row.user_id === userId && row.poster_size_bytes == null) {
          row.poster_size_bytes = sizeBytes;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'SELECT used_bytes FROM user_asset_storage_usage WHERE user_id = ?') {
      const [userId] = bindings;
      const row = this.state.userAssetStorageUsage.find((item) => item.user_id === userId);
      return row ? { used_bytes: row.used_bytes } : null;
    }

    if (query === 'INSERT OR IGNORE INTO user_asset_storage_usage (user_id, used_bytes, updated_at) VALUES (?, ?, ?)') {
      const [userId, usedBytes, updatedAt] = bindings;
      const existing = this.state.userAssetStorageUsage.find((row) => row.user_id === userId);
      if (existing) return { success: true, meta: { changes: 0 } };
      this.state.userAssetStorageUsage.push({
        user_id: userId,
        used_bytes: usedBytes,
        updated_at: updatedAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE user_asset_storage_usage SET used_bytes = used_bytes + ?, updated_at = ? WHERE user_id = ? AND used_bytes + ? <= ?') {
      const [uploadBytes, updatedAt, userId, checkedUploadBytes, limitBytes] = bindings;
      const row = this.state.userAssetStorageUsage.find((item) => item.user_id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      if (Number(row.used_bytes || 0) + Number(checkedUploadBytes || 0) > Number(limitBytes || 0)) {
        return { success: true, meta: { changes: 0 } };
      }
      row.used_bytes = Number(row.used_bytes || 0) + Number(uploadBytes || 0);
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE user_asset_storage_usage SET used_bytes = used_bytes + ?, updated_at = ? WHERE user_id = ?') {
      const [uploadBytes, updatedAt, userId] = bindings;
      const row = this.state.userAssetStorageUsage.find((item) => item.user_id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.used_bytes = Number(row.used_bytes || 0) + Number(uploadBytes || 0);
      row.updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'UPDATE user_asset_storage_usage SET used_bytes = CASE WHEN used_bytes >= ? THEN used_bytes - ? ELSE 0 END, updated_at = ? WHERE user_id = ?') {
      const [minBytes, releaseBytes, updatedAt, userId] = bindings;
      const row = this.state.userAssetStorageUsage.find((item) => item.user_id === userId);
      if (!row) return { success: true, meta: { changes: 0 } };
      row.used_bytes = Number(row.used_bytes || 0) >= Number(minBytes || 0)
        ? Number(row.used_bytes || 0) - Number(releaseBytes || 0)
        : 0;
      row.updated_at = updatedAt;
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
        visibility: 'private',
        published_at: null,
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
        poster_r2_key: null,
        poster_width: null,
        poster_height: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('INSERT INTO ai_text_assets (id, user_id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, metadata_json, created_at) VALUES')) {
      const [id, userId, folderId, r2Key, title, fileName, sourceModule, mimeType, sizeBytes, previewText, metadataJson, createdAt] = bindings;
      this.state.aiTextAssets.push({
        visibility: 'private',
        published_at: null,
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
        poster_r2_key: null,
        poster_width: null,
        poster_height: null,
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

    if (query === 'SELECT r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE id = ? AND user_id = ?') {
      const [imageId, userId] = bindings;
      const row = this.state.aiImages.find((item) => item.id === imageId && item.user_id === userId);
      return row
        ? {
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
            size_bytes: row.size_bytes ?? null,
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

    if (query === 'SELECT r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.user_id === userId)
          .map((row) => ({
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
            size_bytes: row.size_bytes ?? null,
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

    if (query === 'SELECT r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE user_id = ?') {
      const [userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.user_id === userId)
          .map((row) => ({
            r2_key: row.r2_key,
            poster_r2_key: row.poster_r2_key ?? null,
            size_bytes: row.size_bytes ?? null,
            poster_size_bytes: row.poster_size_bytes ?? null,
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

    if (query === 'SELECT r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      return {
        results: this.state.aiImages
          .filter((row) => row.folder_id === folderId && row.user_id === userId)
          .map((row) => ({
            r2_key: row.r2_key,
            thumb_key: row.thumb_key,
            medium_key: row.medium_key,
            size_bytes: row.size_bytes ?? null,
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

    if (query.startsWith('SELECT id, r2_key, thumb_key, medium_key, size_bytes FROM ai_images WHERE id IN (') && query.endsWith(') AND user_id = ?')) {
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
            size_bytes: row.size_bytes ?? null,
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

    if (query === 'SELECT r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE folder_id = ? AND user_id = ?') {
      const [folderId, userId] = bindings;
      return {
        results: this.state.aiTextAssets
          .filter((row) => row.folder_id === folderId && row.user_id === userId)
          .map((row) => ({
            r2_key: row.r2_key,
            poster_r2_key: row.poster_r2_key ?? null,
            size_bytes: row.size_bytes ?? null,
            poster_size_bytes: row.poster_size_bytes ?? null,
          })),
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

    if (query.startsWith('SELECT id, r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE id IN (') && query.endsWith(') AND user_id = ?')) {
      const requestedIds = bindings.slice(0, -1);
      const userId = bindings[bindings.length - 1];
      return {
        results: this.state.aiTextAssets
          .filter((row) => requestedIds.includes(row.id) && row.user_id === userId)
          .map((row) => ({
            id: row.id,
            r2_key: row.r2_key,
            poster_r2_key: row.poster_r2_key ?? null,
            size_bytes: row.size_bytes ?? null,
            poster_size_bytes: row.poster_size_bytes ?? null,
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
          size_bytes: row.size_bytes ?? null,
          preview_text: null,
          poster_r2_key: null,
          poster_width: null,
          poster_height: null,
          poster_size_bytes: null,
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
            poster_size_bytes: row.poster_size_bytes ?? null,
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

    if (query === 'SELECT id, folder_id, r2_key, prompt, model, steps, seed, visibility, published_at, created_at, thumb_key, medium_key FROM ai_images WHERE user_id = ? ORDER BY created_at DESC') {
      const [userId] = bindings;
      const rows = this.state.aiImages
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((row) => ({
          id: row.id,
          folder_id: row.folder_id ?? null,
          r2_key: row.r2_key,
          prompt: row.prompt,
          model: row.model,
          steps: row.steps,
          seed: row.seed,
          visibility: row.visibility,
          published_at: row.published_at ?? null,
          created_at: row.created_at,
          thumb_key: row.thumb_key ?? null,
          medium_key: row.medium_key ?? null,
        }));
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
          ...(query.includes('size_bytes')
            ? {
                size_bytes: row.size_bytes ?? null,
              }
            : {}),
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
      && (
        query.includes("AND ai_text_assets.source_module = 'video'")
        || query.includes("AND ai_text_assets.source_module = 'music'")
      )
    ) {
      const sourceModule = query.includes("AND ai_text_assets.source_module = 'music'") ? 'music' : 'video';
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
        .filter((row) => row.visibility === 'public' && row.source_module === sourceModule)
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

    if (query === "SELECT created_at, published_at, r2_key, mime_type, poster_r2_key FROM ai_text_assets WHERE id = ? AND visibility = 'public' AND source_module = 'music'") {
      const [assetId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.visibility === 'public' && item.source_module === 'music');
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

    if (query === "SELECT ai_text_assets.user_id, profiles.has_avatar, profiles.avatar_updated_at FROM ai_text_assets LEFT JOIN profiles ON profiles.user_id = ai_text_assets.user_id WHERE ai_text_assets.id = ? AND ai_text_assets.visibility = 'public' AND ai_text_assets.source_module = 'music'") {
      const [assetId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.visibility === 'public' && item.source_module === 'music');
      if (!row) return null;
      const profile = this.state.profiles.find((item) => item.user_id === row.user_id);
      return {
        user_id: row.user_id,
        has_avatar: profile?.has_avatar ?? null,
        avatar_updated_at: profile?.avatar_updated_at ?? null,
      };
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

    if (query === 'SELECT id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, poster_r2_key FROM ai_text_assets WHERE user_id = ? ORDER BY created_at DESC') {
      const [userId] = bindings;
      const rows = this.state.aiTextAssets
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((row) => ({
          id: row.id,
          folder_id: row.folder_id ?? null,
          r2_key: row.r2_key,
          title: row.title,
          file_name: row.file_name,
          source_module: row.source_module,
          mime_type: row.mime_type,
          size_bytes: row.size_bytes,
          preview_text: row.preview_text ?? '',
          created_at: row.created_at,
          poster_r2_key: row.poster_r2_key ?? null,
        }));
      return { results: rows };
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

    if (query === 'SELECT id, visibility, published_at FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.user_id === userId);
      return row
        ? {
            id: row.id,
            visibility: row.visibility,
            published_at: row.published_at,
          }
        : null;
    }

    if (query === 'UPDATE ai_text_assets SET visibility = ?, published_at = ? WHERE id = ? AND user_id = ?') {
      const [visibility, publishedAt, assetId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (row.id === assetId && row.user_id === userId) {
          row.visibility = visibility;
          row.published_at = publishedAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === "SELECT id, user_id, source_module, poster_r2_key, metadata_json FROM ai_text_assets WHERE id = ? AND user_id = ? AND source_module = 'music'") {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) =>
        item.id === assetId && item.user_id === userId && item.source_module === 'music'
      );
      return row
        ? {
            id: row.id,
            user_id: row.user_id,
            source_module: row.source_module,
            poster_r2_key: row.poster_r2_key ?? null,
            metadata_json: row.metadata_json || '{}',
          }
        : null;
    }

    if (query === "SELECT id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, created_at, poster_r2_key, poster_width, poster_height, poster_size_bytes FROM ai_text_assets WHERE id = ? AND user_id = ? AND source_module = 'video' LIMIT 1") {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) =>
        item.id === assetId && item.user_id === userId && item.source_module === 'video'
      );
      return row
        ? {
            id: row.id,
            folder_id: row.folder_id ?? null,
            r2_key: row.r2_key,
            title: row.title,
            file_name: row.file_name,
            source_module: row.source_module,
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
            preview_text: row.preview_text,
            created_at: row.created_at,
            poster_r2_key: row.poster_r2_key ?? null,
            poster_width: row.poster_width ?? null,
            poster_height: row.poster_height ?? null,
            poster_size_bytes: row.poster_size_bytes ?? null,
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

    if (query === 'UPDATE ai_text_assets SET poster_r2_key = ? WHERE id = ? AND user_id = ?') {
      const [posterR2Key, assetId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (row.id === assetId && row.user_id === userId) {
          row.poster_r2_key = posterR2Key;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'UPDATE ai_text_assets SET poster_r2_key = ?, poster_width = ?, poster_height = ? WHERE id = ? AND user_id = ?') {
      const [posterR2Key, posterWidth, posterHeight, assetId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (row.id === assetId && row.user_id === userId) {
          row.poster_r2_key = posterR2Key;
          row.poster_width = posterWidth;
          row.poster_height = posterHeight;
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'UPDATE ai_text_assets SET poster_r2_key = ?, poster_width = ?, poster_height = ?, poster_size_bytes = ? WHERE id = ? AND user_id = ?') {
      const [posterR2Key, posterWidth, posterHeight, posterSizeBytes, assetId, userId] = bindings;
      let changes = 0;
      for (const row of this.state.aiTextAssets) {
        if (row.id === assetId && row.user_id === userId) {
          row.poster_r2_key = posterR2Key;
          row.poster_width = posterWidth;
          row.poster_height = posterHeight;
          row.poster_size_bytes = posterSizeBytes;
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

    if (query === 'SELECT r2_key, poster_r2_key, size_bytes, poster_size_bytes FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.user_id === userId);
      return row
        ? {
            r2_key: row.r2_key,
            poster_r2_key: row.poster_r2_key ?? null,
            size_bytes: row.size_bytes ?? null,
            poster_size_bytes: row.poster_size_bytes ?? null,
          }
        : null;
    }

    if (query === 'SELECT poster_r2_key, poster_size_bytes FROM ai_text_assets WHERE id = ? AND user_id = ?') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) => item.id === assetId && item.user_id === userId);
      return row
        ? {
            poster_r2_key: row.poster_r2_key ?? null,
            poster_size_bytes: row.poster_size_bytes ?? null,
          }
        : null;
    }

    if (query === 'SELECT poster_r2_key FROM ai_text_assets WHERE id = ? AND user_id = ? AND poster_r2_key IS NOT NULL') {
      const [assetId, userId] = bindings;
      const row = this.state.aiTextAssets.find((item) =>
        item.id === assetId && item.user_id === userId && item.poster_r2_key
      );
      return row ? { poster_r2_key: row.poster_r2_key } : null;
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
        output_content_type,
        output_size_bytes,
        poster_r2_key,
        poster_url,
        poster_content_type,
        poster_size_bytes,
        provider_state,
        error_code,
        error_message,
        budget_policy_json,
        budget_policy_status,
        budget_policy_fingerprint,
        budget_policy_version,
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
        output_content_type,
        output_size_bytes,
        poster_r2_key,
        poster_url,
        poster_content_type,
        poster_size_bytes,
        provider_state,
        error_code,
        error_message,
        budget_policy_json,
        budget_policy_status,
        budget_policy_fingerprint,
        budget_policy_version,
        created_at,
        updated_at,
        completed_at,
        expires_at,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'SELECT id, scope, status, provider, model, prompt, output_r2_key, poster_r2_key, created_at, completed_at, error_code FROM ai_video_jobs WHERE user_id = ? ORDER BY created_at DESC') {
      const [userId] = bindings;
      const rows = this.state.aiVideoJobs
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((row) => ({
          id: row.id,
          scope: row.scope,
          status: row.status,
          provider: row.provider,
          model: row.model,
          prompt: row.prompt ?? null,
          output_r2_key: row.output_r2_key ?? null,
          poster_r2_key: row.poster_r2_key ?? null,
          created_at: row.created_at,
          completed_at: row.completed_at ?? null,
          error_code: row.error_code ?? null,
        }));
      return { results: rows };
    }

    if (query.startsWith('SELECT id, user_id, scope, status, provider, model, prompt, input_json, request_hash, provider_task_id, idempotency_key, attempt_count, max_attempts, next_attempt_at, locked_until, output_r2_key, output_url') && query.endsWith('FROM ai_video_jobs WHERE user_id = ? AND scope = ? AND idempotency_key = ?')) {
      const [userId, scope, idempotencyKey] = bindings;
      return deepClone(this.state.aiVideoJobs.find((row) => row.user_id === userId && row.scope === scope && row.idempotency_key === idempotencyKey) || null);
    }

    if (query.startsWith('SELECT id, user_id, scope, status, provider, model, prompt, input_json, request_hash, provider_task_id, idempotency_key, attempt_count, max_attempts, next_attempt_at, locked_until, output_r2_key, output_url') && query.endsWith("FROM ai_video_jobs WHERE id = ? AND user_id = ? AND scope = 'admin'")) {
      const [jobId, userId] = bindings;
      return deepClone(this.state.aiVideoJobs.find((row) => row.id === jobId && row.user_id === userId && row.scope === 'admin') || null);
    }

    if (query === "SELECT id, user_id, scope, status, provider, model, prompt, output_r2_key, output_content_type, output_size_bytes, poster_r2_key, poster_content_type, poster_size_bytes, completed_at FROM ai_video_jobs WHERE id = ? AND user_id = ? AND scope = 'admin' AND status = 'succeeded'") {
      const [jobId, userId] = bindings;
      const row = this.state.aiVideoJobs.find((item) => (
        item.id === jobId
        && item.user_id === userId
        && item.scope === 'admin'
        && item.status === 'succeeded'
      ));
      if (!row) return null;
      return deepClone({
        id: row.id,
        user_id: row.user_id,
        scope: row.scope,
        status: row.status,
        provider: row.provider,
        model: row.model,
        prompt: row.prompt ?? null,
        output_r2_key: row.output_r2_key ?? null,
        output_content_type: row.output_content_type ?? null,
        output_size_bytes: row.output_size_bytes ?? null,
        poster_r2_key: row.poster_r2_key ?? null,
        poster_content_type: row.poster_content_type ?? null,
        poster_size_bytes: row.poster_size_bytes ?? null,
        completed_at: row.completed_at ?? null,
      });
    }

    if (query.startsWith('SELECT ai_video_jobs.id AS id, ai_video_jobs.user_id AS user_id, ai_video_jobs.scope AS scope, ai_video_jobs.status AS status') && query.endsWith('FROM ai_video_jobs INNER JOIN users ON users.id = ai_video_jobs.user_id WHERE ai_video_jobs.id = ?')) {
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

    if (query === "UPDATE ai_video_jobs SET status = 'starting', attempt_count = attempt_count + 1, locked_until = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'starting', 'provider_pending', 'polling', 'processing', 'ingesting') AND (locked_until IS NULL OR locked_until < ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?)") {
      const [lockedUntil, updatedAt, jobId, now, nextAttemptNow] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (
          row.id === jobId
          && ['queued', 'starting', 'provider_pending', 'polling', 'processing', 'ingesting'].includes(row.status)
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

    if (query === "UPDATE ai_video_jobs SET status = ?, provider_task_id = COALESCE(?, provider_task_id), provider_state = ?, error_code = NULL, error_message = NULL, next_attempt_at = ?, locked_until = NULL, updated_at = ? WHERE id = ?") {
      const [status, providerTaskId, providerState, nextAttemptAt, updatedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.status = status;
        if (providerTaskId) row.provider_task_id = providerTaskId;
        row.provider_state = providerState;
        row.error_code = null;
        row.error_message = null;
        row.next_attempt_at = nextAttemptAt;
        row.locked_until = null;
        row.updated_at = updatedAt;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_video_jobs SET status = 'ingesting', provider_state = ?, locked_until = NULL, updated_at = ? WHERE id = ?") {
      const [providerState, updatedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.status = 'ingesting';
        row.provider_state = providerState;
        row.locked_until = null;
        row.updated_at = updatedAt;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_video_jobs SET status = 'succeeded', output_r2_key = ?, output_url = ?, output_content_type = ?, output_size_bytes = ?, poster_r2_key = ?, poster_url = ?, poster_content_type = ?, poster_size_bytes = ?, provider_task_id = COALESCE(?, provider_task_id), provider_state = ?, error_code = NULL, error_message = NULL, locked_until = NULL, updated_at = ?, completed_at = ? WHERE id = ?") {
      const [outputR2Key, outputUrl, outputContentType, outputSizeBytes, posterR2Key, posterUrl, posterContentType, posterSizeBytes, providerTaskId, providerState, updatedAt, completedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.status = 'succeeded';
        row.output_r2_key = outputR2Key;
        row.output_url = outputUrl;
        row.output_content_type = outputContentType;
        row.output_size_bytes = outputSizeBytes;
        row.poster_r2_key = posterR2Key;
        row.poster_url = posterUrl;
        row.poster_content_type = posterContentType;
        row.poster_size_bytes = posterSizeBytes;
        if (providerTaskId) row.provider_task_id = providerTaskId;
        row.provider_state = providerState;
        row.error_code = null;
        row.error_message = null;
        row.locked_until = null;
        row.updated_at = updatedAt;
        row.completed_at = completedAt;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (query === "UPDATE ai_video_jobs SET budget_policy_json = ?, budget_policy_status = ?, budget_policy_fingerprint = ?, budget_policy_version = ?, updated_at = ? WHERE id = ?") {
      const [budgetPolicyJson, budgetPolicyStatus, budgetPolicyFingerprint, budgetPolicyVersion, updatedAt, jobId] = bindings;
      let changes = 0;
      for (const row of this.state.aiVideoJobs) {
        if (row.id !== jobId) continue;
        row.budget_policy_json = budgetPolicyJson;
        row.budget_policy_status = budgetPolicyStatus;
        row.budget_policy_fingerprint = budgetPolicyFingerprint;
        row.budget_policy_version = budgetPolicyVersion;
        row.updated_at = updatedAt;
        changes += 1;
      }
      return { success: true, meta: { changes } };
    }

    if (query === 'INSERT INTO ai_video_job_poison_messages (id, queue_name, message_type, schema_version, job_id, reason_code, body_summary, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)') {
      const [id, queueName, messageType, schemaVersion, jobId, reasonCode, bodySummary, correlationId, createdAt] = bindings;
      this.state.aiVideoJobPoisonMessages.push({
        id,
        queue_name: queueName,
        message_type: messageType,
        schema_version: schemaVersion,
        job_id: jobId,
        reason_code: reasonCode,
        body_summary: bodySummary,
        correlation_id: correlationId,
        created_at: createdAt,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (query.startsWith('SELECT id, queue_name, message_type, schema_version, job_id, reason_code, body_summary, correlation_id, created_at FROM ai_video_job_poison_messages')) {
      if (query.includes('WHERE id = ?')) {
        const [poisonId] = bindings;
        return deepClone(this.state.aiVideoJobPoisonMessages.find((row) => row.id === poisonId) || null);
      }

      const hasCursor = query.includes('WHERE created_at < ? OR (created_at = ? AND id < ?)');
      const limit = Number(bindings.at(-1)) || 20;
      let rows = [...this.state.aiVideoJobPoisonMessages];
      if (hasCursor) {
        const [cursorTime, , cursorId] = bindings;
        rows = rows.filter((row) => row.created_at < cursorTime || (row.created_at === cursorTime && row.id < cursorId));
      }
      rows.sort((a, b) => {
        if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
        return b.id.localeCompare(a.id);
      });
      return { results: rows.slice(0, limit).map((row) => ({ ...row })) };
    }

    if (
      query.startsWith("SELECT ai_video_jobs.id AS id, ai_video_jobs.user_id AS user_id, users.email AS user_email")
      && query.includes("ai_video_jobs.scope = 'admin'")
      && query.includes("ai_video_jobs.status = 'failed'")
    ) {
      const hasIdLookup = query.includes('WHERE ai_video_jobs.id = ?');
      const hasCursor = query.includes('AND (ai_video_jobs.created_at < ? OR (ai_video_jobs.created_at = ? AND ai_video_jobs.id < ?))');
      let rows = this.state.aiVideoJobs
        .filter((row) => row.scope === 'admin' && row.status === 'failed')
        .map((row) => {
          const user = this.state.users.find((entry) => entry.id === row.user_id);
          return {
            id: row.id,
            user_id: row.user_id,
            user_email: user?.email || null,
            status: row.status,
            provider: row.provider,
            model: row.model,
            provider_task_id: row.provider_task_id,
            attempt_count: row.attempt_count,
            max_attempts: row.max_attempts,
            output_url: row.output_url,
            poster_url: row.poster_url,
            error_code: row.error_code,
            error_message: row.error_message,
            created_at: row.created_at,
            updated_at: row.updated_at,
            completed_at: row.completed_at,
          };
        });

      if (hasIdLookup) {
        const [jobId] = bindings;
        return deepClone(rows.find((row) => row.id === jobId) || null);
      }

      if (hasCursor) {
        const [cursorTime, , cursorId] = bindings;
        rows = rows.filter((row) => row.created_at < cursorTime || (row.created_at === cursorTime && row.id < cursorId));
      }
      rows.sort((a, b) => {
        if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
        return b.id.localeCompare(a.id);
      });
      const limit = Number(bindings.at(-1)) || 20;
      return { results: rows.slice(0, limit).map((row) => ({ ...row })) };
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

    if (query === 'SELECT id, action, created_at FROM user_activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100') {
      const [userId] = bindings;
      const rows = this.state.userActivityLog
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 100)
        .map((row) => ({ id: row.id, action: row.action, created_at: row.created_at }));
      return { results: rows };
    }

    if (query === 'SELECT id, day_start, status, created_at, consumed_at FROM ai_daily_quota_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 100') {
      const [userId] = bindings;
      const rows = this.state.aiDailyQuotaUsage
        .filter((row) => row.user_id === userId)
        .slice()
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 100)
        .map((row) => ({
          id: row.id,
          day_start: row.day_start,
          status: row.status,
          created_at: row.created_at,
          consumed_at: row.consumed_at ?? null,
        }));
      return { results: rows };
    }

    if (query === 'SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = ?') {
      const [userId] = bindings;
      return { cnt: this.state.sessions.filter((row) => row.user_id === userId).length };
    }

    if (query === 'SELECT COUNT(*) AS cnt FROM password_reset_tokens WHERE user_id = ?') {
      const [userId] = bindings;
      return { cnt: this.state.passwordResetTokens.filter((row) => row.user_id === userId).length };
    }

    if (query === 'SELECT COUNT(*) AS cnt FROM email_verification_tokens WHERE user_id = ?') {
      const [userId] = bindings;
      return { cnt: this.state.emailVerificationTokens.filter((row) => row.user_id === userId).length };
    }

    if (query === 'SELECT COUNT(*) AS cnt FROM siwe_challenges WHERE user_id = ?') {
      const [userId] = bindings;
      return { cnt: this.state.siweChallenges.filter((row) => row.user_id === userId).length };
    }

    if (query === 'SELECT COUNT(*) AS cnt FROM admin_mfa_credentials WHERE admin_user_id = ?') {
      const [userId] = bindings;
      return { cnt: this.state.adminMfaCredentials.filter((row) => row.admin_user_id === userId).length };
    }

    if (query === 'SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE target_user_id = ?') {
      const [userId] = bindings;
      return { cnt: this.state.adminAuditLog.filter((row) => row.target_user_id === userId).length };
    }

    if (query === "SELECT id, title, summary, source, url, category, published_at, visual_type, visual_url, visual_status, visual_thumb_url, updated_at FROM news_pulse_items WHERE locale = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY published_at DESC, updated_at DESC LIMIT ?" ||
        query === "SELECT id, title, summary, source, url, category, published_at, visual_type, visual_url, updated_at FROM news_pulse_items WHERE locale = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY published_at DESC, updated_at DESC LIMIT ?") {
      const [locale, now, limit] = bindings;
      const rows = (this.state.newsPulseItems || [])
        .filter((row) => row.locale === locale && row.status === 'active' && (!row.expires_at || row.expires_at > now))
        .slice()
        .sort((a, b) => {
          const published = String(b.published_at || '').localeCompare(String(a.published_at || ''));
          if (published !== 0) return published;
          return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
        })
        .slice(0, Number(limit) || 8)
        .map((row) => ({
          id: row.id,
          title: row.title,
          summary: row.summary,
          source: row.source,
          url: row.url,
          category: row.category,
          published_at: row.published_at,
          visual_type: row.visual_type,
          visual_url: row.visual_url ?? null,
          visual_status: row.visual_status ?? 'missing',
          visual_thumb_url: row.visual_thumb_url ?? null,
          updated_at: row.updated_at,
        }));
      return { results: rows };
    }

    if (query === "SELECT visual_object_key FROM news_pulse_items WHERE id = ? AND status = 'active' AND visual_status = 'ready' AND visual_object_key IS NOT NULL AND (expires_at IS NULL OR expires_at > ?) LIMIT 1") {
      const [id, now] = bindings;
      const row = (this.state.newsPulseItems || [])
        .find((item) =>
          item.id === id &&
          item.status === 'active' &&
          item.visual_status === 'ready' &&
          item.visual_object_key &&
          (!item.expires_at || item.expires_at > now)
        );
      return row ? { visual_object_key: row.visual_object_key } : null;
    }

    if (query === "SELECT id, locale, title, summary, source, url, category, published_at, visual_prompt, visual_status, visual_attempts, expires_at, updated_at FROM news_pulse_items WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?) AND (visual_status = 'missing' OR visual_status = 'failed') AND COALESCE(visual_attempts, 0) < ? ORDER BY published_at DESC, updated_at DESC LIMIT ?") {
      const [now, maxAttempts, limit] = bindings;
      const rows = (this.state.newsPulseItems || [])
        .filter((row) =>
          row.status === 'active' &&
          (!row.expires_at || row.expires_at > now) &&
          ['missing', 'failed'].includes(row.visual_status || 'missing') &&
          Number(row.visual_attempts || 0) < Number(maxAttempts || 3)
        )
        .slice()
        .sort((a, b) => {
          const published = String(b.published_at || '').localeCompare(String(a.published_at || ''));
          if (published !== 0) return published;
          return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
        })
        .slice(0, Number(limit) || 2)
        .map((row) => ({ ...row }));
      return { results: rows };
    }

    if (query === "SELECT id, locale, title, summary, source, url, category, published_at, visual_prompt, visual_status, visual_attempts, expires_at, updated_at FROM news_pulse_items WHERE id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) AND (visual_status = 'missing' OR visual_status = 'failed') AND COALESCE(visual_attempts, 0) < ? LIMIT 1") {
      const [id, now, maxAttempts] = bindings;
      const row = (this.state.newsPulseItems || []).find((item) =>
        item.id === id &&
        item.status === 'active' &&
        (!item.expires_at || item.expires_at > now) &&
        ['missing', 'failed'].includes(item.visual_status || 'missing') &&
        Number(item.visual_attempts || 0) < Number(maxAttempts || 3)
      );
      return row ? { ...row } : null;
    }

    if (query === "UPDATE news_pulse_items SET visual_status = 'pending', visual_error = NULL, visual_attempts = COALESCE(visual_attempts, 0) + 1, visual_updated_at = ? WHERE id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) AND (visual_status = 'missing' OR visual_status = 'failed') AND COALESCE(visual_attempts, 0) < ?") {
      const [updatedAt, id, now, maxAttempts] = bindings;
      const row = this.state.newsPulseItems.find((item) =>
        item.id === id &&
        item.status === 'active' &&
        (!item.expires_at || item.expires_at > now) &&
        ['missing', 'failed'].includes(item.visual_status || 'missing') &&
        Number(item.visual_attempts || 0) < Number(maxAttempts || 3)
      );
      if (!row) return { success: true, meta: { changes: 0 } };
      row.visual_status = 'pending';
      row.visual_error = null;
      row.visual_attempts = Number(row.visual_attempts || 0) + 1;
      row.visual_updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE news_pulse_items SET visual_type = 'generated', visual_url = ?, visual_prompt = ?, visual_status = 'ready', visual_object_key = ?, visual_thumb_url = ?, visual_generated_at = ?, visual_error = NULL, visual_updated_at = ? WHERE id = ? AND visual_status = 'pending'") {
      const [visualUrl, visualPrompt, objectKey, thumbUrl, generatedAt, updatedAt, id] = bindings;
      const row = this.state.newsPulseItems.find((item) => item.id === id && item.visual_status === 'pending');
      if (!row) return { success: true, meta: { changes: 0 } };
      row.visual_type = 'generated';
      row.visual_url = visualUrl;
      row.visual_prompt = visualPrompt;
      row.visual_status = 'ready';
      row.visual_object_key = objectKey;
      row.visual_thumb_url = thumbUrl;
      row.visual_generated_at = generatedAt;
      row.visual_error = null;
      row.visual_updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE news_pulse_items SET visual_status = 'failed', visual_error = ?, visual_updated_at = ? WHERE id = ? AND visual_status = 'pending'") {
      const [visualError, updatedAt, id] = bindings;
      const row = this.state.newsPulseItems.find((item) => item.id === id && item.visual_status === 'pending');
      if (!row) return { success: true, meta: { changes: 0 } };
      row.visual_status = 'failed';
      row.visual_error = visualError;
      row.visual_updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === "UPDATE news_pulse_items SET visual_status = 'skipped', visual_error = ?, visual_updated_at = ? WHERE id = ? AND (visual_status = 'missing' OR visual_status = 'failed' OR visual_status = 'pending')") {
      const [visualError, updatedAt, id] = bindings;
      const row = this.state.newsPulseItems.find((item) => item.id === id && ['missing', 'failed', 'pending'].includes(item.visual_status || 'missing'));
      if (!row) return { success: true, meta: { changes: 0 } };
      row.visual_status = 'skipped';
      row.visual_error = visualError;
      row.visual_updated_at = updatedAt;
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM news_pulse_items WHERE expires_at IS NOT NULL AND expires_at < ?') {
      const [now] = bindings;
      const before = this.state.newsPulseItems.length;
      this.state.newsPulseItems = this.state.newsPulseItems.filter((row) => !row.expires_at || row.expires_at >= now);
      return { success: true, meta: { changes: before - this.state.newsPulseItems.length } };
    }

    if (query.startsWith('INSERT INTO news_pulse_items (')) {
      const [
        id,
        locale,
        title,
        summary,
        source,
        url,
        category,
        publishedAt,
        visualType,
        visualUrl,
        visualPromptOrSourceKey,
        visualUpdatedAtOrContentHash,
        sourceKeyOrExpiresAt,
        contentHashOrCreatedAt,
        expiresAtOrUpdatedAt,
        createdAtMaybe,
        updatedAtMaybe,
      ] = bindings;
      const existing = this.state.newsPulseItems.find((row) => row.id === id);
      const hasVisualColumns = bindings.length >= 17;
      const visualPrompt = hasVisualColumns ? visualPromptOrSourceKey : null;
      const visualUpdatedAt = hasVisualColumns ? visualUpdatedAtOrContentHash : null;
      const sourceKey = hasVisualColumns ? sourceKeyOrExpiresAt : visualPromptOrSourceKey;
      const contentHash = hasVisualColumns ? contentHashOrCreatedAt : visualUpdatedAtOrContentHash;
      const expiresAt = hasVisualColumns ? expiresAtOrUpdatedAt : sourceKeyOrExpiresAt;
      const createdAt = hasVisualColumns ? createdAtMaybe : contentHashOrCreatedAt;
      const updatedAt = hasVisualColumns ? updatedAtMaybe : expiresAtOrUpdatedAt;
      const contentChanged = !existing || String(existing.content_hash || '') !== String(contentHash || '');
      const next = {
        id,
        locale,
        title,
        summary,
        source,
        url,
        category,
        published_at: publishedAt,
        visual_type: hasVisualColumns && !contentChanged ? existing?.visual_type ?? visualType : visualType,
        visual_url: hasVisualColumns && !contentChanged ? existing?.visual_url ?? visualUrl ?? null : visualUrl ?? null,
        visual_prompt: hasVisualColumns
          ? (contentChanged ? visualPrompt : existing?.visual_prompt ?? visualPrompt)
          : existing?.visual_prompt ?? null,
        visual_status: hasVisualColumns
          ? (contentChanged ? 'missing' : existing?.visual_status ?? 'missing')
          : existing?.visual_status ?? 'missing',
        visual_object_key: hasVisualColumns && contentChanged ? null : existing?.visual_object_key ?? null,
        visual_thumb_url: hasVisualColumns && contentChanged ? null : existing?.visual_thumb_url ?? null,
        visual_generated_at: hasVisualColumns && contentChanged ? null : existing?.visual_generated_at ?? null,
        visual_error: hasVisualColumns && contentChanged ? null : existing?.visual_error ?? null,
        visual_attempts: hasVisualColumns && contentChanged ? 0 : Number(existing?.visual_attempts || 0),
        visual_updated_at: hasVisualColumns && contentChanged ? visualUpdatedAt : existing?.visual_updated_at ?? visualUpdatedAt ?? null,
        status: 'active',
        source_key: sourceKey,
        content_hash: contentHash,
        expires_at: expiresAt,
        created_at: existing?.created_at || createdAt,
        updated_at: updatedAt,
      };
      if (existing) {
        Object.assign(existing, next);
      } else {
        this.state.newsPulseItems.push(next);
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (query === 'DELETE FROM openclaw_ingest_nonces WHERE expires_at < ?') {
      const [now] = bindings;
      const before = this.state.openClawIngestNonces.length;
      this.state.openClawIngestNonces = this.state.openClawIngestNonces
        .filter((row) => String(row.expires_at || '') >= String(now || ''));
      return { success: true, meta: { changes: before - this.state.openClawIngestNonces.length } };
    }

    if (query.startsWith('INSERT INTO openclaw_ingest_nonces (')) {
      const [nonce, agent, bodyHash, createdAt, expiresAt] = bindings;
      if (this.state.openClawIngestNonces.some((row) => row.nonce === nonce)) {
        const error = new Error('UNIQUE constraint failed: openclaw_ingest_nonces.nonce');
        error.code = 'SQLITE_CONSTRAINT';
        throw error;
      }
      this.state.openClawIngestNonces.push({
        nonce,
        agent,
        body_hash: bodyHash,
        created_at: createdAt,
        expires_at: expiresAt,
      });
      return { success: true, meta: { changes: 1 } };
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
    SESSION_HASH_SECRET: seed.SESSION_HASH_SECRET === undefined ? 'test-session-hash-secret-v1-32chars' : seed.SESSION_HASH_SECRET,
    PAGINATION_SIGNING_SECRET: seed.PAGINATION_SIGNING_SECRET === undefined ? 'test-pagination-signing-secret-v1-32chars' : seed.PAGINATION_SIGNING_SECRET,
    ADMIN_MFA_ENCRYPTION_KEY: seed.ADMIN_MFA_ENCRYPTION_KEY === undefined ? 'test-admin-mfa-encryption-key-v1-32chars' : seed.ADMIN_MFA_ENCRYPTION_KEY,
    ADMIN_MFA_PROOF_SECRET: seed.ADMIN_MFA_PROOF_SECRET === undefined ? 'test-admin-mfa-proof-secret-v1-32chars' : seed.ADMIN_MFA_PROOF_SECRET,
    ADMIN_MFA_RECOVERY_HASH_SECRET: seed.ADMIN_MFA_RECOVERY_HASH_SECRET === undefined ? 'test-admin-mfa-recovery-hash-secret' : seed.ADMIN_MFA_RECOVERY_HASH_SECRET,
    AI_SAVE_REFERENCE_SIGNING_SECRET: seed.AI_SAVE_REFERENCE_SIGNING_SECRET === undefined ? 'test-ai-save-reference-signing-secret' : seed.AI_SAVE_REFERENCE_SIGNING_SECRET,
    ALLOW_LEGACY_SECURITY_SECRET_FALLBACK: seed.ALLOW_LEGACY_SECURITY_SECRET_FALLBACK,
    AI_SERVICE_AUTH_SECRET: seed.AI_SERVICE_AUTH_SECRET === undefined
      ? 'test-ai-service-auth-secret'
      : seed.AI_SERVICE_AUTH_SECRET,
    BILLING_WEBHOOK_TEST_SECRET: seed.BILLING_WEBHOOK_TEST_SECRET === undefined
      ? 'test-billing-webhook-secret-v1-32chars'
      : seed.BILLING_WEBHOOK_TEST_SECRET,
    ENABLE_ADMIN_STRIPE_TEST_CHECKOUT: seed.ENABLE_ADMIN_STRIPE_TEST_CHECKOUT,
    STRIPE_MODE: seed.STRIPE_MODE,
    STRIPE_SECRET_KEY: seed.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: seed.STRIPE_WEBHOOK_SECRET,
    STRIPE_CHECKOUT_SUCCESS_URL: seed.STRIPE_CHECKOUT_SUCCESS_URL,
    STRIPE_CHECKOUT_CANCEL_URL: seed.STRIPE_CHECKOUT_CANCEL_URL,
    ENABLE_LIVE_STRIPE_CREDIT_PACKS: seed.ENABLE_LIVE_STRIPE_CREDIT_PACKS,
    STRIPE_LIVE_SECRET_KEY: seed.STRIPE_LIVE_SECRET_KEY,
    STRIPE_LIVE_WEBHOOK_SECRET: seed.STRIPE_LIVE_WEBHOOK_SECRET,
    STRIPE_LIVE_CHECKOUT_SUCCESS_URL: seed.STRIPE_LIVE_CHECKOUT_SUCCESS_URL,
    STRIPE_LIVE_CHECKOUT_CANCEL_URL: seed.STRIPE_LIVE_CHECKOUT_CANCEL_URL,
    ENABLE_LIVE_STRIPE_SUBSCRIPTIONS: seed.ENABLE_LIVE_STRIPE_SUBSCRIPTIONS,
    STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: seed.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID,
    STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL: seed.STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL,
    STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL: seed.STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL,
    ALLOW_SYNC_VIDEO_DEBUG: seed.ALLOW_SYNC_VIDEO_DEBUG,
    NEWS_PULSE_SOURCE_URLS: seed.NEWS_PULSE_SOURCE_URLS,
    OPENCLAW_INGEST_SECRET: seed.OPENCLAW_INGEST_SECRET,
    OPENCLAW_INGEST_SECRET_NEXT: seed.OPENCLAW_INGEST_SECRET_NEXT,
    PBKDF2_ITERATIONS: '100000',
    DB,
    PRIVATE_MEDIA,
    USER_IMAGES,
    AUDIT_ARCHIVE,
    ACTIVITY_INGEST_QUEUE,
    AI_IMAGE_DERIVATIVES_QUEUE,
    AI_VIDEO_JOBS_QUEUE,
    __TEST_FETCH: seed.fetch || seed.__TEST_FETCH,
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
  const tokenHash = await sha256Hex(`${token}:${env.SESSION_HASH_SECRET}`);
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
