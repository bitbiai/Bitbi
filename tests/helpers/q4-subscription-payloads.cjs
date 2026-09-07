const MEMBER = 'q4-subscription-member';
const OTHER = 'q4-subscription-other';
const PRICE = 'price_q4_subscription_monthly';
const SECRET = 'whsec_test-q4-subscription-only';
const START = 1788220800; // 2026-09-01T00:00:00Z
const END = 1790812800; // 2026-10-01T00:00:00Z
const checkout = { id: 'bcs_q4_subscription_first', session: 'cs_live_q4_subscription_first', subscription: 'sub_q4_subscription_first', customer: 'cus_q4_subscription_first' };
const metadata = () => ({ user_id: MEMBER, plan_id: 'bitbi_pro_monthly', internal_checkout_session_id: checkout.id, checkout_scope: 'member_subscription', authorization_scope: 'member' });
function event(type, id, object) {
  return { id, object: 'event', type, livemode: true, api_version: '2025-03-31.basil', created: START, data: { object } };
}
function sessionEvent(id = 'evt_q4_subscription_checkout') {
  return event('checkout.session.completed', id, { id: checkout.session, object: 'checkout.session', mode: 'subscription', livemode: true,
    subscription: checkout.subscription, customer: checkout.customer, payment_status: 'paid', amount_total: 999, currency: 'eur', metadata: metadata() });
}
function invoiceEvent(id = 'evt_q4_subscription_invoice', { invoice = 'in_q4_subscription_invoice', start = START, end = END } = {}) {
  return event('invoice.paid', id, { id: invoice, object: 'invoice', livemode: true, status: 'paid', paid: true,
    amount_paid: 999, amount_due: 999, total: 999, currency: 'eur', billing_reason: 'subscription_cycle', customer: checkout.customer,
    parent: { type: 'subscription_details', subscription_details: { subscription: checkout.subscription, metadata: metadata() } },
    lines: { has_more: false, data: [{ id: 'il_q4_subscription_first', amount: 999, currency: 'eur', quantity: 1,
      pricing: { type: 'price_details', price_details: { price: PRICE } },
      parent: { type: 'subscription_item_details', subscription_item_details: { subscription: checkout.subscription, proration: false } },
      period: { start, end }, metadata: metadata() }] } });
}
function lifecycleEvent(id = 'evt_q4_subscription_created', { type = 'customer.subscription.created', status = 'active', start = START, end = END, cancelAtPeriodEnd = false } = {}) {
  return event(type, id, { id: checkout.subscription, object: 'subscription', livemode: true, customer: checkout.customer,
    status, cancel_at_period_end: cancelAtPeriodEnd, canceled_at: status === 'canceled' ? START + 30 : null,
    metadata: metadata(), items: { data: [{ id: 'si_q4_subscription_first', price: { id: PRICE }, current_period_start: start, current_period_end: end }] } });
}
module.exports = { MEMBER, OTHER, PRICE, SECRET, START, END, checkout, sessionEvent, invoiceEvent, lifecycleEvent };
