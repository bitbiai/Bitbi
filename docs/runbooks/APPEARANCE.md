# Global appearance

Admin → Operations → Appearance (`/admin/index.html#appearance`) selects Light
or Dark independently for five areas. This section alone has an English/German
language selector; it does not change the rest of the Admin language.

`js/shared/appearance-contract.js` is the common route/value/resolver contract.
It strips the `/de/` locale prefix, then maps `/admin/**`, `/generate-lab/**`,
`/canvas/**` and `/account/**` (including Profile and Assets Manager) to their
own settings. Everything else, including pricing/legal pages, belongs to the
public website. Existing redirect shells inherit the destination. Shared
headers, dialogs, help and pickers inherit the enclosing document's segment.

## Persistence and propagation

All five initial values are Dark; installation writes no settings and changes
no existing saved value. The existing D1 `app_settings` row
`appearance.global.v1` stores schema version 1, a monotonically increasing
revision and the five values. PATCH requires Admin, MFA and the existing origin
CSRF checks. Exact values and the expected revision are required. A compare-and-
swap update, existing Admin audit and activity index are one atomic D1 batch.
Conflicting or uncertain saves retain the draft; reload before editing again.
Reset stages the initial defaults and still requires Save. Pricing is untouched.

GET `/api/appearance` is anonymous, credential-free and `no-store`; it exposes
only version, revision, segment values and `personalEnabled: false`. Actor and
audit data are not public. The parser-blocking shared bootstrap applies the
cached global configuration early and revalidates every load. The first server
confirmation supersedes any disk cache; subsequent older responses cannot
roll back a confirmed revision. A cache is never the authority.

Visible documents revalidate every 60 seconds, single-flight, with a four-second
request bound. Healthy active sessions therefore converge within approximately
64 seconds. Navigation, bfcache return, tab resume and focus revalidate sooner;
a confirmed save prompts other tabs on the same origin to revalidate. Hidden
pages do not poll. Pages do not reload or replace content. Existing forms,
Canvas coordinates, selection and media state are unaffected.

A first load without usable cache conceals body paint for at most 600 ms, then
uses the established Dark defaults if the server is unavailable. Cached loads
paint immediately. Last confirmed/default appearance remains usable on failure;
there is no indefinite loading or claim of successful propagation offline.
Native `color-scheme` and `theme-color` follow the same selected theme.

## Personal preference is deliberately inactive

`PERSONAL_THEMES_ENABLED` is false. Production normalization accepts only
`personalEnabled: false`; local preferences, OS appearance and URL parameters
are not read as overrides. PUT/PATCH/POST `/api/account/appearance` require a
session and reject personal editing with 403. There is no personal control.

The shared resolver reserves the future persistence shape
`{ version: 1, theme: 'light' | 'dark' | null }`. Only a separately authorized
server-gate activation, authenticated persistence and quote-free preference
read would make an explicit personal choice take precedence. That branch is
exercised solely with controlled test inputs, not enabled by this release.

## Validation and publication

The existing `appearance-v1` selection is cross-segment, not Admin-only. Its
closed source set executes `tests/appearance.spec.js`, the isolated native
`--suite appearance`, and `tests/oma2-q3-appearance.spec.js` plus the existing
strict Admin navigation case in Chromium and WebKit against `_site`. Discovery
and execution JSON are siblings of `test-results/appearance-artifacts`, not
inside Playwright's cleaned directory. Candidate proof requires every selected
case and both engines; unknown/runtime/accounting changes remain broader.

The unchanged 0094 pricing schema is current. Appearance uses existing tables;
no migration, binding, AI Worker or media/container rollout is needed. The
existing protected continuation activates Auth, verifies its identity, then
publishes the same tested frontend artifact. Required credentials remain the
separate backend/frontend environment tokens; locks/reviews are unchanged.
Local workerd checks are not Linux CI or proof of production publication.
