# Stripe Hosted Checkout Domain: pay.bitbi.ai

This repository does not automate Stripe Dashboard or Cloudflare DNS setup for the hosted Checkout domain.

## Required Manual Setup

- Stripe custom hosted Checkout domain: `pay.bitbi.ai`
- Cloudflare CNAME: `pay` -> `hosted-checkout.stripecdn.com`
- Cloudflare TXT: `_acme-challenge.pay` -> Stripe-provided verification value
- Cloudflare proxy for `pay.bitbi.ai` must stay DNS-only/off.
- Cloudflare DACH redirect rules must exclude `pay.bitbi.ai`.

## Important Boundaries

- Do not point `pay.bitbi.ai` to GitHub Pages, Cloudflare Pages, or the Bitbi Worker.
- Do not use `pay.bitbi.ai` for Bitbi app success or cancel pages.
- Success and cancel URLs must stay on `bitbi.ai`, for example the public pricing or account credits return pages.
- The root of `pay.bitbi.ai` may not show a normal Bitbi page. The important flow is the Stripe Checkout Session URL returned by Stripe.
- Frontend code must redirect to the exact Checkout Session URL returned by the backend. Do not hardcode or rewrite Stripe URLs.
