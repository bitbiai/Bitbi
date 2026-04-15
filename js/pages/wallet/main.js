/* ============================================================
   BITBI — Legacy wallet route redirect
   Redirects the old dedicated wallet page to the same-document
   wallet workspace entry point on the homepage.
   ============================================================ */

const target = new URL('/', window.location.origin);
target.hash = 'wallet-workspace';

const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
const destination = `${target.pathname}${target.search}${target.hash}`;

if (current !== destination) {
    window.location.replace(target.toString());
}
