const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const TABLES = {
  users: 'users', organizations: 'organizations', organization_memberships: 'organizationMemberships',
  plans: 'plans', organization_subscriptions: 'organizationSubscriptions', entitlements: 'entitlements',
  billing_customers: 'billingCustomers', credit_ledger: 'creditLedger', member_credit_ledger: 'memberCreditLedger',
  billing_provider_events: 'billingProviderEvents', billing_event_actions: 'billingEventActions',
  billing_checkout_sessions: 'billingCheckoutSessions', billing_member_checkout_sessions: 'billingMemberCheckoutSessions',
  billing_member_subscriptions: 'billingMemberSubscriptions', member_credit_buckets: 'memberCreditBuckets',
  member_credit_bucket_events: 'memberCreditBucketEvents',
};
const PARENTS = new Set(['users', 'organizations', 'organization_memberships']);
const MIGRATIONS = [
  '0035_add_billing_entitlements.sql', '0037_add_billing_event_ingestion.sql',
  '0038_add_stripe_credit_pack_checkout.sql', '0040_add_live_stripe_credit_pack_scope.sql',
  '0041_add_member_credit_ledger.sql', '0042_add_member_live_stripe_checkout.sql',
  '0047_add_member_subscriptions_and_credit_buckets.sql', '0065_allow_live_billing_event_verification_status.sql',
];
const normalize = sql => sql.replace(/\s+/g, ' ').trim();

