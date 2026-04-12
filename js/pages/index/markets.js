/* ============================================================
   BITBI — Live Markets: CoinGecko top 5 crypto with sparkline
   ============================================================ */

export function initMarkets() {
    const ctn = document.getElementById('marketCards');
    if (!ctn) return;

    const hist = {};

    function setStyles(el, cssText) {
        el.style.cssText = cssText;
        return el;
    }

    function spark(data, up) {
        if (data.length < 2) return '';
        const mn = Math.min(...data);
        const mx = Math.max(...data);
        const rng = mx - mn || 1;
        const w = 120, h = 36;
        const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rng) * h * .8 - h * .1}`);
        const col = up ? '#22c55e' : '#ef4444';
        const colA = up ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
        return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:36px;display:block" preserveAspectRatio="none" aria-hidden="true"><polygon points="${[...pts, `${w},${h}`, `0,${h}`].join(' ')}" fill="${colA}"/><polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    function render(coins) {
        ctn.innerHTML = '';
        coins.forEach(coin => {
            const sym = String(coin?.symbol || '').toUpperCase();
            const name = String(coin?.name || '');
            const price = coin.current_price;
            const chg = coin.price_change_percentage_24h || 0;
            const up = chg >= 0;

            if (!hist[sym]) hist[sym] = [];
            hist[sym].push(price);
            if (hist[sym].length > 20) hist[sym].shift();

            const sparkData = coin.sparkline_in_7d?.price || hist[sym];

            const card = document.createElement('div');
            card.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:14px;transition:border-color 0.3s';
            card.onmouseenter = () => card.style.borderColor = 'rgba(0,240,255,0.15)';
            card.onmouseleave = () => card.style.borderColor = 'rgba(255,255,255,0.06)';

            const topRow = setStyles(document.createElement('div'), 'display:flex;align-items:start;justify-content:space-between;margin-bottom:10px');
            const titleWrap = document.createElement('div');
            const symEl = setStyles(document.createElement('span'), "font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.35)");
            symEl.textContent = sym;
            const nameEl = setStyles(document.createElement('h4'), "font-family:'Playfair Display',serif;font-weight:700;font-size:13px;color:rgba(255,255,255,0.85)");
            nameEl.textContent = name;
            titleWrap.appendChild(symEl);
            titleWrap.appendChild(nameEl);

            const badge = setStyles(
                document.createElement('span'),
                `font-size:9px;font-family:'JetBrains Mono',monospace;padding:2px 7px;border-radius:10px;background:${up ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};color:${up ? '#22c55e' : '#ef4444'}`
            );
            badge.textContent = `${up ? '\u25B2' : '\u25BC'} ${Math.abs(chg).toFixed(2)}%`;

            topRow.appendChild(titleWrap);
            topRow.appendChild(badge);

            const priceEl = setStyles(
                document.createElement('div'),
                `font-size:18px;font-family:'JetBrains Mono',monospace;font-weight:700;color:${up ? '#22c55e' : '#ef4444'};margin-bottom:10px`
            );
            priceEl.textContent = `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            const sparkEl = document.createElement('div');
            sparkEl.innerHTML = spark(sparkData, up);

            card.appendChild(topRow);
            card.appendChild(priceEl);
            card.appendChild(sparkEl);
            ctn.appendChild(card);
        });
    }

    async function fetchCoins() {
        try {
            const r = await fetch(`https://api.bitbi.ai`);
            if (r.ok) {
                const coins = await r.json();
                if (Array.isArray(coins) && coins.length) {
                    render(coins);
                    return;
                }
            }
        } catch (e) { /* fallback below */ }

        /* Fallback if API fails — show unavailable state instead of stale prices */
        ctn.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px 16px;color:rgba(255,255,255,0.35);font-family:'JetBrains Mono',monospace;font-size:0.75rem">Market data temporarily unavailable</div>`;
    }

    fetchCoins();
}
