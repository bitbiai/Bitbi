const BASELINE_WIDTH = 1728;
const BASELINE_HEIGHT = 1117;
const DESKTOP_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

const BASELINE = {
    modelTop: 64,
    modelWidth: 344,
    modelHeight: 624,
    modelCaptionSpace: 56.8,
    modelLabelGap: 10.88,
    modelLabelFontSize: 14.4,
    titleWidth: 662.442,
    titleWrapHeight: 324.33,
    titleMarginEnd: 24,
    contentTop: 80,
    ctaOffset: 132,
    ctaMinHeight: 57.92,
    ctaMaxWidth: 400,
    ctaPaddingBlock: 16,
    ctaPaddingInline: 41.6,
    ctaGap: 13.76,
    ctaFontSize: 15.04,
    ctaIconSize: 17.28,
    newsWidth: 794.88,
    newsHeight: 134.04,
    scrollBottom: 16,
    scrollGap: 8,
    scrollTextSize: 9,
    scrollIconSize: 16,
};

const FORMAT_PRECISION = 1000;

function formatPx(value) {
    return `${Math.round(value * FORMAT_PRECISION) / FORMAT_PRECISION}px`;
}

function formatScale(value) {
    return String(Math.round(value * 10000) / 10000);
}

function getViewportSize() {
    const visualViewport = window.visualViewport;
    const width = visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || 0;
    const height = visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 0;
    return { width, height };
}

function setScaledLength(hero, name, baseValue, scale) {
    hero.style.setProperty(name, formatPx(baseValue * scale));
}

function clearScaledProperties(hero) {
    [
        '--homepage-hero-large-scale',
        '--homepage-hero-stage-width',
        '--homepage-hero-stage-height',
        '--homepage-hero-stage-inline-margin',
        '--homepage-hero-stage-block-margin',
        '--homepage-hero-model-top',
        '--homepage-hero-model-width',
        '--homepage-hero-model-height',
        '--homepage-hero-model-caption-space',
        '--homepage-hero-model-label-gap',
        '--homepage-hero-model-label-font-size',
        '--homepage-hero-title-width',
        '--homepage-hero-title-wrap-height',
        '--homepage-hero-title-margin-end',
        '--homepage-hero-content-top',
        '--homepage-hero-cta-offset',
        '--homepage-hero-cta-min-height',
        '--homepage-hero-cta-max-width',
        '--homepage-hero-cta-padding-block',
        '--homepage-hero-cta-padding-inline',
        '--homepage-hero-cta-gap',
        '--homepage-hero-cta-font-size',
        '--homepage-hero-cta-icon-size',
        '--homepage-hero-news-width',
        '--homepage-hero-news-height',
        '--homepage-hero-scroll-bottom',
        '--homepage-hero-scroll-gap',
        '--homepage-hero-scroll-text-size',
        '--homepage-hero-scroll-icon-size',
    ].forEach((property) => hero.style.removeProperty(property));
    delete hero.dataset.homepageHeroLargeScale;
    delete hero.dataset.homepageHeroScale;
}

