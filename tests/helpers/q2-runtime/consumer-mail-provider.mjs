import assert from 'node:assert/strict';

// Only the q4-subscription native fixture installs this boundary. All other
// destinations still fail closed; no real email or Stripe request can leave it.
export function createConsumerMailProvider(deny) {
  const fixture = { requests: [], accepted: new Map(), loseNextAcknowledgement: false, observation: 'delivered', paymentRequests: [], paymentIntent: null, customers: new Map(), invoices: new Map(), checkoutSessions: new Map(), stripeRequests: [], stripeResponses: new Map(), missingAtCheckout: new Set(), redirectNextSend: false, observationRedirect: false };
  fixture.fetch = async request => {
    const url = new URL(request.url);
    if (request.method==='GET' && url.origin==='https://api.stripe.com' && fixture.paymentIntent
      && url.pathname===`/v1/payment_intents/${fixture.paymentIntent.id}` && url.searchParams.get('expand[]')==='latest_charge'
      && request.headers.get('authorization')==='Bearer sk_live_example_native_consumer_mail') {
      fixture.paymentRequests.push({path:url.pathname,expand:url.searchParams.get('expand[]')});
      return Response.json(fixture.paymentIntent);
    }
    if(url.origin==='https://api.stripe.com'&&request.headers.get('authorization')==='Bearer sk_live_example_native_consumer_mail'){
      const key=request.headers.get('idempotency-key'),raw=request.method==='POST'?await request.text():'',form=Object.fromEntries(new URLSearchParams(raw));
      fixture.stripeRequests.push({path:url.pathname,method:request.method,key,form});
      const response=(body,status=200)=>Response.json(body,{status});
      const cached=key&&fixture.stripeResponses.get(key);
      if(cached){assert.equal(cached.raw,raw);assert.equal(cached.path,url.pathname);return response(cached.body,cached.status);}
      const save=(body,status=200)=>{if(key)fixture.stripeResponses.set(key,{raw,path:url.pathname,body,status});return response(body,status);};
      const customer=url.pathname.match(/^\/v1\/customers\/(cus_native_pack_[a-z0-9_-]+)$/)?.[1];
      if(customer){
        const object=fixture.customers.get(customer);
        if(!object)return response({error:{code:'resource_missing',param:'customer'}},404);
        if(request.method==='GET')return response(object);
        if(request.method==='POST'){assert.equal(form['preferred_locales[0]'],'de');object.preferred_locales=['de'];return save(object);}
      }
      const invoice=url.pathname.match(/^\/v1\/invoices\/(in_native_pack_[a-z0-9_-]+)$/)?.[1];
      if(invoice){
        const object=fixture.invoices.get(invoice);
        if(!object)return response({error:{code:'resource_missing'}},404);
        if(request.method==='GET')return response(object);
        if(request.method==='POST'){assert.equal(form['rendering[pdf][page_size]'],'a4');object.rendering.pdf.page_size='a4';return save(object);}
      }
      if(url.pathname==='/v1/checkout/sessions'&&request.method==='POST'){
        assert.equal(form.mode,'payment');assert.equal(form['invoice_creation[enabled]'],'true');
        assert.match(form['metadata[internal_checkout_session_id]']||'',/^bcs_[a-f0-9]{32}$/);
        assert.match(form['metadata[user_id]']||'',/^q4-native-pack-[a-z0-9-]+$/);
        assert.ok(key);
        if(form.customer&&fixture.missingAtCheckout.has(form.customer))return save({error:{code:'resource_missing',param:'customer'}},400);
        if(form.customer){assert.ok(fixture.customers.has(form.customer));assert.equal(form.customer_creation,undefined);assert.equal(form.customer_email,undefined);}
        else assert.equal(form.customer_creation,'always');
        const id=`cs_live_native_pack_created_${fixture.checkoutSessions.size+1}`;
        const body={id,object:'checkout.session',livemode:true,mode:'payment',url:`https://checkout.stripe.com/c/pay/${id}`,customer:form.customer||null};
        fixture.checkoutSessions.set(id,{body,form});return save(body);
      }
      return deny();
    }
    if (url.origin !== 'https://api.resend.com' || request.headers.get('authorization') !== 'Bearer test-native-consumer-mail') return deny();
    if (request.method === 'POST' && url.pathname === '/emails' && !url.search) {
      const key = request.headers.get('idempotency-key'), raw = await request.text(), body = JSON.parse(raw);
      assert.ok(/^bitbi\/contract:q4-native-pack-[a-z0-9-]+$/.test(key||'')||[...fixture.checkoutSessions.values()].some(s=>key===`bitbi/contract:${s.form['metadata[internal_checkout_session_id]']}`),'Mail must belong to a seeded or actually accepted synthetic checkout');
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
