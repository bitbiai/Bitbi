import assert from 'node:assert/strict';

// Only the q4-subscription native fixture installs this boundary. All other
// destinations still fail closed; no real email or Stripe request can leave it.
export function createConsumerMailProvider(deny) {
  const fixture = { requests: [], accepted: new Map(), loseNextAcknowledgement: false, observation: 'delivered', paymentRequests: [], paymentIntent: null, redirectNextSend: false, observationRedirect: false };
  fixture.fetch = async request => {
    const url = new URL(request.url);
    if (request.method==='GET' && url.origin==='https://api.stripe.com' && fixture.paymentIntent
      && url.pathname===`/v1/payment_intents/${fixture.paymentIntent.id}` && url.searchParams.get('expand[]')==='latest_charge'
      && request.headers.get('authorization')==='Bearer sk_live_example_native_consumer_mail') {
      fixture.paymentRequests.push({path:url.pathname,expand:url.searchParams.get('expand[]')});
      return Response.json(fixture.paymentIntent);
    }
    if (url.origin !== 'https://api.resend.com' || request.headers.get('authorization') !== 'Bearer test-native-consumer-mail') return deny();
    if (request.method === 'POST' && url.pathname === '/emails' && !url.search) {
      const key = request.headers.get('idempotency-key'), raw = await request.text(), body = JSON.parse(raw);
      assert.match(key || '', /^bitbi\/contract:q4-native-pack-[a-z0-9-]+$/);
      assert.equal(body.from, 'receipts@example.invalid');
      assert.equal(body.to.length, 1); assert.match(body.to[0], /^q4-native-pack-[a-z0-9-]+@example\.invalid$/);
      assert.ok(body.subject && body.text && body.html);
      fixture.requests.push({ method: 'POST', key, raw, body });
      if (fixture.redirectNextSend) { fixture.redirectNextSend=false; return new Response(null,{status:302,headers:{Location:'https://forbidden.example/private-mail'}}); }
      let accepted = fixture.accepted.get(key);
      if (accepted) assert.equal(accepted.raw, raw, 'Retries must preserve the accepted provider body');
      else { accepted = { id: `native_mail_${fixture.accepted.size + 1}`, raw }; fixture.accepted.set(key, accepted); }
      if (fixture.loseNextAcknowledgement) { fixture.loseNextAcknowledgement = false; return Response.json({ status: 'synthetic acknowledgement without identity' }); }
      return Response.json({ id: accepted.id });
    }
    if (request.method === 'GET' && !url.search) {
      const id = url.pathname.match(/^\/emails\/(native_mail_\d+)$/)?.[1];
      if (id && [...fixture.accepted.values()].some(row => row.id === id)) {
        fixture.requests.push({ method: 'GET', id });
        if(fixture.observationRedirect)return new Response(null,{status:302,headers:{Location:'https://forbidden.example/private-mail-status'}});
        return Response.json({ id, last_event: fixture.observation });
      }
    }
    return deny();
  };
  return fixture;
}
