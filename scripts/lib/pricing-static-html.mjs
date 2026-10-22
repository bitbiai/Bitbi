import fs from "node:fs";
import path from "node:path";
import {
  PRICING_DAILY_FREE_CREDITS,
  getPublicPricingCards,
} from "../../js/shared/pricing-public-offers.mjs";

const OFFERS_END = "<!-- /BITBI_PRICING_OFFERS -->";
const JSONLD_END = "<!-- /BITBI_PRICING_JSONLD -->";

const PAGE_META = Object.freeze({
  en: Object.freeze({
    name: "BITBI Credits & Pro | Pricing",
    url: "https://bitbi.ai/pricing.html",
    id: "https://bitbi.ai/pricing.html#webpage",
    description: "Choose BITBI Pro or one-time credit packs, then continue to Generate Lab, save outputs to Assets Manager, and review account-bound credits in your workspace.",
    inLanguage: "en",
    isPartOf: "https://bitbi.ai/#website",
    file: "pricing.html",
  }),
  de: Object.freeze({
    name: "BITBI Credits & Pro | Preise",
    url: "https://bitbi.ai/de/pricing.html",
    id: "https://bitbi.ai/de/pricing.html#webpage",
    description: "Wählen Sie BITBI Pro oder einmalige Credit-Pakete, wechseln Sie ins Generate Lab, speichern Sie Ergebnisse im Assets Manager und prüfen Sie kontogebundene Credits im Arbeitsbereich.",
    inLanguage: "de",
    isPartOf: "https://bitbi.ai/de/#website",
    file: "de/pricing.html",
  }),
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function schemaPrice(amountCents) {
  return (Number(amountCents) / 100).toFixed(2);
}

function accountHref(locale, page) {
  return `${locale === "de" ? "/de" : ""}/account/${page}.html`;
}

function renderArticle({
  className,
  articleData,
  eyebrow,
  title,
  badge,
  price,
  cadence,
  description,
  bestForLabel,
  bestFor,
  includedLabel,
  benefits,
  href,
  cta,
  ctaData,
}) {
  const badgeHtml = badge
    ? `<span class="pricing-badge pricing-badge--featured">${escapeHtml(badge)}</span>`
    : "";
  const benefitHtml = benefits.map((item) => `                    <li>${escapeHtml(item)}</li>`).join("\n");
  return `            <article class="${className}"${articleData}>
                <div class="pricing-card__head"><div class="pricing-card__title-wrap">
                    <p class="pricing-card__eyebrow">${escapeHtml(eyebrow)}</p>
                    <h2 class="pricing-card__title">${escapeHtml(title)}</h2>
                </div>${badgeHtml}</div>
                <div class="pricing-card__price"><span class="pricing-card__price-value">${escapeHtml(price)}</span><span class="pricing-card__cadence">${escapeHtml(cadence)}</span></div>
                <p class="pricing-card__copy">${escapeHtml(description)}</p>
                <p class="pricing-card__best-for"><span class="pricing-card__best-for-label">${escapeHtml(bestForLabel)}</span>${escapeHtml(bestFor)}</p>
                <ul class="pricing-card__list" aria-label="${escapeHtml(includedLabel)}">
${benefitHtml}
                </ul>
                <a class="pricing-card__cta" href="${escapeHtml(href)}"${ctaData}>${escapeHtml(cta)}</a>
            </article>`;
}

export function renderPricingOffersMarkup(locale) {
  const cards = getPublicPricingCards(locale);
  const free = cards.free;
  const subscription = cards.subscription;
  const articles = [
    renderArticle({
      className: "pricing-card glass glass-card reveal visible pricing-card--free",
      articleData: ' data-pricing-free-account="true"',
      eyebrow: free.eyebrow,
      title: free.title,
      badge: "",
      price: free.price,
      cadence: free.cadence,
      description: free.description,
      bestForLabel: cards.labels.bestFor,
      bestFor: free.bestFor,
      includedLabel: cards.labels.included,
      benefits: free.benefits,
      href: accountHref(cards.locale, "profile"),
      cta: free.cta,
      ctaData: ' data-pricing-auth-entry="register"',
    }),
    renderArticle({
      className: "pricing-card glass glass-card reveal visible pricing-card--featured pricing-card--selected",
      articleData: ` data-subscription-plan="${subscription.id}"`,
      eyebrow: subscription.eyebrow,
      title: subscription.title,
      badge: subscription.badge,
      price: subscription.price,
      cadence: subscription.cadence,
      description: subscription.description,
      bestForLabel: cards.labels.bestFor,
      bestFor: subscription.bestFor,
      includedLabel: cards.labels.included,
      benefits: subscription.benefits,
      href: accountHref(cards.locale, "credits"),
      cta: cards.labels.loggedOutCta,
      ctaData: ` data-subscription-checkout="${subscription.id}"`,
    }),
    ...cards.packs.map((pack) => renderArticle({
      className: `pricing-card glass glass-card reveal visible${pack.featured ? " pricing-card--featured" : ""}`,
      articleData: ` data-pack-id="${pack.id}"`,
      eyebrow: pack.eyebrow,
      title: pack.title,
      badge: pack.badge,
      price: pack.price,
      cadence: pack.cadence,
      description: pack.description,
      bestForLabel: cards.labels.bestFor,
      bestFor: pack.bestFor,
      includedLabel: cards.labels.included,
      benefits: pack.benefits,
      href: accountHref(cards.locale, "credits"),
      cta: cards.labels.loggedOutCta,
      ctaData: ` data-pricing-pack="${pack.id}"`,
    })),
  ];
  return `        <section id="pricingOffers" class="pricing-offers-section" aria-labelledby="pricingOffersTitle">
            <h2 id="pricingOffersTitle" class="sr-only">${escapeHtml(cards.labels.creditPacks)}</h2>
            <div class="pricing-offers-grid">
${articles.join("\n")}
            </div>
        </section>`;
}

function offerDescription(lead, detail) {
  return `${lead} ${detail}`;
}

export function buildPricingJsonLd(locale) {
  const loc = locale === "de" ? "de" : "en";
  const meta = PAGE_META[loc];
  const cards = getPublicPricingCards(loc);
  const offers = [
    {
      "@type": "Offer",
      name: cards.free.title,
      description: offerDescription(cards.free.description, cards.free.dailyBenefit),
      price: schemaPrice(cards.free.amountCents),
      priceCurrency: "EUR",
    },
    {
      "@type": "Offer",
      name: cards.subscription.title,
      sku: cards.subscription.id,
      description: offerDescription(cards.subscription.description, cards.subscription.benefits[0]),
      price: schemaPrice(cards.subscription.amountCents),
      priceCurrency: "EUR",
      valueAddedTaxIncluded: true,
    },
    ...cards.packs.map((pack) => ({
      "@type": "Offer",
      name: pack.title,
      sku: pack.id,
      description: offerDescription(pack.description, pack.benefits[0]),
      price: schemaPrice(pack.amountCents),
      priceCurrency: "EUR",
      valueAddedTaxIncluded: true,
    })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": meta.id,
    name: meta.name,
    url: meta.url,
    description: meta.description,
    inLanguage: meta.inLanguage,
    isPartOf: { "@id": meta.isPartOf },
    publisher: { "@id": "https://bitbi.ai/#organization" },
    image: "https://bitbi.ai/assets/images/bitbi-social-preview.jpg",
    mainEntity: {
      "@type": "OfferCatalog",
      name: "BITBI Credits & Pro",
      itemListElement: offers,
    },
  };
}

export function renderPricingJsonLdMarkup(locale) {
  const json = JSON.stringify(buildPricingJsonLd(locale), null, 4)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `    <script type="application/ld+json">\n${json}\n    </script>`;
}

function replaceRegion(html, start, end, replacement) {
  const startIdx = html.indexOf(start);
  const endIdx = html.indexOf(end);
  if (startIdx < 0 || endIdx < startIdx) {
    throw new Error(`Missing pricing static region ${start}`);
  }
  if (html.indexOf(start, startIdx + start.length) !== -1) {
    throw new Error(`Duplicate pricing static region ${start}`);
  }
  return `${html.slice(0, startIdx + start.length)}${replacement}${html.slice(endIdx)}`;
}

export function injectPricingStaticRegions(html, locale) {
  const loc = locale === "de" ? "de" : "en";
  const withOffers = replaceRegion(
    html,
    `<!-- BITBI_PRICING_OFFERS:${loc} -->`,
    OFFERS_END,
    `\n${renderPricingOffersMarkup(loc)}\n        `,
  );
  return replaceRegion(
    withOffers,
    `<!-- BITBI_PRICING_JSONLD:${loc} -->`,
    JSONLD_END,
    `\n${renderPricingJsonLdMarkup(loc)}\n    `,
  );
}

export function pricingPageTargets() {
  return [
    ["pricing.html", "en"],
    ["de/pricing.html", "de"],
  ];
}

export function applyPricingStaticRegions(rootDir) {
  for (const [relativePath, locale] of pricingPageTargets()) {
    const abs = path.join(rootDir, relativePath);
    if (!fs.existsSync(abs)) continue;
    const source = fs.readFileSync(abs, "utf8");
    if (!source.includes(`<!-- BITBI_PRICING_OFFERS:${locale} -->`)) continue;
    const next = injectPricingStaticRegions(source, locale);
    if (next !== source) fs.writeFileSync(abs, next);
  }
}

function readMemberDailyAllowance(repoRoot) {
  const billing = fs.readFileSync(path.join(repoRoot, "workers/auth/src/lib/billing.js"), "utf8");
  const match = billing.match(/export const MEMBER_DAILY_CREDIT_ALLOWANCE = (\d+);/);
  if (!match) throw new Error("MEMBER_DAILY_CREDIT_ALLOWANCE was not found in billing.js.");
  return Number(match[1]);
}

function extractJsonLd(html) {
  const match = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  if (!match) throw new Error("Pricing page is missing JSON-LD.");
  return JSON.parse(match[1]);
}

export function assertPricingSourcesMatch(repoRoot) {
  const allowance = readMemberDailyAllowance(repoRoot);
  if (allowance !== PRICING_DAILY_FREE_CREDITS) {
    throw new Error(`Daily free credits ${PRICING_DAILY_FREE_CREDITS} drifted from MEMBER_DAILY_CREDIT_ALLOWANCE ${allowance}.`);
  }
  for (const [relativePath, locale] of pricingPageTargets()) {
    const abs = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(abs, "utf8");
    const generated = injectPricingStaticRegions(source, locale);
    if (generated !== source) {
      throw new Error(`${relativePath} drifted from the pricing catalog. Regenerate it with node scripts/sync-pricing-static-html.mjs.`);
    }
    const cards = getPublicPricingCards(locale);
    const loading = locale === "de" ? "Credit-Pakete werden geladen." : "Loading credit packs.";
    if (source.includes(loading)) {
      throw new Error(`${relativePath} still contains the pricing loading placeholder.`);
    }
    for (const value of [
      cards.free.title,
      cards.free.price,
      cards.free.dailyBenefit,
      cards.subscription.title,
      cards.subscription.price,
      cards.subscription.cadence,
      ...cards.packs.flatMap((pack) => [pack.title, pack.price, pack.eyebrow, pack.badge].filter(Boolean)),
    ]) {
      if (!source.includes(value)) {
        throw new Error(`${relativePath} is missing pricing text: ${value}`);
      }
    }
    const jsonLd = extractJsonLd(source);
    const offers = jsonLd?.mainEntity?.itemListElement;
    if (!Array.isArray(offers) || offers.length !== 2 + cards.packs.length) {
      throw new Error(`${relativePath} JSON-LD offers do not match the pricing catalog.`);
    }
    const expectedPrices = [
      schemaPrice(cards.free.amountCents),
      schemaPrice(cards.subscription.amountCents),
      ...cards.packs.map((pack) => schemaPrice(pack.amountCents)),
    ];
    offers.forEach((offer, index) => {
      if (offer["@type"] !== "Offer" || offer.price !== expectedPrices[index] || offer.priceCurrency !== "EUR") {
        throw new Error(`${relativePath} JSON-LD offer ${index} does not match catalog price ${expectedPrices[index]}.`);
      }
    });
    if (offers[1].name !== cards.subscription.title || offers[1].sku !== cards.subscription.id) {
      throw new Error(`${relativePath} JSON-LD subscription offer drifted.`);
    }
    cards.packs.forEach((pack, index) => {
      const offer = offers[index + 2];
      if (offer.name !== pack.title || offer.sku !== pack.id || !offer.description.includes(pack.benefits[0])) {
        throw new Error(`${relativePath} JSON-LD pack offer drifted for ${pack.id}.`);
      }
    });
    if (!offers[0].description.includes(String(PRICING_DAILY_FREE_CREDITS))) {
      throw new Error(`${relativePath} JSON-LD free offer is missing the daily credit allowance.`);
    }
  }
}
