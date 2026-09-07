// Coherent subscription coverage moved intact from workers.spec.js for Q4.
// Mock-backed neighbor contracts remain separate from signed native FK cases.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAuthTestEnv, createExecutionContext, loadWorker, nowIso, seedSession } = require('./helpers/auth-worker-harness');
const moduleAt = file => import(pathToFileURL(path.join(process.cwd(), file)).href);
const loadBillingModule = () => moduleAt('workers/auth/src/lib/billing.js');
const loadStripeBillingModule = () => moduleAt('workers/auth/src/lib/stripe-billing.js');
const loadAssetStorageQuotaModule = () => moduleAt('workers/auth/src/lib/asset-storage-quota.js');
const loadRoutePolicyModule = () => moduleAt('workers/auth/src/app/route-policy.js');
function createContractUser({ id='admin-ai-user', role='admin', email, created_at }={}) {
  return { id, email:email || `${id}@example.com`, password_hash:'unused', created_at:created_at || nowIso(), status:'active',role,email_verified_at:nowIso(),verification_method:'email_verified' };
}
const createAdminUser = id => createContractUser({ id, role:'admin' });
function authJsonRequest(pathname,method,body,headers={}) {
  const requestHeaders=new Headers(headers);if(body!==undefined)requestHeaders.set('Content-Type','application/json');
  return new Request(`https://bitbi.ai${pathname}`,{method,headers:requestHeaders,body:body!==undefined?JSON.stringify(body):undefined});
}

const { withSubscription, state: nativeState, invoiceEvent, lifecycleEvent, MEMBER, PRICE, START, END, checkout } = require('./helpers/q4-subscription-fixture.js');
async function seedNativeBuckets(f, subscriptionCredits) {
  const billing=await loadBillingModule();
  for(const [type,amount] of [['legacy_or_bonus',300],['purchased',4000],['subscription',subscriptionCredits]])
    if(amount>0) await billing.grantMemberCredits({env:f.env,userId:MEMBER,amount,createdByUserId:MEMBER,idempotencyKey:`q4-neighbor-${type}`,source:'synthetic_legacy_fixture',creditBucketType:type,
      bucketScope:type==='subscription'?{providerSubscriptionId:checkout.subscription,periodStart:new Date(START*1000).toISOString(),periodEnd:new Date(END*1000).toISOString()}:null});
}