export function initHomepageHeroResponsiveScale(root = document) {
    if (typeof window === 'undefined') return;

    const hero = root.querySelector('.hero--homepage');
    if (!hero) return;

    const desktopQuery = window.matchMedia(DESKTOP_QUERY);
    let frame = 0;
    let lastSignature = '';

    const dispatchScaleEvent = () => {
        window.dispatchEvent(new CustomEvent('bitbi:homepage-hero-scale', {
            detail: {
                active: hero.dataset.homepageHeroLargeScale === 'true',
                scale: Number.parseFloat(hero.dataset.homepageHeroScale || '1') || 1,
            },
        }));
    };

    const apply = () => {
        frame = 0;
        const { width, height } = getViewportSize();
        const rawScale = Math.min(width / BASELINE_WIDTH, height / BASELINE_HEIGHT);
        const shouldScale = desktopQuery.matches && Number.isFinite(rawScale) && rawScale > 1;

        if (!shouldScale) {
            if (hero.dataset.homepageHeroLargeScale || lastSignature) {
                clearScaledProperties(hero);
                lastSignature = '';
                dispatchScaleEvent();
            }
            return;
        }

        const scale = rawScale;
        const stageWidth = BASELINE_WIDTH * scale;
        const stageHeight = BASELINE_HEIGHT * scale;
        const stageInlineMargin = Math.max(0, (width - stageWidth) / 2);
        const stageBlockMargin = Math.max(0, (height - stageHeight) / 2);
        const signature = [
            formatScale(scale),
            Math.round(width),
            Math.round(height),
            Math.round(stageInlineMargin * 100) / 100,
            Math.round(stageBlockMargin * 100) / 100,
        ].join('|');
        if (signature === lastSignature) return;

        lastSignature = signature;
        hero.dataset.homepageHeroLargeScale = 'true';
        hero.dataset.homepageHeroScale = formatScale(scale);
        hero.style.setProperty('--homepage-hero-large-scale', formatScale(scale));
        hero.style.setProperty('--homepage-hero-stage-width', formatPx(stageWidth));
        hero.style.setProperty('--homepage-hero-stage-height', formatPx(stageHeight));
        hero.style.setProperty('--homepage-hero-stage-inline-margin', formatPx(stageInlineMargin));
        hero.style.setProperty('--homepage-hero-stage-block-margin', formatPx(stageBlockMargin));

        setScaledLength(hero, '--homepage-hero-model-top', BASELINE.modelTop, scale);
        setScaledLength(hero, '--homepage-hero-model-width', BASELINE.modelWidth, scale);
        setScaledLength(hero, '--homepage-hero-model-height', BASELINE.modelHeight, scale);
        setScaledLength(hero, '--homepage-hero-model-caption-space', BASELINE.modelCaptionSpace, scale);
        setScaledLength(hero, '--homepage-hero-model-label-gap', BASELINE.modelLabelGap, scale);
        setScaledLength(hero, '--homepage-hero-model-label-font-size', BASELINE.modelLabelFontSize, scale);
        setScaledLength(hero, '--homepage-hero-title-width', BASELINE.titleWidth, scale);
        setScaledLength(hero, '--homepage-hero-title-wrap-height', BASELINE.titleWrapHeight, scale);
        setScaledLength(hero, '--homepage-hero-title-margin-end', BASELINE.titleMarginEnd, scale);
        setScaledLength(hero, '--homepage-hero-content-top', BASELINE.contentTop, scale);
        setScaledLength(hero, '--homepage-hero-cta-offset', BASELINE.ctaOffset, scale);
        setScaledLength(hero, '--homepage-hero-cta-min-height', BASELINE.ctaMinHeight, scale);
        setScaledLength(hero, '--homepage-hero-cta-max-width', BASELINE.ctaMaxWidth, scale);
        setScaledLength(hero, '--homepage-hero-cta-padding-block', BASELINE.ctaPaddingBlock, scale);
        setScaledLength(hero, '--homepage-hero-cta-padding-inline', BASELINE.ctaPaddingInline, scale);
        setScaledLength(hero, '--homepage-hero-cta-gap', BASELINE.ctaGap, scale);
        setScaledLength(hero, '--homepage-hero-cta-font-size', BASELINE.ctaFontSize, scale);
        setScaledLength(hero, '--homepage-hero-cta-icon-size', BASELINE.ctaIconSize, scale);
        setScaledLength(hero, '--homepage-hero-news-width', BASELINE.newsWidth, scale);
        setScaledLength(hero, '--homepage-hero-news-height', BASELINE.newsHeight, scale);
        setScaledLength(hero, '--homepage-hero-scroll-bottom', BASELINE.scrollBottom, scale);
        setScaledLength(hero, '--homepage-hero-scroll-gap', BASELINE.scrollGap, scale);
        setScaledLength(hero, '--homepage-hero-scroll-text-size', BASELINE.scrollTextSize, scale);
        setScaledLength(hero, '--homepage-hero-scroll-icon-size', BASELINE.scrollIconSize, scale);

        dispatchScaleEvent();
    };

    const schedule = () => {
        if (frame) return;
        frame = window.requestAnimationFrame(apply);
    };

    schedule();
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    window.addEventListener('pageshow', schedule, { passive: true });
    window.addEventListener('load', schedule, { once: true, passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    if (typeof desktopQuery.addEventListener === 'function') {
        desktopQuery.addEventListener('change', schedule);
    } else if (typeof desktopQuery.addListener === 'function') {
        desktopQuery.addListener(schedule);
    }
    document.fonts?.ready?.then(schedule).catch(() => {});
}
