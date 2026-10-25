import { BITBI_LIVE_CREDIT_PACKS } from "./live-credit-packs.mjs";
import { BITBI_MEMBER_SUBSCRIPTION } from "./member-subscription.mjs";

// Kept aligned with MEMBER_DAILY_CREDIT_ALLOWANCE in workers/auth/src/lib/billing.js.
// Verified accounts are topped up to this balance each day; the allowance does not stack.
export const PRICING_DAILY_FREE_CREDITS = 10;

const PRO_STORAGE_LABEL = "5 GB";
const PRO_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;

const CARD_COPY = Object.freeze({
  en: Object.freeze({
    creditPacks: "Credit packs",
    included: "Included",
    bestFor: "Best for",
    loggedOutCta: "Create account to buy",
    oneTime: "One-time payment",
    monthly: "Monthly subscription",
    perMonth: "/ month",
    creditsLabel: "credits",
    creditBenefit: "{credits} prepaid credits",
    free: Object.freeze({
      title: "Free Account",
      price: "0 €",
      cadence: "account",
      description: "Create a BITBI account before checkout, generation, or saving.",
      bestFor: "Public browsing and account setup before paid credits.",
      benefits: Object.freeze([
        "Profile and recovery access",
        "Saved workspace context",
        "No paid credits included",
      ]),
      cta: "Create account",
      memberCta: "Open profile",
      dailyBenefit: `Verified accounts are topped up to ${PRICING_DAILY_FREE_CREDITS} free credits each day, and those daily credits do not accumulate.`,
    }),
    subscription: Object.freeze({
      badge: "Pro",
      description: "Monthly BITBI membership with separate subscription credits and expanded Asset Manager storage.",
      bestFor: "Regular creators who want predictable monthly credits and more storage.",
      summary: "Selected subscription: {title} · {credits} credits per month · {price} / month.",
    }),
    packs: Object.freeze({
      live_credits_5000: Object.freeze({
        title: "Starter Credits",
        description: "Perfect for first experiments, image generations, and smaller creative sessions.",
        bestFor: "Trying BITBI or topping up a smaller project.",
        benefits: Object.freeze([
          "Use across supported BITBI AI tools",
          "No subscription or renewal",
        ]),
      }),
      live_credits_12000: Object.freeze({
        title: "Creator Credits",
        badge: "Best value",
        description: "More room for high-quality images, video tests, music creation, and reference-based workflows.",
        bestFor: "Larger sessions and users who want more credits per checkout.",
        benefits: Object.freeze([
          "Best current value per credit",
          "Built for larger creative sessions",
        ]),
      }),
    }),
  }),
  de: Object.freeze({
    creditPacks: "Credit-Pakete",
    included: "Enthalten",
    bestFor: "Geeignet für",
    loggedOutCta: "Konto erstellen und kaufen",
    oneTime: "Einmalzahlung",
    monthly: "Monatsabo",
    perMonth: "/ Monat",
    creditsLabel: "Credits",
    creditBenefit: "{credits} Prepaid-Credits",
    free: Object.freeze({
      title: "Free Account",
      price: "0 €",
      cadence: "Konto",
      description: "Erstellen Sie ein BITBI-Konto vor Checkout, Generierung oder Speichern.",
      bestFor: "Öffentliches Stöbern und Kontostart vor bezahlten Credits.",
      benefits: Object.freeze([
        "Profil und Wiederherstellung",
        "Gespeicherter Arbeitsbereichskontext",
        "Keine bezahlten Credits enthalten",
      ]),
      cta: "Konto erstellen",
      memberCta: "Profil öffnen",
      dailyBenefit: `Verifizierte Konten werden täglich auf ${PRICING_DAILY_FREE_CREDITS} kostenlose Credits aufgefüllt, ohne dass sich diese Credits ansammeln.`,
    }),
    subscription: Object.freeze({
      badge: "Pro",
      description: "Monatliche BITBI Mitgliedschaft mit getrennten Abo-Credits und mehr Assets-Manager-Speicher.",
      bestFor: "Regelmäßige Creator, die planbare Monats-Credits und mehr Speicher möchten.",
      summary: "Ausgewähltes Abo: {title} · {credits} Credits pro Monat · {price} / Monat.",
    }),
    packs: Object.freeze({
      live_credits_5000: Object.freeze({
        title: "Starter Credits",
        description: "Ideal für erste Experimente, Bildgenerierungen und kleinere Kreativ-Sessions.",
        bestFor: "BITBI ausprobieren oder ein kleineres Projekt aufladen.",
        benefits: Object.freeze([
          "Für unterstützte BITBI-KI-Werkzeuge nutzbar",
          "Kein Abo und keine Verlängerung",
        ]),
      }),
      live_credits_12000: Object.freeze({
        title: "Creator Credits",
        badge: "Bester Wert",
        description: "Mehr Spielraum für hochwertige Bilder, Video-Tests, Musik und referenzbasierte Workflows.",
        bestFor: "Größere Sessions und mehr Credits pro Checkout.",
        benefits: Object.freeze([
          "Aktuell bester Gegenwert pro Credit",
          "Für größere Kreativ-Sessions ausgelegt",
        ]),
      }),
    }),
  }),
});

function normalizeLocale(locale) {
  return locale === "de" ? "de" : "en";
}

export function formatCreditCount(credits, locale) {
  return new Intl.NumberFormat(normalizeLocale(locale) === "de" ? "de-DE" : "en-US").format(credits);
}