test.describe('BITBI Pro member subscriptions', () => {
  const PERIOD_START_DATE = new Date();
  PERIOD_START_DATE.setUTCDate(1);
  PERIOD_START_DATE.setUTCHours(0, 0, 0, 0);
  const PERIOD_END_DATE = new Date(PERIOD_START_DATE);
  PERIOD_END_DATE.setUTCMonth(PERIOD_END_DATE.getUTCMonth() + 1);
  const PERIOD_START = PERIOD_START_DATE.toISOString();
  const PERIOD_END = PERIOD_END_DATE.toISOString();
  const PERIOD_START_SECONDS = Math.floor(PERIOD_START_DATE.getTime() / 1000);
  const PERIOD_END_SECONDS = Math.floor(PERIOD_END_DATE.getTime() / 1000);

  function seedBucketedMember({
    userId = 'member-subscription-user',
    subscriptionCredits = 0,
    legacyOrBonusCredits = 0,
    purchasedCredits = 0,
    subscriptionStatus = 'active',
    periodEnd = PERIOD_END,
    cancelAtPeriodEnd = 0,
  } = {}) {
    const user = createContractUser({ id: userId, role: 'user' });
    const total = subscriptionCredits + legacyOrBonusCredits + purchasedCredits;
    const buckets = [
      {
        id: `mcb_${userId}_legacy`,
        user_id: userId,
        bucket_type: 'legacy_or_bonus',
        balance: legacyOrBonusCredits,
        local_subscription_id: null,
        provider_subscription_id: null,
        period_start: null,
        period_end: null,
        source: 'test_seed',
        metadata_json: '{}',
        created_at: '2026-04-30T00:00:00.000Z',
        updated_at: '2026-04-30T00:00:00.000Z',
      },
      {
        id: `mcb_${userId}_purchased`,
        user_id: userId,
        bucket_type: 'purchased',
        balance: purchasedCredits,
        local_subscription_id: null,
        provider_subscription_id: null,
        period_start: null,
        period_end: null,
        source: 'stripe_live_checkout',
        metadata_json: '{}',
        created_at: '2026-04-30T00:00:00.000Z',
        updated_at: '2026-04-30T00:00:00.000Z',
      },
    ];
    if (subscriptionCredits > 0) {
      buckets.push({
        id: `mcb_${userId}_subscription`,
        user_id: userId,
        bucket_type: 'subscription',
        balance: subscriptionCredits,
        local_subscription_id: `msub_${userId}`,
        provider_subscription_id: 'sub_member_pro_123456',
        period_start: PERIOD_START,
        period_end: periodEnd,
        source: 'subscription_period_top_up',
        metadata_json: '{}',
        created_at: PERIOD_START,
        updated_at: PERIOD_START,
      });
    }
    return createAuthTestEnv({
      users: [user],
      billingMemberSubscriptions: [{
        id: `msub_${userId}`,
        user_id: userId,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_id: 'cus_member_pro_123456',
        provider_subscription_id: 'sub_member_pro_123456',
        provider_price_id: 'price_member_pro_123456',
        status: subscriptionStatus,
        current_period_start: PERIOD_START,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
        canceled_at: null,
        metadata_json: '{}',
        created_at: PERIOD_START,
        updated_at: PERIOD_START,
      }],
      memberCreditLedger: total > 0 ? [{
        id: `mcl_${userId}_seed`,
        user_id: userId,
        amount: total,
        balance_after: total,
        entry_type: 'grant',
        feature_key: null,
        source: 'test_seed',
        idempotency_key: `seed-${userId}`,
        request_hash: 'seed',
        created_by_user_id: null,
        created_at: '2026-04-30T00:00:00.000Z',
        metadata_json: '{}',
      }] : [],
      memberCreditBuckets: buckets,
    });
  }

  test('storage limit is 50 MB for free users and 5 GB for active subscription periods', async () => {
    const {
      USER_ASSET_STORAGE_LIMIT_BYTES,
      SUBSCRIBED_USER_ASSET_STORAGE_LIMIT_BYTES,
      getUserAssetStorageUsageSnapshot,
    } = await loadAssetStorageQuotaModule();

    const freeUserId = 'storage-free-subscription-user';
    const freeEnv = createAuthTestEnv({
      users: [createContractUser({ id: freeUserId, role: 'user' })],
      userAssetStorageUsage: [{ user_id: freeUserId, used_bytes: 0, updated_at: nowIso() }],
    });
    await expect(getUserAssetStorageUsageSnapshot(freeEnv, freeUserId)).resolves.toMatchObject({
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      hasActiveSubscription: false,
      plan: 'free',
    });

    for (const [userId, cancelAtPeriodEnd] of [
      ['storage-active-subscription-user', 0],
      ['storage-cancel-period-subscription-user', 1],
    ]) {
      const env = createAuthTestEnv({
        users: [createContractUser({ id: userId, role: 'user' })],
        billingMemberSubscriptions: [{
          id: `msub_${userId}`,
          user_id: userId,
          provider: 'stripe',
          provider_mode: 'live',
          provider_customer_id: 'cus_storage_member',
          provider_subscription_id: `sub_storage_${userId}`,
          provider_price_id: 'price_member_pro_123456',
          status: 'active',
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          cancel_at_period_end: cancelAtPeriodEnd,
          canceled_at: cancelAtPeriodEnd ? '2026-05-15T00:00:00.000Z' : null,
          metadata_json: '{}',
          created_at: PERIOD_START,
          updated_at: PERIOD_START,
        }],
        userAssetStorageUsage: [{ user_id: userId, used_bytes: USER_ASSET_STORAGE_LIMIT_BYTES + 1, updated_at: nowIso() }],
      });
      await expect(getUserAssetStorageUsageSnapshot(env, userId)).resolves.toMatchObject({
        limitBytes: SUBSCRIBED_USER_ASSET_STORAGE_LIMIT_BYTES,
        hasActiveSubscription: true,
        plan: 'bitbi_pro',
      });
    }

    const expiredUserId = 'storage-expired-subscription-user';
    const expiredEnv = createAuthTestEnv({
      users: [createContractUser({ id: expiredUserId, role: 'user' })],
      billingMemberSubscriptions: [{
        id: `msub_${expiredUserId}`,
        user_id: expiredUserId,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_id: 'cus_storage_expired',
        provider_subscription_id: 'sub_storage_expired',
        provider_price_id: 'price_member_pro_123456',
        status: 'canceled',
        current_period_start: '2026-04-01T00:00:00.000Z',
        current_period_end: '2026-05-01T00:00:00.000Z',
        cancel_at_period_end: 0,
        canceled_at: '2026-05-01T00:00:00.000Z',
        metadata_json: '{}',
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:00:00.000Z',
      }],
      userAssetStorageUsage: [{ user_id: expiredUserId, used_bytes: USER_ASSET_STORAGE_LIMIT_BYTES + 1, updated_at: nowIso() }],
    });
    await expect(getUserAssetStorageUsageSnapshot(expiredEnv, expiredUserId)).resolves.toMatchObject({
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      hasActiveSubscription: false,
      plan: 'free',
    });
  });

  test('subscription top-up restores only the subscription bucket and leaves purchased and legacy credits unchanged', async () => {
    const {
      getMemberCreditBucketBalances,
      topUpMemberSubscriptionCredits,
    } = await loadBillingModule();
    const env = seedBucketedMember({
      subscriptionCredits: 2000,
      purchasedCredits: 4000,
      legacyOrBonusCredits: 300,
    });

    const result = await topUpMemberSubscriptionCredits({
      env,
      userId: 'member-subscription-user',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_renewal_01',
      providerEventId: 'evt_member_pro_renewal_01',
    });
    expect(result.grantedCredits).toBe(4000);
    await expect(getMemberCreditBucketBalances(env, 'member-subscription-user')).resolves.toMatchObject({
      subscriptionCredits: 6000,
      purchasedCredits: 4000,
      legacyOrBonusCredits: 300,
      totalCredits: 10300,
    });
    expect(env.DB.state.memberCreditLedger.at(-1)).toEqual(expect.objectContaining({
      source: 'subscription_period_top_up',
      amount: 4000,
      balance_after: 10300,
    }));
  });

  test('subscription top-up grants 6000 from zero, grants nothing when full, and is idempotent', async () => {
    const {
      getMemberCreditBucketBalances,
      topUpMemberSubscriptionCredits,
    } = await loadBillingModule();
    const zeroEnv = seedBucketedMember({
      userId: 'member-subscription-zero',
      subscriptionCredits: 0,
      purchasedCredits: 4000,
    });
    const zero = await topUpMemberSubscriptionCredits({
      env: zeroEnv,
      userId: 'member-subscription-zero',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_zero_01',
      providerEventId: 'evt_member_pro_zero_01',
    });
    expect(zero.grantedCredits).toBe(6000);
    await expect(getMemberCreditBucketBalances(zeroEnv, 'member-subscription-zero')).resolves.toMatchObject({
      subscriptionCredits: 6000,
      purchasedCredits: 4000,
      totalCredits: 10000,
    });

    const ledgerCount = zeroEnv.DB.state.memberCreditLedger.length;
    const duplicate = await topUpMemberSubscriptionCredits({
      env: zeroEnv,
      userId: 'member-subscription-zero',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_zero_01',
      providerEventId: 'evt_member_pro_zero_01',
    });
    expect(duplicate.reused).toBe(true);
    expect(zeroEnv.DB.state.memberCreditLedger).toHaveLength(ledgerCount);

    const fullEnv = seedBucketedMember({
      userId: 'member-subscription-full',
      subscriptionCredits: 6000,
      purchasedCredits: 1200,
      legacyOrBonusCredits: 100,
    });
    const full = await topUpMemberSubscriptionCredits({
      env: fullEnv,
      userId: 'member-subscription-full',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_full_01',
      providerEventId: 'evt_member_pro_full_01',
    });
    expect(full.grantedCredits).toBe(0);
    expect(fullEnv.DB.state.memberCreditLedger).toHaveLength(1);
    await expect(getMemberCreditBucketBalances(fullEnv, 'member-subscription-full')).resolves.toMatchObject({
      subscriptionCredits: 6000,
      purchasedCredits: 1200,
      legacyOrBonusCredits: 100,
      totalCredits: 7300,
    });
  });

  test('subscription checkout uses Stripe subscription mode and grants no credits before paid invoice', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-subscription-checkout', role: 'user' });
    const calls = [];
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_SUBSCRIPTIONS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_subscription_checkout_secret_123456',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_subscription_checkout_secret_123456',
      STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: 'price_member_pro_123456',
      STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: async (url, init = {}) => {
        calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
        return new Response(JSON.stringify({
          id: 'cs_live_member_subscription_checkout',
          object: 'checkout.session',
          livemode: true,
          mode: 'subscription',
          url: 'https://checkout.stripe.com/c/pay/cs_live_member_subscription_checkout',
          subscription: 'sub_member_subscription_checkout',
          customer: 'cus_member_subscription_checkout',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const token = await seedSession(env, member.id);
    const missingIdempotency = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-05-05',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(missingIdempotency.status).toBe(428);
    await expect(missingIdempotency.json()).resolves.toMatchObject({
      code: 'idempotency_key_required',
    });
    expect(calls).toHaveLength(0);

    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-05-05',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-checkout-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      checkout_scope: 'member_subscription',
      checkout_url: 'https://checkout.stripe.com/c/pay/cs_live_member_subscription_checkout',
    }));
    expect(calls[0].form.mode).toBe('subscription');
    expect(calls[0].form['line_items[0][price]']).toBe('price_member_pro_123456');
    expect(calls[0].form['metadata[checkout_scope]']).toBe('member_subscription');
    expect(calls[0].form['subscription_data[metadata][user_id]']).toBe(member.id);
    expect(env.DB.state.memberCreditLedger).toHaveLength(0);
    expect(env.DB.state.memberCreditBuckets).toHaveLength(0);

    const replay = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-05-05',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-checkout-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      reused: true,
      checkout_scope: 'member_subscription',
      session_id: 'cs_live_member_subscription_checkout',
    });
    expect(calls).toHaveLength(1);

    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_reconfigured';
    const conflict = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-05-05',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-checkout-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(calls).toHaveLength(1);
    expect(env.DB.state.memberCreditLedger).toHaveLength(0);
    expect(env.DB.state.memberCreditBuckets).toHaveLength(0);
  });

  test('paid subscription invoice webhook is idempotent and tops up subscription credits only', async () => withSubscription(async f => {
    // Fresh period with retained 300/4000 other buckets. An ambiguous old 2000 bucket
    // requires reconciliation; the original pure top-up control remains above.
    await seedNativeBuckets(f,0);
    const first=await f.deliver(invoiceEvent());expect(first.status).toBe(202);
    expect(first.body.creditGrant).toMatchObject({userId:MEMBER,creditsGranted:6000,balanceAfter:10300,subscriptionCredits:6000});
    const ledgerCount=nativeState(f).ledger.length;
    const second=invoiceEvent('evt_q4_legacy_neighbor_second');second.type='invoice.payment_succeeded';
    const repeated=await f.deliver(second);expect(repeated.status).toBe(202);
    expect(repeated.body.creditGrant).toMatchObject({userId:MEMBER,creditsGranted:0,balanceAfter:10300,subscriptionCredits:6000,reused:true});
    const duplicate=await f.deliver(invoiceEvent());expect(duplicate.status).toBe(200);expect(duplicate.body.duplicate).toBe(true);
    expect(nativeState(f).ledger).toHaveLength(ledgerCount);
    expect(nativeState(f).buckets.find(row=>row.bucket_type==='purchased').balance).toBe(4000);
    expect(nativeState(f).buckets.find(row=>row.bucket_type==='legacy_or_bonus').balance).toBe(300);
  }));

  test('subscription invoice webhooks ignore one-off, wrong-price, and missing-price invoices without granting credits', async () => {
    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const {
      getMemberCreditBucketBalances,
    } = await loadBillingModule();
    const env = seedBucketedMember({
      userId: 'member-subscription-ignored-invoices',
      subscriptionCredits: 2000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 4000,
    });
    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_123456';
    const ledgerCount = env.DB.state.memberCreditLedger.length;

    const oneOffPayload = {
      id: 'evt_member_subscription_one_off_invoice',
      object: 'event',
      type: 'invoice.paid',
      livemode: true,
      data: {
        object: {
          id: 'in_member_subscription_one_off',
          object: 'invoice',
          livemode: true,
          status: 'paid',
          customer: 'cus_member_pro_123456',
          lines: { data: [] },
          metadata: { user_id: 'member-subscription-ignored-invoices' },
        },
      },
    };
    const oneOff = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(oneOffPayload),
      payload: oneOffPayload,
      verificationStatus: 'verified_test_signature',
    });
    expect(oneOff.actionPlanned).toBe(false);
    expect(env.DB.state.billingProviderEvents.at(-1).processing_status).toBe('ignored');

    const wrongPricePayload = {
      id: 'evt_member_subscription_wrong_price_invoice',
      object: 'event',
      type: 'invoice.paid',
      livemode: true,
      data: {
        object: {
          id: 'in_member_subscription_wrong_price',
          object: 'invoice',
          livemode: true,
          status: 'paid',
          customer: 'cus_member_pro_123456',
          lines: {
            data: [{
              pricing: {
                price_details: {
                  price: 'price_unrelated_123456',
                  product: 'prod_unrelated_123456',
                },
              },
              parent: {
                subscription_item_details: {
                  subscription: 'sub_member_pro_123456',
                },
              },
              period: { start: PERIOD_START_SECONDS, end: PERIOD_END_SECONDS },
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            }],
          },
          parent: {
            subscription_details: {
              subscription: 'sub_member_pro_123456',
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            },
          },
        },
      },
    };
    const wrongPrice = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(wrongPricePayload),
      payload: wrongPricePayload,
      verificationStatus: 'verified_test_signature',
    });
    expect(wrongPrice.actionPlanned).toBe(false);
    expect(env.DB.state.billingProviderEvents.at(-1).processing_status).toBe('ignored');

    const missingPricePayload = {
      id: 'evt_member_subscription_missing_price_invoice',
      object: 'event',
      type: 'invoice.paid',
      livemode: true,
      data: {
        object: {
          id: 'in_member_subscription_missing_price',
          object: 'invoice',
          livemode: true,
          status: 'paid',
          customer: 'cus_member_pro_123456',
          lines: {
            data: [{
              parent: {
                subscription_item_details: {
                  subscription: 'sub_member_pro_123456',
                },
              },
              period: { start: PERIOD_START_SECONDS, end: PERIOD_END_SECONDS },
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            }],
          },
          parent: {
            subscription_details: {
              subscription: 'sub_member_pro_123456',
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            },
          },
        },
      },
    };
    const missingPrice = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(missingPricePayload),
      payload: missingPricePayload,
      verificationStatus: 'verified_test_signature',
    });
    expect(missingPrice.actionPlanned).toBe(false);
    expect(env.DB.state.billingProviderEvents.at(-1).processing_status).toBe('ignored');
    expect(env.DB.state.memberCreditLedger).toHaveLength(ledgerCount);
    await expect(getMemberCreditBucketBalances(env, 'member-subscription-ignored-invoices')).resolves.toMatchObject({
      subscriptionCredits: 2000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 4000,
      totalCredits: 6300,
    });
  });

  test('paid subscription invoice can safely provision before a subscription lifecycle event', async () => withSubscription(async f => {
    const first=await f.deliver(invoiceEvent());expect(first.status).toBe(202);
    expect(first.body.creditGrant).toMatchObject({userId:MEMBER,creditsGranted:6000,balanceAfter:6000,subscriptionCredits:6000});
    expect(nativeState(f).subscriptions).toHaveLength(1);
    expect(nativeState(f).subscriptions[0]).toMatchObject({user_id:MEMBER,provider_subscription_id:checkout.subscription,provider_price_id:PRICE,status:'active',current_period_start:new Date(START*1000).toISOString(),current_period_end:new Date(END*1000).toISOString()});
    const {getMemberCreditBucketBalances}=await loadBillingModule();
    await expect(getMemberCreditBucketBalances(f.env,MEMBER)).resolves.toMatchObject({subscriptionCredits:6000,legacyOrBonusCredits:0,purchasedCredits:0,totalCredits:6000});
  }));

  test('subscription lifecycle events without the BITBI Pro price do not activate storage', async () => {
    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const {
      USER_ASSET_STORAGE_LIMIT_BYTES,
      getUserAssetStorageUsageSnapshot,
    } = await loadAssetStorageQuotaModule();
    const user = createContractUser({ id: 'member-subscription-wrong-price-storage', role: 'user' });
    const env = createAuthTestEnv({
      users: [user],
      STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: 'price_member_pro_123456',
      userAssetStorageUsage: [{ user_id: user.id, used_bytes: 0, updated_at: nowIso() }],
    });
    const payload = {
      id: 'evt_member_subscription_wrong_price_update',
      object: 'event',
      type: 'customer.subscription.updated',
      livemode: true,
      data: {
        object: {
          id: 'sub_wrong_price_storage_123456',
          object: 'subscription',
          livemode: true,
          customer: 'cus_wrong_price_storage_123456',
          status: 'active',
          current_period_start: 1777593600,
          current_period_end: 1780272000,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: { id: 'price_unrelated_123456' },
              current_period_start: 1777593600,
              current_period_end: 1780272000,
            }],
          },
          metadata: { user_id: user.id },
        },
      },
    };
    const result = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_test_signature',
    });
    expect(result.actionPlanned).toBe(false);
    expect(env.DB.state.billingMemberSubscriptions).toHaveLength(0);
    await expect(getUserAssetStorageUsageSnapshot(env, user.id)).resolves.toMatchObject({
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      hasActiveSubscription: false,
      plan: 'free',
    });
  });

  test('subscription cancellation does not touch purchased or legacy credits', async () => withSubscription(async f => {
    await seedNativeBuckets(f,6000);const count=nativeState(f).ledger.length;
    const cancelled=await f.deliver(lifecycleEvent('evt_q4_neighbor_cancel',{type:'customer.subscription.deleted',status:'canceled'}));
    expect(cancelled.status).toBe(202);expect(cancelled.body.creditGrant).toBeNull();
    expect(nativeState(f).ledger).toHaveLength(count);expect(nativeState(f).subscriptions[0].status).toBe('canceled');
    const {getMemberCreditBucketBalances}=await loadBillingModule();
    await expect(getMemberCreditBucketBalances(f.env,MEMBER)).resolves.toMatchObject({subscriptionCredits:6000,legacyOrBonusCredits:300,purchasedCredits:4000,totalCredits:10300});
  }));

  test('member can schedule active subscription cancellation at period end and keep access', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const env = seedBucketedMember({
      userId: 'member-subscription-manage-cancel',
      subscriptionCredits: 6000,
      purchasedCredits: 1200,
    });
    env.STRIPE_LIVE_SECRET_KEY = 'sk_live_subscription_manage_secret_123456';
    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_123456';
    const calls = [];
    env.__TEST_FETCH = async (url, init = {}) => {
      calls.push({ url: String(url), form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
      return new Response(JSON.stringify({
        id: 'sub_member_pro_123456',
        object: 'subscription',
        livemode: true,
        customer: 'cus_member_pro_123456',
        status: 'active',
        cancel_at_period_end: true,
        canceled_at: PERIOD_START_SECONDS,
        current_period_start: PERIOD_START_SECONDS,
        current_period_end: PERIOD_END_SECONDS,
        items: { data: [{ price: { id: 'price_member_pro_123456' } }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const token = await seedSession(env, 'member-subscription-manage-cancel');
    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/subscription/cancel', 'POST', { confirmed: true }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-cancel-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.subscription).toEqual(expect.objectContaining({
      userId: 'member-subscription-manage-cancel',
      providerSubscriptionId: 'sub_member_pro_123456',
      status: 'active',
      cancelAtPeriodEnd: true,
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/v1/subscriptions/sub_member_pro_123456');
    expect(calls[0].form.cancel_at_period_end).toBe('true');
    expect(env.DB.state.billingMemberSubscriptions[0].cancel_at_period_end).toBe(1);

    const dashboardResponse = await worker.fetch(
      authJsonRequest('/api/account/credits-dashboard', 'GET', undefined, {
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    const dashboardBody = await dashboardResponse.json();
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardBody.dashboard).toEqual(expect.objectContaining({
      hasActiveSubscription: true,
      cancelAtPeriodEnd: true,
      canCancelSubscription: false,
      canReactivateSubscription: true,
      activeUntil: PERIOD_END,
    }));
  });

  test('member can reactivate a scheduled subscription without creating a duplicate subscription', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const env = seedBucketedMember({
      userId: 'member-subscription-manage-reactivate',
      subscriptionCredits: 6000,
      cancelAtPeriodEnd: 1,
    });
    env.STRIPE_LIVE_SECRET_KEY = 'sk_live_subscription_manage_secret_123456';
    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_123456';
    const calls = [];
    env.__TEST_FETCH = async (url, init = {}) => {
      calls.push({ url: String(url), form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
      return new Response(JSON.stringify({
        id: 'sub_member_pro_123456',
        object: 'subscription',
        livemode: true,
        customer: 'cus_member_pro_123456',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: PERIOD_START_SECONDS,
        current_period_end: PERIOD_END_SECONDS,
        items: { data: [{ price: { id: 'price_member_pro_123456' } }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const token = await seedSession(env, 'member-subscription-manage-reactivate');
    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/subscription/reactivate', 'POST', { confirmed: true }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-reactivate-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.subscription).toEqual(expect.objectContaining({
      userId: 'member-subscription-manage-reactivate',
      cancelAtPeriodEnd: false,
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].form.cancel_at_period_end).toBe('false');
    expect(env.DB.state.billingMemberSubscriptions).toHaveLength(1);
    expect(env.DB.state.billingMemberSubscriptions[0].cancel_at_period_end).toBe(0);
  });

  test('subscription management rejects missing, expired, or other-user subscriptions before Stripe calls', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const env = seedBucketedMember({
      userId: 'member-subscription-other-user',
      subscriptionCredits: 6000,
    });
    env.STRIPE_LIVE_SECRET_KEY = 'sk_live_subscription_manage_secret_123456';
    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_123456';
    const calls = [];
    env.__TEST_FETCH = async () => {
      calls.push('called');
      return new Response('{}', { status: 500 });
    };

    const noSubscriptionUser = createContractUser({ id: 'member-subscription-no-sub', role: 'user' });
    env.DB.state.users.push(noSubscriptionUser);
    const noSubscriptionToken = await seedSession(env, noSubscriptionUser.id);
    const noSubscription = await worker.fetch(
      authJsonRequest('/api/account/billing/subscription/cancel', 'POST', { confirmed: true }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${noSubscriptionToken}`,
        'Idempotency-Key': 'member-subscription-no-sub-cancel',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(noSubscription.status).toBe(404);

    const expiredUser = createContractUser({ id: 'member-subscription-expired-manage', role: 'user' });
    env.DB.state.users.push(expiredUser);
    env.DB.state.billingMemberSubscriptions.push({
      ...env.DB.state.billingMemberSubscriptions[0],
      id: 'msub_member_subscription_expired_manage',
      user_id: expiredUser.id,
      provider_subscription_id: 'sub_expired_manage_123456',
      current_period_start: '2026-03-01T00:00:00.000Z',
      current_period_end: '2026-04-01T00:00:00.000Z',
      cancel_at_period_end: 1,
      updated_at: '2026-04-01T00:00:00.000Z',
    });
    const expiredToken = await seedSession(env, expiredUser.id);
    const expired = await worker.fetch(
      authJsonRequest('/api/account/billing/subscription/reactivate', 'POST', { confirmed: true }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${expiredToken}`,
        'Idempotency-Key': 'member-subscription-expired-reactivate',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(expired.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('legacy reconciliation is idempotent and keeps admin grants outside subscription top-up', async () => {
    const {
      getMemberCreditBucketBalances,
      topUpMemberSubscriptionCredits,
    } = await loadBillingModule();
    const userId = 'member-legacy-reconcile-idempotent';
    const env = createAuthTestEnv({
      users: [createContractUser({ id: userId, role: 'user' }), createAdminUser('admin-user')],
      billingMemberSubscriptions: [{
        id: `msub_${userId}`,
        user_id: userId,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_id: 'cus_legacy_reconcile_123456',
        provider_subscription_id: 'sub_legacy_reconcile_123456',
        provider_price_id: 'price_member_pro_123456',
        status: 'active',
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
        cancel_at_period_end: 0,
        canceled_at: null,
        metadata_json: '{}',
        created_at: PERIOD_START,
        updated_at: PERIOD_START,
      }],
      memberCreditLedger: [
        {
          id: 'mcl_legacy_reconcile_admin_grant',
          user_id: userId,
          amount: 300,
          balance_after: 300,
          entry_type: 'grant',
          feature_key: null,
          source: 'manual_admin_grant',
          idempotency_key: 'legacy-reconcile-admin-grant',
          request_hash: 'legacy-reconcile-admin-grant',
          created_by_user_id: 'admin-user',
          created_at: '2026-04-01T00:00:00.000Z',
          metadata_json: '{}',
        },
        {
          id: 'mcl_legacy_reconcile_purchase',
          user_id: userId,
          amount: 5000,
          balance_after: 5300,
          entry_type: 'grant',
          feature_key: null,
          source: 'stripe_live_checkout',
          idempotency_key: 'legacy-reconcile-purchase',
          request_hash: 'legacy-reconcile-purchase',
          created_by_user_id: userId,
          created_at: '2026-04-02T00:00:00.000Z',
          metadata_json: '{}',
        },
      ],
    });

    await expect(getMemberCreditBucketBalances(env, userId)).resolves.toMatchObject({
      subscriptionCredits: 0,
      legacyOrBonusCredits: 300,
      purchasedCredits: 5000,
      totalCredits: 5300,
    });
    const bucketCount = env.DB.state.memberCreditBuckets.length;
    await expect(getMemberCreditBucketBalances(env, userId)).resolves.toMatchObject({
      subscriptionCredits: 0,
      legacyOrBonusCredits: 300,
      purchasedCredits: 5000,
      totalCredits: 5300,
    });
    expect(env.DB.state.memberCreditBuckets).toHaveLength(bucketCount);

    const topUp = await topUpMemberSubscriptionCredits({
      env,
      userId,
      providerSubscriptionId: 'sub_legacy_reconcile_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_legacy_reconcile_renewal',
      providerEventId: 'evt_legacy_reconcile_renewal',
    });
    expect(topUp.grantedCredits).toBe(6000);
    await expect(getMemberCreditBucketBalances(env, userId)).resolves.toMatchObject({
      subscriptionCredits: 6000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 5000,
      totalCredits: 11300,
    });
  });

  test('member credit consumption uses subscription first, legacy second, and purchased last', async () => {
    const {
      consumeMemberCredits,
      getMemberCreditBucketBalances,
    } = await loadBillingModule();
    const env = seedBucketedMember({
      userId: 'member-consumption-order',
      subscriptionCredits: 2000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 4000,
    });
    const result = await consumeMemberCredits({
      env,
      userId: 'member-consumption-order',
      featureKey: 'ai.image.generate',
      credits: 2500,
      quantity: 1,
      idempotencyKey: 'member-consumption-order-1',
    });
    expect(result.creditBalance).toBe(3800);
    await expect(getMemberCreditBucketBalances(env, 'member-consumption-order')).resolves.toMatchObject({
      subscriptionCredits: 0,
      legacyOrBonusCredits: 0,
      purchasedCredits: 3800,
      totalCredits: 3800,
    });
    const debitTypes = env.DB.state.memberCreditBucketEvents
      .filter((event) => event.amount < 0)
      .map((event) => [event.bucket_type, Math.abs(event.amount)]);
    expect(debitTypes).toEqual([
      ['subscription', 2000],
      ['legacy_or_bonus', 300],
      ['purchased', 200],
    ]);
  });

  test('live member credit-pack grant increments the purchased bucket without changing external checkout behavior', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-pack-purchased-bucket', role: 'user' });
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_subscription_test_secret_123456',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_subscription_test_secret_123456',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: async () => new Response(JSON.stringify({
        id: 'cs_live_member_pack_bucket',
        object: 'checkout.session',
        livemode: true,
        mode: 'payment',
        url: 'https://checkout.stripe.com/c/pay/cs_live_member_pack_bucket',
        payment_intent: 'pi_live_member_pack_bucket',
        customer: 'cus_member_pack_bucket',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const token = await seedSession(env, member.id);
    const checkout = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', {
        pack_id: 'live_credits_5000',
        terms_accepted: true,
        terms_version: '2026-05-05',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-pack-purchased-bucket-checkout',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(checkout.status).toBe(201);

    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const payload = {
      id: 'evt_member_pack_bucket',
      object: 'event',
      type: 'checkout.session.completed',
      livemode: true,
      data: {
        object: {
          id: 'cs_live_member_pack_bucket',
          object: 'checkout.session',
          livemode: true,
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_live_member_pack_bucket',
          customer: 'cus_member_pack_bucket',
          amount_total: 999,
          currency: 'eur',
          metadata: {
            user_id: member.id,
            credit_pack_id: 'live_credits_5000',
            credits: '5000',
            checkout_scope: 'member',
            authorization_scope: 'member',
            internal_checkout_session_id: env.DB.state.billingMemberCheckoutSessions[0].id,
          },
        },
      },
    };
    const result = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_live_signature',
    });
    expect(result.creditGrant).toEqual(expect.objectContaining({
      userId: member.id,
      creditsGranted: 5000,
      balanceAfter: 5000,
    }));
    expect(env.DB.state.memberCreditBuckets.find((row) => row.bucket_type === 'purchased')).toEqual(expect.objectContaining({
      user_id: member.id,
      balance: 5000,
    }));
  });

  test('live member 12000 credit-pack grant increments the purchased bucket exactly once', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-pack-12000-purchased-bucket', role: 'user' });
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_subscription_test_secret_123456',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_subscription_test_secret_123456',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: async () => new Response(JSON.stringify({
        id: 'cs_live_member_pack_12000_bucket',
        object: 'checkout.session',
        livemode: true,
        mode: 'payment',
        url: 'https://checkout.stripe.com/c/pay/cs_live_member_pack_12000_bucket',
        payment_intent: 'pi_live_member_pack_12000_bucket',
        customer: 'cus_member_pack_12000_bucket',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const token = await seedSession(env, member.id);
    const checkout = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', {
        pack_id: 'live_credits_12000',
        terms_accepted: true,
        terms_version: '2026-05-05',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-pack-12000-purchased-bucket-checkout',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(checkout.status).toBe(201);

    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const payload = {
      id: 'evt_member_pack_12000_bucket',
      object: 'event',
      type: 'checkout.session.completed',
      livemode: true,
      data: {
        object: {
          id: 'cs_live_member_pack_12000_bucket',
          object: 'checkout.session',
          livemode: true,
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_live_member_pack_12000_bucket',
          customer: 'cus_member_pack_12000_bucket',
          amount_total: 1999,
          currency: 'eur',
          metadata: {
            user_id: member.id,
            credit_pack_id: 'live_credits_12000',
            credits: '12000',
            checkout_scope: 'member',
            authorization_scope: 'member',
            internal_checkout_session_id: env.DB.state.billingMemberCheckoutSessions[0].id,
          },
        },
      },
    };
    const result = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_live_signature',
    });
    expect(result.creditGrant).toEqual(expect.objectContaining({
      userId: member.id,
      creditsGranted: 12000,
      balanceAfter: 12000,
    }));
    const ledgerCount = env.DB.state.memberCreditLedger.length;
    const duplicate = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_live_signature',
    });
    expect(duplicate.duplicate).toBe(true);
    expect(env.DB.state.memberCreditLedger).toHaveLength(ledgerCount);
    expect(env.DB.state.memberCreditBuckets.find((row) => row.bucket_type === 'purchased')).toEqual(expect.objectContaining({
      user_id: member.id,
      balance: 12000,
    }));
  });

  test('member billing portal is authenticated, idempotent, and validates live Stripe portal responses', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const { upsertMemberSubscriptionFromProvider } = await loadBillingModule();
    const member = createContractUser({ id: 'member-billing-portal', role: 'user' });
    const calls = [];
    const stripePortalUrl = 'https://billing.stripe.com/p/session/live_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9iaXRiaV9wb3J0YWxfMDE';
    const env = createAuthTestEnv({
      STRIPE_LIVE_SECRET_KEY: 'sk_live_member_portal_secret_123456',
      STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: 'price_member_pro_portal_123456',
      STRIPE_LIVE_CUSTOMER_PORTAL_RETURN_URL: 'https://bitbi.ai/account/credits.html?scope=member',
      users: [member],
      fetch: async (url, init = {}) => {
        calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
        return new Response(JSON.stringify({
          id: 'bps_member_portal_123456',
          object: 'billing_portal.session',
          livemode: true,
          url: stripePortalUrl,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await upsertMemberSubscriptionFromProvider({
      env,
      userId: member.id,
      providerSubscriptionId: 'sub_member_portal_123456',
      providerCustomerId: 'cus_member_portal_123456',
      providerPriceId: 'price_member_pro_portal_123456',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      metadata: { source: 'test' },
    });
    const token = await seedSession(env, member.id);

    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      portal_url: stripePortalUrl,
      mode: 'live',
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    expect(calls[0].init.headers.Authorization).toContain('Bearer ');
    expect(JSON.stringify(body)).not.toContain('cus_member_portal_123456');
    expect(JSON.stringify(body)).not.toContain('sk_live_member_portal_secret_123456');
    expect(body).not.toHaveProperty('customer');
    expect(body).not.toHaveProperty('session_id');
    expect(calls[0].form.customer).toBe('cus_member_portal_123456');
    expect(calls[0].form.return_url).toBe('https://bitbi.ai/account/credits.html?scope=member');

    env.__TEST_FETCH = async () => new Response(JSON.stringify({
      id: 'bps_member_portal_987654',
      object: 'billing_portal.session',
      livemode: true,
      url: 'https://billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfOTg3NjU0?prefilled_email=member%40bitbi.ai',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const documentedUrl = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-documented-url',
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(documentedUrl.json()).resolves.toMatchObject({
      ok: true,
      portal_url: 'https://billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfOTg3NjU0?prefilled_email=member%40bitbi.ai',
    });
    expect(documentedUrl.status).toBe(201);

    env.__TEST_FETCH = async () => new Response(JSON.stringify({
      id: 'bps_member_portal_custom_domain',
      object: 'billing_portal.session',
      livemode: true,
      url: 'https://pay.bitbi.ai/p/session/live_YWNjdF9iaXRiaV9jdXN0b21fZG9tYWlu',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const customDomainUrl = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-custom-domain-url',
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(customDomainUrl.json()).resolves.toMatchObject({
      ok: true,
      portal_url: 'https://pay.bitbi.ai/p/session/live_YWNjdF9iaXRiaV9jdXN0b21fZG9tYWlu',
    });
    expect(customDomainUrl.status).toBe(201);

    const expectInvalidPortalUrl = async (idempotencyKey, url) => {
      env.__TEST_FETCH = async () => new Response(JSON.stringify({
        id: 'bps_member_portal_invalid_url',
        object: 'billing_portal.session',
        livemode: true,
        url,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const invalidUrl = await worker.fetch(
        authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'Idempotency-Key': idempotencyKey,
        }),
        env,
        createExecutionContext().execCtx
      );
      await expect(invalidUrl.json()).resolves.toMatchObject({
        code: 'stripe_billing_portal_invalid_response',
        error: 'Stripe Billing Portal Session URL is invalid.',
      });
      expect(invalidUrl.status).toBe(502);
    };

    await expectInvalidPortalUrl(
      'member-portal-non-https-url',
      'http://billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfaHR0cA'
    );
    await expectInvalidPortalUrl(
      'member-portal-non-allowed-domain',
      'https://billing.example.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfZXZpbA'
    );
    await expectInvalidPortalUrl(
      'member-portal-credentialed-url',
      'https://member:secret@billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfY3JlZA'
    );
    await expectInvalidPortalUrl(
      'member-portal-malformed-path',
      'https://pay.bitbi.ai/customer/session/live_YWNjdF9iaXRiaV9wb3J0YWxfbWFsZm9ybWVk'
    );

    env.__TEST_FETCH = async () => new Response(JSON.stringify({
      id: 'bps_member_portal_testmode',
      object: 'billing_portal.session',
      livemode: false,
      url: 'https://billing.stripe.com/p/session/bps_member_portal_testmode',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const invalid = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-invalid',
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'stripe_billing_portal_invalid_response',
    });
    expect(invalid.status).toBe(502);
  });

  test('credits page redirects to Stripe Customer Portal without rendering the portal URL', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'js/pages/credits/main.js'), 'utf8');
    expect(source).toContain("'https://pay.bitbi.ai'");
    expect(source).toContain('const portalUrl = res.data?.portal_url;');
    expect(source).toContain('if (isSafePortalRedirect(portalUrl))');
    expect(source).toContain('window.location.assign(portalUrl);');
    expect(source).not.toMatch(/subscriptionFeedbackMessage\s*=\s*portalUrl/);
    expect(source).not.toMatch(/textContent\s*=\s*portalUrl/);
  });

  test('member billing portal requires an idempotency key before Stripe calls', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-billing-portal-missing-key', role: 'user' });
    const calls = [];
    const env = createAuthTestEnv({
      users: [member],
      fetch: async () => {
        calls.push(true);
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const token = await seedSession(env, member.id);
    const missingKey = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(missingKey.status).toBe(428);
    expect(calls).toHaveLength(0);
  });

  test('route policy includes the member subscription checkout route', async () => {
    const { ROUTE_POLICIES } = await loadRoutePolicyModule();
    expect(ROUTE_POLICIES).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'account.billing.checkout.subscription',
        method: 'POST',
        path: '/api/account/billing/checkout/subscription',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'account.billing.subscription.cancel',
        method: 'POST',
        path: '/api/account/billing/subscription/cancel',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'account.billing.subscription.reactivate',
        method: 'POST',
        path: '/api/account/billing/subscription/reactivate',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'account.billing.portal.create',
        method: 'POST',
        path: '/api/account/billing/portal',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'admin.billing.live-readiness.status',
        method: 'GET',
        path: '/api/admin/billing/live-readiness/status',
        auth: 'admin',
      }),
    ]));
  });
});
