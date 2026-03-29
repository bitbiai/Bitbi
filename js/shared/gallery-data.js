/* ============================================================
   BITBI — Gallery image data (R2-backed public variants)
   ============================================================
   Single source of truth for public gallery items 100–108.
   Change R2_PUBLIC_BASE when the production bucket URL is known.
   ============================================================ */

const R2_PUBLIC_BASE = 'https://pub.bitbi.ai';

function r2(path) { return `${R2_PUBLIC_BASE}/${path}`; }

export const galleryItems = [
    {
        id: '100',
        slug: 'crystal-bitbi-b-orbit',
        title: 'The Letter B Goes Interstellar',
        caption: 'A glowing glass letter B floats in deep space, orbited by rings of binary code and neon data streams \u2014 because even the alphabet deserves its own solar system.',
        category: 'pictures',
        aspectRatio: '16:9',
        thumb:   { url: r2('gallery/thumbs/ai-creations/crystal-bitbi-b-orbit-480.webp'),      w: 480,  h: 271  },
        preview: { url: r2('gallery/previews/ai-creations/crystal-bitbi-b-orbit-1600.webp'),    w: 1600, h: 905  },
        full:    { url: r2('gallery/full/ai-creations/crystal-bitbi-b-orbit-2560.webp'),        w: 2560, h: 1448 },
    },
    {
        id: '101',
        slug: 'cute-alien-octopus',
        title: 'Coral Reef Nightmare Buddy',
        caption: 'A chubby blue-and-purple blob creature with mismatched googly eyes, an open mouth full of confusion, and way too many orange tentacles \u2014 sitting on a mossy rock like it owns the place.',
        category: 'creepy',
        aspectRatio: '4:3',
        thumb:   { url: r2('gallery/thumbs/ai-creations/cute-alien-octopus-480.webp'),      w: 480,  h: 360 },
        preview: { url: r2('gallery/previews/ai-creations/cute-alien-octopus-900.webp'),    w: 900,  h: 675 },
        full:    { url: r2('gallery/full/ai-creations/cute-alien-octopus-1024.webp'),       w: 1024, h: 768 },
    },
    {
        id: '102',
        slug: 'blue-microbe-monster',
        title: 'The Friendliest Virus You Ever Saw',
        caption: 'A round, spiky, ice-blue germ ball with three shiny black eyes and a massive toothy grin, floating in a teal abyss surrounded by its equally cheerful germ friends. Disturbingly adorable.',
        category: 'creepy',
        aspectRatio: '4:3',
        thumb:   { url: r2('gallery/thumbs/ai-creations/blue-microbe-monster-480.webp'),      w: 480,  h: 360 },
        preview: { url: r2('gallery/previews/ai-creations/blue-microbe-monster-900.webp'),    w: 900,  h: 675 },
        full:    { url: r2('gallery/full/ai-creations/blue-microbe-monster-1024.webp'),       w: 1024, h: 768 },
    },
    {
        id: '103',
        slug: 'red-eyed-spider-creature',
        title: 'Angry Ant from Hell',
        caption: 'A massive red ant-like beast with glowing crimson eyes, gnarly fangs, and twitching antennae perches on a mossy branch in a jungle \u2014 looking personally offended that you exist.',
        category: 'creepy',
        aspectRatio: '4:3',
        thumb:   { url: r2('gallery/thumbs/ai-creations/red-eyed-spider-creature-480.webp'),      w: 480,  h: 360 },
        preview: { url: r2('gallery/previews/ai-creations/red-eyed-spider-creature-900.webp'),    w: 900,  h: 675 },
        full:    { url: r2('gallery/full/ai-creations/red-eyed-spider-creature-1024.webp'),       w: 1024, h: 768 },
    },
    {
        id: '104',
        slug: 'swamp-lizard-horror',
        title: 'Swamp Thing\u2019s Ugly Cousin',
        caption: 'A slimy green amphibious monstrosity crawls out of murky swamp water with fangs bared and reddish tentacles dangling from its mouth. Looks like it just ate something it regrets.',
        category: 'creepy',
        aspectRatio: '4:3',
        thumb:   { url: r2('gallery/thumbs/ai-creations/swamp-lizard-horror-480.webp'),      w: 480,  h: 360 },
        preview: { url: r2('gallery/previews/ai-creations/swamp-lizard-horror-900.webp'),    w: 900,  h: 675 },
        full:    { url: r2('gallery/full/ai-creations/swamp-lizard-horror-1024.webp'),       w: 1024, h: 768 },
    },
    {
        id: '105',
        slug: 'moss-forest-guardian',
        title: 'Mossgirl Stares Into Your Soul',
        caption: 'Close-up portrait of a face half-consumed by green moss and twisted branches, with piercing icy blue eyes peering out. She is judging you, and you deserve it.',
        category: 'creepy',
        aspectRatio: '4:3',
        thumb:   { url: r2('gallery/thumbs/ai-creations/moss-forest-guardian-480.webp'),      w: 480,  h: 360 },
        preview: { url: r2('gallery/previews/ai-creations/moss-forest-guardian-900.webp'),    w: 900,  h: 675 },
        full:    { url: r2('gallery/full/ai-creations/moss-forest-guardian-1024.webp'),       w: 1024, h: 768 },
    },
    {
        id: '106',
        slug: 'horned-shadow-demon',
        title: 'Monday Morning Demon',
        caption: 'A grey-skinned, red-eyed demon with massive curved horns and a permanent scowl sits among dead tree branches wearing a button-up shirt. Corporate evil has never looked this literal.',
        category: 'creepy',
        aspectRatio: '4:3',
        thumb:   { url: r2('gallery/thumbs/ai-creations/horned-shadow-demon-480.webp'),      w: 480,  h: 360 },
        preview: { url: r2('gallery/previews/ai-creations/horned-shadow-demon-900.webp'),    w: 900,  h: 675 },
        full:    { url: r2('gallery/full/ai-creations/horned-shadow-demon-1024.webp'),       w: 1024, h: 768 },
    },
    {
        id: '107',
        slug: 'blue-moth-specimen',
        title: 'Entomologist\u2019s Fever Dream',
        caption: 'A furry blue moth-creature with red eyes and fangs stands center stage, surrounded by dozens of meticulously arranged bizarre insects, spiders, and spiky orbs on a teal background \u2014 like a natural history museum designed by a madman.',
        category: 'creepy',
        aspectRatio: '4:3',
        thumb:   { url: r2('gallery/thumbs/ai-creations/blue-moth-specimen-480.webp'),      w: 480,  h: 360 },
        preview: { url: r2('gallery/previews/ai-creations/blue-moth-specimen-900.webp'),    w: 900,  h: 675 },
        full:    { url: r2('gallery/full/ai-creations/blue-moth-specimen-1024.webp'),       w: 1024, h: 768 },
    },
    {
        id: '108',
        slug: 'emerald-blast-scene',
        title: 'Planetary Meltdown in Green',
        caption: 'A massive green planet crumbles apart in a blinding explosion of sparks, flying rocks, and cosmic debris \u2014 captured in that split second where everything goes spectacularly wrong.',
        category: 'experimental',
        aspectRatio: '16:9',
        thumb:   { url: r2('gallery/thumbs/ai-creations/emerald-blast-scene-480.webp'),      w: 480,  h: 269 },
        preview: { url: r2('gallery/previews/ai-creations/emerald-blast-scene-960.webp'),    w: 960,  h: 539 },
        full:    { url: r2('gallery/full/ai-creations/emerald-blast-scene-1131.webp'),       w: 1131, h: 635 },
    },
];
