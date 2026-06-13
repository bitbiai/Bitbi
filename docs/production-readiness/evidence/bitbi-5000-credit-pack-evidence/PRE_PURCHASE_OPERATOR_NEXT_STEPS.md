# 5000 Credit Pack Post-Purchase Evidence Capture Steps

This folder currently contains the pre-purchase baseline only. The operator can buy the 5000 Credit Pack after this baseline has been reviewed.

Do not include raw Stripe secrets, webhook signing secrets, raw webhook payloads, Stripe-Signature headers, cookies, bearer tokens, session values, full Checkout Session URLs, full Customer Portal URLs, or card data. Mask personal data where practical. Stripe-safe masked last4 is acceptable if it appears in Stripe UI.

## After Buying The 5000 Credit Pack, Capture These Artifacts

1. Member Credits screenshot after purchase
   - Show total available credits.
   - Show purchased credits increased by `+5000` from the pre-purchase baseline of `64 Credits`.
   - Show the new `live_credits_5000` purchase row if visible.
   - Do not include avoidable personal data beyond what is necessary for the evidence screenshot.

2. Stripe payment succeeded evidence for `9,99 EUR`
   - Capture a sanitized Stripe Dashboard view showing the payment succeeded.
   - Safe to include: amount, currency, status, date/time, masked card last4 if Stripe displays it.
   - Do not include card numbers, payment method IDs, customer emails, raw API payloads, or secrets.

3. Stripe `checkout.session.completed` evidence
   - Capture sanitized evidence that the event exists for the 5000 Credit Pack purchase.
   - Safe to include: event type, live mode, created/delivered time, amount/currency, status.
   - Do not include raw event JSON, full session URL, customer email, or full customer/session IDs.

4. Stripe webhook delivery 2xx evidence if visible
   - Capture a sanitized Stripe Dashboard delivery summary showing successful 2xx delivery to the live webhook endpoint.
   - Do not include raw request/response bodies or Stripe-Signature headers.

5. Admin Live Billing export after purchase
   - Download the redacted JSON and Markdown exports from Admin -> Finance -> Live Billing.
   - Store them in this staging folder with clear `after` filenames.
   - Confirm the exports still do not include raw secrets, raw payloads, signatures, cookies, tokens, or full portal/session URLs.

6. Billing Events after purchase
   - Capture Admin Billing Events showing the new live `checkout.session.completed` processing result.
   - Include only sanitized event metadata.
   - Confirm the event is linked to the expected purchase without exposing raw provider payloads.

7. Reconciliation after purchase
   - Capture the Admin Billing Reconciliation state after webhook processing.
   - Confirm no critical mismatch.
   - Confirm duplicate provider event IDs remain `0` unless intentionally testing a duplicate replay.
   - Confirm no completed checkout without ledger.
   - Confirm no provider grant without checkout link.

8. Billing Reviews after purchase
   - Capture Billing Reviews after the purchase.
   - Confirm no unresolved `blocked` or `needs_review` item related to the new purchase.
   - If an informational row appears, summarize it without raw provider data.

## Post-Purchase Summary To Add Later

After artifacts are captured, add a post-purchase summary in this same staging folder that records:

- Before purchased credits: `64`
- Expected after purchased credits: `5064`
- Actual after purchased credits from screenshot/export.
- Whether the 5000-credit grant happened exactly once.
- Whether the new Stripe payment succeeded for `9,99 EUR`.
- Whether the new webhook delivery reached the live endpoint with a 2xx status.
- Whether Billing Events, Reconciliation, and Reviews show no critical purchase blocker.

Do not commit this staging package until `npm run check:secrets` passes.

