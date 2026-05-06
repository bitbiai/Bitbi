/* ============================================================
   BITBI — Legacy wallet route redirect
   Redirects the old dedicated wallet page to the same-document
   wallet workspace entry point on the homepage.
   ============================================================ */

import { localizedHref } from '../../shared/locale.js?v=__ASSET_VERSION__';

const target = new URL(localizedHref('/'), window.location.origin);
target.hash = 'wallet-workspace';

const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
const destination = `${target.pathname}${target.search}${target.hash}`;

if (current !== destination) {
    window.location.replace(target.toString());
}
