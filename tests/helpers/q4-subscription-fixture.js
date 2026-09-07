const { createHmac } = require('node:crypto');
const { withMfaFixture, load, fs, path } = require('../q2-mfa-fixtures.cjs');
const { startWorkerHttp } = require('./q2-http.js');

const { MEMBER, OTHER, PRICE, SECRET, START, END, checkout, sessionEvent, invoiceEvent, lifecycleEvent } = require('./q4-subscription-payloads.cjs');
async function withSubscription(run) {
  return withMfaFixture(async f => {
    const originalFetch = globalThis.fetch; let denied = 0; let http;
    const deny = async () => { denied += 1; throw new Error('Unexpected external Q4 subscription call'); };
    globalThis.fetch = deny;
    Object.assign(f.env, { STRIPE_LIVE_WEBHOOK_SECRET: SECRET, STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: PRICE, __TEST_FETCH: deny, AI: { run: deny }, AI_LAB: { fetch: deny } });
    try {
      for (const name of ['0083_add_r2_cleanup_reference_fence.sql', '0085_add_member_subscription_fulfillment.sql']) {
        const file = path.join(process.cwd(), 'workers/auth/migrations', name);
        f.db.exec(fs.readFileSync(file, 'utf8'));
      }
      for (const id of [MEMBER, OTHER]) await f.db.prepare(`INSERT INTO users (id,email,password_hash,created_at,role,status,email_verified_at)
        VALUES (?,?,'synthetic-unused',?,'user','active',?)`).bind(id, id+'@example.invalid', new Date().toISOString(), new Date().toISOString()).run();
      await f.db.prepare(`INSERT INTO billing_member_subscription_checkout_sessions
        (id,provider,provider_mode,provider_checkout_session_id,user_id,plan_id,provider_price_id,amount_cents,currency,status,
         idempotency_key_hash,request_fingerprint_hash,authorization_scope,metadata_json,created_at,updated_at)
        VALUES (?,'stripe','live',?,?,'bitbi_pro_monthly',?,999,'eur','created',?,?,'member','{}',?,?)`)
        .bind(checkout.id,checkout.session,MEMBER,PRICE,'a'.repeat(64),'b'.repeat(64),new Date().toISOString(),new Date().toISOString()).run();
      const worker = (await load('workers/auth/src/index.js')).default;
      http = await startWorkerHttp(worker, f.env); f.http = http;
      f.deliver = async (payload, { invalidSignature = false, timestamp = Math.floor(Date.now()/1000) } = {}) => {
        const raw = JSON.stringify(payload); const signature = createHmac('sha256', SECRET).update(`${timestamp}.${raw}`).digest('hex');
        const response = await http.request('/api/billing/webhooks/stripe/live', { method: 'POST', headers: { 'Content-Type':'application/json', 'CF-Connecting-IP':'192.0.2.81', 'Stripe-Signature':`t=${timestamp},v1=${invalidSignature ? '0'.repeat(64) : signature}` }, body: raw });
        return { status: response.status, body: await response.json() };
      };
      await run(f);
      if (denied) throw new Error(`Q4 fixture attempted ${denied} external calls`);
      const violations = f.db.database.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) throw new Error('Q4 fixture foreign key violations');
    } finally { if (http) await http.close(); globalThis.fetch = originalFetch; }
  }, { enroll: false });
}
function state(f) {
  const all = (sql,...args) => f.db.database.prepare(sql).all(...args);
  return { ledger: all('SELECT * FROM member_credit_ledger ORDER BY rowid'), buckets: all('SELECT * FROM member_credit_buckets ORDER BY rowid'),
    bucketEvents: all('SELECT * FROM member_credit_bucket_events ORDER BY rowid'), subscriptions: all('SELECT * FROM billing_member_subscriptions'),
    checkouts: all('SELECT * FROM billing_member_subscription_checkout_sessions'), events: all('SELECT * FROM billing_provider_events ORDER BY rowid'),
    actions: all('SELECT * FROM billing_event_actions ORDER BY rowid') };
}
module.exports = { withSubscription, state, sessionEvent, invoiceEvent, lifecycleEvent, checkout, MEMBER, OTHER, PRICE, START, END, load };