export function formatCreditPackPrice(amountCents, locale) {
  const amount = Number(amountCents || 0) / 100;
  return `${amount.toLocaleString(normalizeLocale(locale) === "de" ? "de-DE" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function fillTemplate(template, values) {
  return String(template).replace(/\{([^}]+)\}/g, (_, name) => values[name] ?? "");
}

function assertPriceLabel(amountCents, label) {
  const numeric = Number(String(label).replace(/[^\d,.-]/g, "").replace(",", "."));
  const expected = Number(amountCents) / 100;
  if (!Number.isFinite(numeric) || Math.abs(numeric - expected) > 0.001) {
    throw new Error(`Pricing label "${label}" does not match ${amountCents} cents.`);
  }
}

function subscriptionBenefitLines(locale, credits) {
  const storage = PRO_STORAGE_LABEL;
  if (locale === "de") {
    return [
      `${credits} Credits monatlich inklusive`,
      `${storage} Assets-Manager-Speicher`,
      `Abo-Credits werden jeden Monat auf ${credits} aufgefüllt`,
      "Keine Ansammlung über das monatliche Kontingent hinaus",
      "Einmalig gekaufte Credits bleiben getrennt und zusätzlich erhalten",
      "Sicherer Stripe-Checkout",
    ];
  }
  return [
    `${credits} credits included each month`,
    `${storage} Asset Manager storage`,
    `Subscription credits are topped up to ${credits} each month`,
    "No accumulation beyond the monthly allowance",
    "One-time purchased credits remain separate and additional",
    "Secure Stripe checkout",
  ];
}

export function getPublicPricingCards(locale) {
  const loc = normalizeLocale(locale);
  const copy = CARD_COPY[loc];
  if (BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes !== PRO_STORAGE_BYTES) {
    throw new Error("Pricing storage label no longer matches BITBI_MEMBER_SUBSCRIPTION.storageLimitBytes.");
  }
  if (String(BITBI_MEMBER_SUBSCRIPTION.currency || "").toLowerCase() !== "eur") {
    throw new Error("BITBI Pro pricing is not EUR.");
  }
  assertPriceLabel(BITBI_MEMBER_SUBSCRIPTION.amountCents, BITBI_MEMBER_SUBSCRIPTION.displayPrice);

  const packs = BITBI_LIVE_CREDIT_PACKS
    .filter((pack) => pack?.active !== false)
    .slice()
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder));
  const copyIds = Object.keys(copy.packs);
  if (packs.length !== copyIds.length || packs.some((pack) => !copy.packs[pack.id])) {
    throw new Error("Pricing pack copy does not match the live credit pack catalog.");
  }

  const subscriptionCredits = BITBI_MEMBER_SUBSCRIPTION.allowanceCredits;
  const presentedPacks = packs.map((pack) => {
    if (String(pack.currency || "").toLowerCase() !== "eur") {
      throw new Error(`Credit pack ${pack.id} is not EUR.`);
    }
    const localized = copy.packs[pack.id];
    const price = formatCreditPackPrice(pack.amountCents, loc);
    assertPriceLabel(pack.amountCents, price);
    const creditsLabel = formatCreditCount(pack.credits, loc);
    return Object.freeze({
      id: pack.id,
      credits: pack.credits,
      amountCents: pack.amountCents,
      currency: "eur",
      price,
      featured: pack.id === "live_credits_12000",
      title: localized.title,
      badge: localized.badge || "",
      description: localized.description,
      bestFor: localized.bestFor,
      eyebrow: `${creditsLabel} ${copy.creditsLabel}`,
      cadence: copy.oneTime,
      benefits: Object.freeze([
        fillTemplate(copy.creditBenefit, { credits: creditsLabel }),
        ...localized.benefits,
      ]),
    });
  });

  return Object.freeze({
    locale: loc,
    labels: Object.freeze({
      creditPacks: copy.creditPacks,
      included: copy.included,
      bestFor: copy.bestFor,
      loggedOutCta: copy.loggedOutCta,
    }),
    free: Object.freeze({
      title: copy.free.title,
      price: copy.free.price,
      amountCents: 0,
      currency: "eur",
      cadence: copy.free.cadence,
      eyebrow: copy.free.cadence,
      description: copy.free.description,
      bestFor: copy.free.bestFor,
      benefits: Object.freeze([...copy.free.benefits, copy.free.dailyBenefit]),
      cta: copy.free.cta,
      memberCta: copy.free.memberCta,
      dailyBenefit: copy.free.dailyBenefit,
    }),
    subscription: Object.freeze({
      id: BITBI_MEMBER_SUBSCRIPTION.id,
      title: BITBI_MEMBER_SUBSCRIPTION.name,
      badge: copy.subscription.badge,
      credits: subscriptionCredits,
      amountCents: BITBI_MEMBER_SUBSCRIPTION.amountCents,
      currency: "eur",
      price: BITBI_MEMBER_SUBSCRIPTION.displayPrice,
      eyebrow: copy.monthly,
      cadence: copy.perMonth,
      description: copy.subscription.description,
      bestFor: copy.subscription.bestFor,
      benefits: Object.freeze(subscriptionBenefitLines(loc, subscriptionCredits)),
      summary: fillTemplate(copy.subscription.summary, {
        title: BITBI_MEMBER_SUBSCRIPTION.name,
        credits: String(subscriptionCredits),
        price: BITBI_MEMBER_SUBSCRIPTION.displayPrice,
      }),
    }),
    packs: Object.freeze(presentedPacks),
  });
}
