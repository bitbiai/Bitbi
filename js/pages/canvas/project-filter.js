// Presentation only: searching never selects, saves or modifies a project.
export function createCanvasProjectFilter({ list, german }) {
    const field = document.createElement('label');
    field.className = 'canvas-project-search';
    const label = document.createElement('span');
    label.className = 'canvas-sr-only';
    label.textContent = german ? 'Projekte suchen' : 'Search projects';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'canvas-input';
    input.placeholder = label.textContent;
    input.autocomplete = 'off';
    input.setAttribute('aria-controls', list.id);
    field.append(label, input);
    const summary = document.createElement('p');
    summary.className = 'canvas-project-search__summary';
    summary.setAttribute('role', 'status');
    list.before(field, summary);
    const empty = document.createElement('p');
    empty.className = 'canvas-muted';
    empty.textContent = german ? 'Keine passenden Projekte.' : 'No matching projects.';
    function refresh() {
        const query = input.value.trim().toLocaleLowerCase(german ? 'de' : 'en');
        const items = [...list.querySelectorAll('.canvas-project-item')];
        for (const item of items) item.hidden = !String(item.dataset.title || '').toLocaleLowerCase(german ? 'de' : 'en').includes(query);
        const visible = items.filter(item => !item.hidden).length;
        summary.textContent = query ? `${visible} / ${items.length} ${german ? 'Projekte' : 'projects'}` : '';
        summary.hidden = !query;
        empty.remove();
        if (query && !visible && items.length) list.append(empty);
    }
    input.addEventListener('input', refresh);
    input.addEventListener('search', refresh);
    return { refresh };
}
