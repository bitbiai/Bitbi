/* ============================================================
   BITBI — Live Markets: CoinGecko top 5 crypto with sparkline
   ============================================================ */

export function initMarkets() {
    const ctn = document.getElementById('marketCards');
    if (!ctn) return;

    const hist = {};

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
            const sym = coin.symbol.toUpperCase();
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
            card.innerHTML = `<div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:10px"><div><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.35)">${sym}</span><h4 style="font-family:'Playfair Display',serif;font-weight:700;font-size:13px;color:rgba(255,255,255,0.85)">${coin.name}</h4></div><span style="font-size:9px;font-family:'JetBrains Mono',monospace;padding:2px 7px;border-radius:10px;background:${up ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};color:${up ? '#22c55e' : '#ef4444'}">${up ? '\u25B2' : '\u25BC'} ${Math.abs(chg).toFixed(2)}%</span></div><div style="font-size:18px;font-family:'JetBrains Mono',monospace;font-weight:700;color:${up ? '#22c55e' : '#ef4444'};margin-bottom:10px">$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>${spark(sparkData, up)}`;
            ctn.appendChild(card);
        });
    }

    async function fetchCoins() {
        try {
            const r = await fetch(`https://api.bitbi.ai/crypto`);
            if (r.ok) {
                const coins = await r.json();
                if (Array.isArray(coins) && coins.length) {
                    render(coins);
                    return;
                }
            }
        } catch (e) { /* fallback below */ }

        /* Fallback if API fails */
        const fallback = [
            { symbol: 'btc', name: 'Bitcoin', current_price: 95000, price_change_percentage_24h: 1.2 },
            { symbol: 'eth', name: 'Ethereum', current_price: 3200, price_change_percentage_24h: -0.5 },
            { symbol: 'bnb', name: 'BNB', current_price: 680, price_change_percentage_24h: 0.8 },
            { symbol: 'sol', name: 'Solana', current_price: 190, price_change_percentage_24h: 2.1 },
            { symbol: 'wlfi', name: 'World Liberty Financial', current_price: 0.02, price_change_percentage_24h: 0.5 },
        ];
        render(fallback);
    }

    fetchCoins();
}
