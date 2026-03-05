/* ============================================================
   BITBI — Live Markets: CoinGecko fetch, sparkline, rendering
   ============================================================ */

export function initMarkets() {
    const ctn = document.getElementById('marketCards');
    if (!ctn) return;

    const assets = [
        { sym: 'BTC', name: 'Bitcoin', id: 'bitcoin', type: 'crypto' },
        { sym: 'ETH', name: 'Ethereum', id: 'ethereum', type: 'crypto' },
        { sym: 'SOL', name: 'Solana', id: 'solana', type: 'crypto' },
        { sym: 'AAPL', name: 'Apple', type: 'stock', fake: 243.67 },
        { sym: 'TSLA', name: 'Tesla', type: 'stock', fake: 412.35 },
    ];

    const hist = {};
    assets.forEach(a => hist[a.sym] = []);

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

    function render(prices) {
        ctn.innerHTML = '';
        assets.forEach(a => {
            const p = prices[a.sym] || 0;
            const h = hist[a.sym];
            const prev = h.length > 1 ? h[h.length - 2] : p;
            const chg = prev ? ((p - prev) / prev * 100) : 0;
            const up = chg >= 0;
            const card = document.createElement('div');
            card.style.cssText = 'background:rgba(13,27,42,0.45);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:14px;transition:border-color 0.3s';
            card.onmouseenter = () => card.style.borderColor = 'rgba(0,240,255,0.15)';
            card.onmouseleave = () => card.style.borderColor = 'rgba(255,255,255,0.06)';
            card.innerHTML = `<div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:10px"><div><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:rgba(255,255,255,0.35)">${a.sym}</span><h4 style="font-family:'Playfair Display',serif;font-weight:700;font-size:13px;color:rgba(255,255,255,0.85)">${a.name}</h4></div><span style="font-size:9px;font-family:'JetBrains Mono',monospace;padding:2px 7px;border-radius:10px;background:${up ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'};color:${up ? '#22c55e' : '#ef4444'}">${up ? '\u25B2' : '\u25BC'} ${Math.abs(chg).toFixed(2)}%</span></div><div style="font-size:18px;font-family:'JetBrains Mono',monospace;font-weight:700;color:${up ? '#22c55e' : '#ef4444'};margin-bottom:10px">$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>${spark(h, up)}`;
            ctn.appendChild(card);
        });
    }

    async function fetchPrices() {
        const prices = {};
        try {
            const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd');
            if (r.ok) {
                const d = await r.json();
                if (d.bitcoin) prices.BTC = d.bitcoin.usd;
                if (d.ethereum) prices.ETH = d.ethereum.usd;
                if (d.solana) prices.SOL = d.solana.usd;
            }
        } catch (e) { /* fallback below */ }

        if (!prices.BTC) prices.BTC = 95000 + (Math.random() - .5) * 2000;
        if (!prices.ETH) prices.ETH = 3200 + (Math.random() - .5) * 100;
        if (!prices.SOL) prices.SOL = 190 + (Math.random() - .5) * 10;

        assets.filter(a => a.type === 'stock').forEach(a => {
            const last = hist[a.sym].length ? hist[a.sym][hist[a.sym].length - 1] : a.fake;
            prices[a.sym] = last + (Math.random() - .5) * last * .004;
        });

        assets.forEach(a => {
            if (prices[a.sym]) {
                hist[a.sym].push(prices[a.sym]);
                if (hist[a.sym].length > 20) hist[a.sym].shift();
            }
        });

        render(prices);
    }

    fetchPrices();
    setInterval(fetchPrices, 30000);
}