// Only Q2's new SQL forms are delegated. Consumption, subscriptions, operator
// cleanup and every other legacy mock branch retain their existing dispatcher.
function isBillingSql(sql) {
  const q = normalize(sql);
  return /\$\.creditPack(?:CheckoutIdentity|ValidatedCheckoutId)|\$\.fulfillmentStatus/.test(q)
    || q.startsWith('INSERT OR IGNORE INTO billing_event_actions ')
    || (/^INSERT(?: OR IGNORE)? INTO member_credit_buckets\b/.test(q) && q.includes(' SELECT '))
    || (q.startsWith('UPDATE member_credit_buckets SET balance = balance + ') && (
      q.includes('MAX(0, COALESCE(') || q.includes('(SELECT amount FROM member_credit_ledger')
      || q.includes('AND EXISTS (SELECT 1 FROM member_credit_ledger WHERE id = ?)')))
    || (q.startsWith('INSERT INTO member_credit_bucket_events ') && (
      q.includes('FROM member_credit_ledger l WHERE l.id = ? AND l.amount > 0')
      || q.includes("FROM member_credit_buckets b WHERE b.user_id = ? AND b.bucket_type = 'purchased'")))
    || (/^INSERT INTO (?:member_)?credit_ledger\b/.test(q) && q.includes('MAX(?, COALESCE((SELECT created_at FROM '))
    || /^UPDATE (?:member_)?credit_ledger SET amount = NULL WHERE /.test(q)
    || /^UPDATE billing_(?:member_)?checkout_sessions SET (?:member_)?credit_ledger_entry_id = \(SELECT /.test(q)
    || /^SELECT \* FROM (?:member_)?credit_ledger WHERE /.test(q)
    || /^SELECT id FROM credit_ledger WHERE organization_id = \? AND idempotency_key = \?$/.test(q)
    || /^SELECT COALESCE\(\(SELECT (?:SUM\(balance\) FROM member_credit_buckets|balance_after FROM (?:member_)?credit_ledger) .* AS balance$/.test(q);
}

let schema;
function getSchema() {
  if (schema) return schema;
  const db = new DatabaseSync(':memory:');
  try {
    // These parent tables project ONLY the actual fixture identity and guard
    // fields. Missing roles/status remain NULL; no authorized user is invented.
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, status TEXT);
      CREATE TABLE organizations (id TEXT PRIMARY KEY, status TEXT);
      CREATE TABLE organization_memberships (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, role TEXT, status TEXT,
        FOREIGN KEY (organization_id) REFERENCES organizations(id), FOREIGN KEY (user_id) REFERENCES users(id));`);
    for (const file of MIGRATIONS) db.exec(fs.readFileSync(path.join(__dirname, '../../workers/auth/migrations', file), 'utf8'));
    // The additive nullable token columns are preserved. AI debit statements
    // are not routed here, so their 0081 dispatch triggers remain outside this
    // grant-only fixture projection and are covered by the native Q2 suites.
    const dispatch = fs.readFileSync(path.join(__dirname, '../../workers/auth/migrations/0081_add_ai_dispatch_outcome_guards.sql'), 'utf8');
    for (const table of ['member_credit_ledger', 'credit_ledger']) {
      const statement = dispatch.match(new RegExp(`ALTER TABLE ${table} ADD COLUMN ai_dispatch_token TEXT;`));
      if (!statement) throw new Error(`Q2 billing schema contract missing: ${table}.ai_dispatch_token`);
      db.exec(statement[0]);
    }
    const tables = {};
    for (const table of Object.keys(TABLES)) {
      tables[table] = {
        columns: db.prepare(`PRAGMA table_info(${table})`).all(),
        foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
        sql: db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql,
        indexes: db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table).map(row => row.sql),
      };
    }
    schema = tables;
    return schema;
  } finally { db.close(); }
}

function projection(host, entries, definitions) {
  const selected = new Map();
  const include = (table, row) => {
    if (!selected.has(table)) selected.set(table, new Set());
    if (selected.get(table).has(row)) return;
    selected.get(table).add(row);
    for (const fk of definitions[table].foreignKeys) {
      if (row[fk.from] == null) continue;
      if (!TABLES[fk.table]) throw new Error(`Q2 billing fixture relation not projected: ${fk.table}`);
      for (const parent of host.state[TABLES[fk.table]] || []) {
        if (parent[fk.to] === row[fk.from]) include(fk.table, parent);
      }
    }
  };
  // New INSERTs can reference an existing parent only through a binding: an
  // empty target table supplies no old row from which to discover that FK.
  // Keep the real fixture identities available, including NULL guard fields.
  for (const table of PARENTS) {
    for (const row of host.state[TABLES[table]] || []) include(table, row);
  }
  const boundValues = new Set(entries.flatMap(entry => entry.bindings));
  for (const table of Object.keys(TABLES)) {
    if (!entries.some(entry => new RegExp(`\\b${table}\\b`).test(entry.query))) continue;
    selected.set(table, selected.get(table) || new Set());
    for (const row of host.state[TABLES[table]] || []) include(table, row);
    // The same case applies to a first subscription bucket's local FK. Import
    // an existing referenced record; never synthesize one from the binding.
    for (const fk of definitions[table].foreignKeys) {
      for (const parent of host.state[TABLES[fk.table]] || []) {
        if (parent[fk.to] != null && boundValues.has(parent[fk.to])) include(fk.table, parent);
      }
    }
  }
  return selected;
}

function assertFaultPolicy(host, query) {
  if (host.failQueries.some(value => query.includes(value))) throw new Error('forced query failure');
  for (const table of host.missingTables) {
    if (new RegExp(`\\b${table}\\b`).test(query)) throw new Error(`no such table: ${table}`);
  }
}

function execute(db, { query, bindings, mode }) {
  const statement = db.prepare(query);
  if (mode === 'first') return statement.get(...bindings) || null;
  if (mode === 'all') return { results: statement.all(...bindings) };
  const returnsRows = statement.columns().length > 0;
  const before = returnsRows ? db.prepare('SELECT total_changes() AS n').get().n : null;
  const results = returnsRows ? statement.all(...bindings) : [];
  const result = returnsRows
    ? db.prepare('SELECT CASE WHEN total_changes() = ? THEN 0 ELSE changes() END AS changes, last_insert_rowid() AS lastInsertRowid').get(before)
    : statement.run(...bindings);
  return { success: true, results, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
}

// SQL conditions/constraints execute unchanged in native SQLite. This is a
// fixture adapter, not a real D1/full-schema claim: seed arrays are its source,
// and only these new billing batches receive native transaction semantics.
function executeNativeBilling(host, entries, { batch = false } = {}) {
  if (!entries.length || entries.some(entry => !isBillingSql(entry.query))) {
    throw new Error('Q2 billing bridge received an unsupported SQL form');
  }
  const definitions = getSchema();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    for (const definition of Object.values(definitions)) db.exec(definition.sql);
    for (const definition of Object.values(definitions)) for (const index of definition.indexes) db.exec(index);
    const selected = projection(host, entries, definitions);
    // Deferred checks are confined to importing a mutually referencing fixture
    // graph. COMMIT still checks all FKs before any product SQL is executed.
    db.exec('BEGIN; PRAGMA defer_foreign_keys = ON;');
    for (const [table, rows] of selected) {
      const names = new Set(definitions[table].columns.map(column => column.name));
      for (const row of rows) {
        const columns = Object.keys(row).filter(key => names.has(key) && row[key] !== undefined);
        if (!columns.length) throw new Error(`Q2 billing fixture has no schema columns: ${table}`);
        // Omitted columns use actual schema defaults; explicit NULL stays NULL.
        db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(key => row[key]));
      }
    }
    db.exec('COMMIT');
    const results = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of entries) {
        if (batch) host.runCalls.push({ query: entry.query, bindings: JSON.parse(JSON.stringify(entry.bindings)) });
        assertFaultPolicy(host, entry.query);
        results.push(execute(db, entry));
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const mutated = new Set(entries.filter(entry => entry.mode === 'run').map(entry =>
      normalize(entry.query).match(/^(?:INSERT(?: OR IGNORE)? INTO|UPDATE) ([a-z_]+)/)?.[1]).filter(Boolean));
    for (const table of mutated) {
      if (!TABLES[table] || PARENTS.has(table)) throw new Error(`Q2 billing bridge cannot mutate ${table}`);
      const key = definitions[table].columns.find(column => column.pk)?.name;
      if (!key) throw new Error(`Q2 billing table lacks a fixture identity: ${table}`);
      const oldRows = host.state[TABLES[table]] || [];
      const previous = new Map(oldRows.map(row => [row[key], row]));
      // A mutation's target table is always fully projected, so replacing its
      // array loses no unrelated fixture rows. Preserve existing object handles.
      host.state[TABLES[table]] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
        .map(row => Object.assign(previous.get(row[key]) || {}, row));
    }
    host._lastChanges = results.at(-1)?.meta?.changes ?? host._lastChanges;
    return batch ? results : results[0];
  } finally { db.close(); }
}

module.exports = { isBillingSql, executeNativeBilling };
