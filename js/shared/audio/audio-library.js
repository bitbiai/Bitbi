/* ============================================================
   BITBI — Shared audio catalog for persistent playback
   Used by: Sound Lab, profile favorites viewer, global audio manager/UI
   ============================================================ */

const R2_PUBLIC_BASE = 'https://pub.bitbi.ai';

const SOUNDLAB_TRACKS = [
    {
        id: 'soundlab:cosmic-sea',
        slug: 'cosmic-sea',
        title: 'Cosmic Sea',
        src: `${R2_PUBLIC_BASE}/audio/sound-lab/cosmic-sea.mp3`,
        artwork: `${R2_PUBLIC_BASE}/sound-lab/thumbs/thumb-cosmic.webp`,
        access: 'public',
        collection: 'soundlab',
        crossOrigin: 'anonymous',
    },
    {
        id: 'soundlab:zufall-und-notwendigkeit',
        slug: 'zufall-und-notwendigkeit',
        title: 'Zufall und Notwendigkeit',
        src: `${R2_PUBLIC_BASE}/audio/sound-lab/zufall-und-notwendigkeit.mp3`,
        artwork: `${R2_PUBLIC_BASE}/sound-lab/thumbs/thumb-zufall.webp`,
        access: 'public',
        collection: 'soundlab',
        crossOrigin: 'anonymous',
    },
    {
        id: 'soundlab:relativity',
        slug: 'relativity',
        title: 'Relativity',
        src: `${R2_PUBLIC_BASE}/audio/sound-lab/relativity.mp3`,
        artwork: `${R2_PUBLIC_BASE}/sound-lab/thumbs/thumb-relativity.webp`,
        access: 'public',
        collection: 'soundlab',
        crossOrigin: 'anonymous',
    },
    {
        id: 'soundlab:tiny-hearts',
        slug: 'tiny-hearts',
        title: 'Tiny Hearts',
        src: `${R2_PUBLIC_BASE}/audio/sound-lab/tiny-hearts.mp3`,
        artwork: `${R2_PUBLIC_BASE}/sound-lab/thumbs/thumb-tiny.webp`,
        access: 'public',
        collection: 'soundlab',
        crossOrigin: 'anonymous',
    },
    {
        id: 'soundlab:grok',
        slug: 'grok',
        title: "Grok's Groove Remix",
        src: `${R2_PUBLIC_BASE}/audio/sound-lab/grok.mp3`,
        artwork: `${R2_PUBLIC_BASE}/sound-lab/thumbs/thumb-grok.webp`,
        access: 'public',
        collection: 'soundlab',
        crossOrigin: 'anonymous',
    },
    {
        id: 'soundlab:exclusive-track-01',
        slug: 'exclusive-track-01',
        title: 'Exclusive Track 01',
        src: '/api/music/exclusive-track-01',
        artwork: '/api/soundlab-thumbs/thumb-bitbi',
        access: 'member',
        collection: 'soundlab-exclusive',
        crossOrigin: 'use-credentials',
    },
    {
        id: 'soundlab:burning-slow',
        slug: 'burning-slow',
        title: 'Burning Slow',
        src: '/api/music/burning-slow',
        artwork: '/api/soundlab-thumbs/thumb-burning',
        access: 'member',
        collection: 'soundlab-exclusive',
        crossOrigin: 'use-credentials',
    },
    {
        id: 'soundlab:feel-it-all',
        slug: 'feel-it-all',
        title: 'Feel It All',
        src: '/api/music/feel-it-all',
        artwork: '/api/soundlab-thumbs/thumb-feel',
        access: 'member',
        collection: 'soundlab-exclusive',
        crossOrigin: 'use-credentials',
    },
    {
        id: 'soundlab:the-ones-who-made-the-light',
        slug: 'the-ones-who-made-the-light',
        title: 'The Ones Who Made the Light',
        src: '/api/music/the-ones-who-made-the-light',
        artwork: '/api/soundlab-thumbs/thumb-ones',
        access: 'member',
        collection: 'soundlab-exclusive',
        crossOrigin: 'use-credentials',
    },
    {
        id: 'soundlab:rooms-i\'ll-never-live-in',
        slug: 'rooms-i\'ll-never-live-in',
        title: "Rooms I'll Never Live In",
        src: '/api/music/rooms-i\'ll-never-live-in',
        artwork: '/api/soundlab-thumbs/thumb-rooms',
        access: 'member',
        collection: 'soundlab-exclusive',
        crossOrigin: 'use-credentials',
    },
];

const TRACKS_BY_ID = new Map(SOUNDLAB_TRACKS.map(track => [track.id, track]));
const TRACKS_BY_SLUG = new Map(SOUNDLAB_TRACKS.map(track => [track.slug, track]));

function resolveAssetUrl(value = '') {
    if (!value || typeof value !== 'string') return '';
    try {
        return new URL(value, window.location.origin).toString();
    } catch {
        return '';
    }
}

export function getSoundLabTracks(collection = 'all') {
    if (collection === 'public') {
        return SOUNDLAB_TRACKS.filter(track => track.access === 'public').map(track => ({ ...track }));
    }
    if (collection === 'member') {
        return SOUNDLAB_TRACKS.filter(track => track.access === 'member').map(track => ({ ...track }));
    }
    return SOUNDLAB_TRACKS.map(track => ({ ...track }));
}

export function getSoundLabTrackById(trackId) {
    const track = TRACKS_BY_ID.get(trackId);
    return track ? { ...track } : null;
}

export function getSoundLabTrackBySlug(slug) {
    const track = TRACKS_BY_SLUG.get(slug);
    return track ? { ...track } : null;
}

export function buildSoundLabTrack(slug, overrides = {}) {
    const baseTrack = getSoundLabTrackBySlug(slug);
    if (!baseTrack) return null;

    return {
        ...baseTrack,
        sourceUrl: resolveAssetUrl(overrides.sourceUrl || baseTrack.src),
        artworkUrl: resolveAssetUrl(overrides.artworkUrl || baseTrack.artwork),
        originPage: overrides.originPage || window.location.pathname,
        originLabel: overrides.originLabel || 'Sound Lab',
        title: overrides.title || baseTrack.title,
    };
}

export function isSoundLabTrackId(trackId) {
    return TRACKS_BY_ID.has(trackId);
}

