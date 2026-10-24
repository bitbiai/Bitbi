// Native keyboard scrolling of a focused overflow region differs in WebKit.
// Only the focused legal table region owns these keys; links/inputs keep theirs.
export function initLegalTables(root = document.querySelector('main')) {
    if (!root) return () => {};
    const onKeyDown = event => {
        const region = event.target;
        if (!region?.matches?.('.policy-table-wrap') || event.defaultPrevented
            || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const maximum = region.scrollWidth - region.clientWidth;
        if (maximum <= 0) return;
        const positions = {
            ArrowLeft: region.scrollLeft - 64,
            ArrowRight: region.scrollLeft + 64,
            Home: 0,
            End: maximum,
        };
        if (!Object.hasOwn(positions, event.key)) return;
        event.preventDefault();
        region.scrollTo({ left: Math.max(0, Math.min(maximum, positions[event.key])), behavior: 'instant' });
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
}
