import { apiAdminStats } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const STATS_TTL = 30_000;
const STAT_IDS = ['statTotal', 'statActive', 'statAdmins', 'statVerified', 'statDisabled', 'statRecent'];

const statsTimeFormatter = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

function renderStats(stats, updatedEl, fetchedAt) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val ?? '\u2014';
    };
    setVal('statTotal', stats.totalUsers);
    setVal('statActive', stats.activeUsers);
    setVal('statAdmins', stats.admins);
    setVal('statVerified', stats.verifiedUsers);
    setVal('statDisabled', stats.disabledUsers);
    setVal('statRecent', stats.recentRegistrations);
    if (updatedEl) {
        updatedEl.textContent = `Last updated: ${statsTimeFormatter.format(fetchedAt)}`;
    }
}

export function createAdminDashboard({ showToast }) {
    let version = 0;
    let statsCache = null;

    function invalidate() {
        statsCache = null;
    }

    async function load() {
        const updatedEl = document.getElementById('statsUpdated');

        if (statsCache && (Date.now() - statsCache.fetchedAt < STATS_TTL)) {
            renderStats(statsCache.stats, updatedEl, statsCache.fetchedAt);
            return;
        }

        const myVersion = ++version;

        for (const id of STAT_IDS) {
            const el = document.getElementById(id);
            if (el) el.textContent = '\u2014';
        }
        if (updatedEl) updatedEl.textContent = 'Refreshing\u2026';

        const statsRes = await apiAdminStats();

        if (myVersion !== version) return;

        if (statsRes.ok) {
            const stats = statsRes.data?.stats || statsRes.data || {};
            const now = Date.now();
            statsCache = { stats, fetchedAt: now };
            renderStats(stats, updatedEl, now);
            return;
        }

        if (updatedEl) updatedEl.textContent = 'Failed to load stats';
        showToast('Failed to load dashboard stats.', 'error');
    }

    return {
        invalidate,
        load,
    };
}
