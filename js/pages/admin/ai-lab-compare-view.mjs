// Compare-only result presentation. Generation, cancellation, saved-result
// identity and persistence stay in the AI Lab controller. This view performs no
// API requests and reads current preferences/results only when rendering.
import { getResultCode, getWarnings } from './ai-lab-result-state.mjs?v=__ASSET_VERSION__';

function normalizeCompareText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueCaseInsensitive(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function splitCompareChunks(value) {
    const text = String(value || '');
    const chunks = text
        .split(/\n+/)
        .flatMap((line) => line.split(/(?<=[.!?])\s+/))
        .map((chunk) => normalizeCompareText(chunk))
        .filter(Boolean);

    return uniqueCaseInsensitive(chunks);
}

export function buildCompareDiff(entries) {
    const a = entries?.[0];
    const b = entries?.[1];
    if (!a?.ok || !b?.ok || !a.text || !b.text) {
        return {
            available: false,
            message: 'Difference aid becomes available when both compare outputs succeed.',
        };
    }

    const textA = normalizeCompareText(a.text);
    const textB = normalizeCompareText(b.text);
    const chunksA = splitCompareChunks(a.text);
    const chunksB = splitCompareChunks(b.text);
    const chunkSetB = new Set(chunksB.map((chunk) => chunk.toLowerCase()));
    const chunkSetA = new Set(chunksA.map((chunk) => chunk.toLowerCase()));
    const shared = chunksA.filter((chunk) => chunkSetB.has(chunk.toLowerCase())).slice(0, 4);
    const onlyA = chunksA.filter((chunk) => !chunkSetB.has(chunk.toLowerCase())).slice(0, 4);
    const onlyB = chunksB.filter((chunk) => !chunkSetA.has(chunk.toLowerCase())).slice(0, 4);

    return {
        available: true,
        identical: !!textA && textA === textB,
        charCountA: textA.length,
        charCountB: textB.length,
        shared,
        onlyA,
        onlyB,
    };
}

export function createAdminAiCompareView({
    refs,
    getResult,
    getOnlyDifferences,
    formatters: { formatElapsed, formatTime, formatValue, truncateText },
    renderers: { renderMeta, renderWarnings, renderDebug, setResultState },
    describeError,
}) {
    function getCompareCardText(entry, diff, side) {
        const originalText = entry?.text || '';
        if (!getOnlyDifferences()) {
            return originalText;
        }

        if (!entry?.ok || !originalText || !diff?.available) {
            return originalText;
        }

        const uniqueChunks = side === 'a' ? diff.onlyA : diff.onlyB;
        if (uniqueChunks.length > 0) {
            return uniqueChunks.join('\n\n');
        }

        if (diff.identical) {
            return 'No unique phrasing detected in difference-only view. Both outputs normalize to the same text.';
        }

        return 'No unique phrasing detected for this model in difference-only view.';
    }

    function getCompareDifferenceView(entry, diff, side) {
        const originalText = entry?.text || '';
        const emptyCopyMessage = diff?.available
            ? 'No distinctive compare text available to copy.'
            : 'Difference-only copy requires two successful compare outputs.';

        if (!getOnlyDifferences()) {
            return {
                displayText: originalText,
                copyText: '',
                showCopyButton: false,
                copyDisabled: true,
                copyTitle: 'Enable Show Only Differences to copy distinctive text only.',
            };
        }

        if (!entry?.ok || !originalText) {
            return {
                displayText: originalText,
                copyText: '',
                showCopyButton: false,
                copyDisabled: true,
                copyTitle: emptyCopyMessage,
            };
        }

        if (!diff?.available) {
            return {
                displayText: originalText,
                copyText: '',
                showCopyButton: true,
                copyDisabled: true,
                copyTitle: emptyCopyMessage,
            };
        }

        const uniqueChunks = side === 'a' ? diff.onlyA : diff.onlyB;
        if (uniqueChunks.length > 0) {
            const copyText = uniqueChunks.join('\n\n');
            return {
                displayText: copyText,
                copyText,
                showCopyButton: true,
                copyDisabled: false,
                copyTitle: 'Copy only the distinctive compare text.',
            };
        }

        return {
            displayText: getCompareCardText(entry, diff, side),
            copyText: '',
            showCopyButton: true,
            copyDisabled: true,
            copyTitle: emptyCopyMessage,
        };
    }

    function renderCompareCard(cardRefs, entry, options = {}) {
        cardRefs.error.hidden = true;
        cardRefs.usage.hidden = true;
        cardRefs.copy.hidden = true;
        if (cardRefs.copyDiff) {
            cardRefs.copyDiff.hidden = true;
            cardRefs.copyDiff.disabled = true;
            cardRefs.copyDiff.title = '';
        }
        cardRefs.text.textContent = '';

        if (!entry) {
            cardRefs.label.textContent = 'Waiting for run';
            cardRefs.meta.textContent = '';
            cardRefs.error.textContent = '';
            return;
        }

        cardRefs.label.textContent = entry.model?.label || entry.model?.id || 'Model';
        const displayText = options.displayText ?? entry.text ?? '';
        cardRefs.meta.textContent = [
            entry.model?.id || '',
            entry.model?.vendor || '',
            typeof entry.elapsedMs === 'number' ? formatElapsed(entry.elapsedMs) : '',
            entry.text ? `${normalizeCompareText(entry.text).length} chars` : '',
            options.onlyDifferences ? 'differences only' : '',
        ]
            .filter(Boolean)
            .join(' · ');

        if (!entry.ok) {
            cardRefs.error.hidden = false;
            cardRefs.error.textContent = entry.error || 'Model run failed.';
            return;
        }

        cardRefs.text.textContent = displayText;
        cardRefs.copy.hidden = !entry.text;
        if (cardRefs.copyDiff) {
            cardRefs.copyDiff.hidden = !options.copyDiff?.visible;
            cardRefs.copyDiff.disabled = !!options.copyDiff?.disabled;
            cardRefs.copyDiff.title = options.copyDiff?.title || '';
        }

        if (entry.usage && typeof entry.usage === 'object' && !Array.isArray(entry.usage)) {
            cardRefs.usage.hidden = false;
            cardRefs.usage.textContent = Object.entries(entry.usage)
                .map(([key, value]) => `${key}: ${formatValue(value)}`)
                .join(' · ');
        }
    }

    function renderCompareSummaryChip(container, text, variant = '') {
        const chip = document.createElement('div');
        chip.className = `admin-ai__compare-summary-chip${variant ? ` admin-ai__compare-summary-chip--${variant}` : ''}`;
        chip.textContent = text;
        container.appendChild(chip);
    }

    function appendCompareDiffBlock(parent, title, items, emptyText) {
        const block = document.createElement('div');
        block.className = 'admin-ai__diff-block';

        const label = document.createElement('div');
        label.className = 'admin-ai__mini-title';
        label.textContent = title;
        block.appendChild(label);

        const list = document.createElement('div');
        list.className = 'admin-ai__diff-list';

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'admin-ai__diff-empty';
            empty.textContent = emptyText;
            list.appendChild(empty);
        } else {
            items.forEach((item) => {
                const row = document.createElement('div');
                row.className = 'admin-ai__diff-item';
                row.textContent = truncateText(item, 220);
                row.title = item;
                list.appendChild(row);
            });
        }

        block.appendChild(list);
        parent.appendChild(block);
    }

    function renderCompareDiff(entries) {
        refs.diff.replaceChildren();

        if (!entries || entries.length === 0) {
            refs.diff.hidden = true;
            return;
        }

        refs.diff.hidden = false;

        const diff = buildCompareDiff(entries);
        const head = document.createElement('div');
        head.className = 'admin-ai__compare-diff-head';

        const title = document.createElement('div');
        title.className = 'admin-ai__mini-title';
        title.textContent = 'Difference Aid';
        head.appendChild(title);

        if (!diff.available) {
            const note = document.createElement('div');
            note.className = 'admin-ai__diff-note';
            note.textContent = diff.message;
            head.appendChild(note);
            refs.diff.appendChild(head);
            return;
        }

        const summary = document.createElement('div');
        summary.className = 'admin-ai__compare-summary';
        renderCompareSummaryChip(summary, diff.identical ? 'Outputs are identical' : 'Outputs differ', diff.identical ? 'identical' : 'different');
        if (getOnlyDifferences()) {
            renderCompareSummaryChip(summary, 'Only differences view enabled', 'different');
        }
        renderCompareSummaryChip(summary, `Model A: ${diff.charCountA} chars`);
        renderCompareSummaryChip(summary, `Model B: ${diff.charCountB} chars`);
        renderCompareSummaryChip(summary, `${diff.shared.length} shared chunk${diff.shared.length === 1 ? '' : 's'}`);
        renderCompareSummaryChip(summary, `${diff.onlyA.length + diff.onlyB.length} distinctive chunk${diff.onlyA.length + diff.onlyB.length === 1 ? '' : 's'}`);
        head.appendChild(summary);
        refs.diff.appendChild(head);

        const grid = document.createElement('div');
        grid.className = 'admin-ai__diff-grid';
        if (!getOnlyDifferences()) {
            appendCompareDiffBlock(
                grid,
                'Shared Phrasing',
                diff.shared,
                diff.identical ? 'The two outputs normalize to the same text.' : 'No identical sentence-level chunks were found.'
            );
        }
        appendCompareDiffBlock(grid, 'Model A Distinctive', diff.onlyA, 'No unique phrasing detected for model A.');
        appendCompareDiffBlock(grid, 'Model B Distinctive', diff.onlyB, 'No unique phrasing detected for model B.');
        refs.diff.appendChild(grid);
    }

    function renderCompareResult() {
        const result = getResult();
        const response = result?.raw || null;
        const entries = Array.isArray(response?.result?.results) ? response.result.results : [];
        const resultCode = getResultCode(result);
        const diff = buildCompareDiff(entries);
        const viewA = getCompareDifferenceView(entries[0] || null, diff, 'a');
        const viewB = getCompareDifferenceView(entries[1] || null, diff, 'b');
        refs.save.hidden = entries.length === 0;

        renderMeta(refs.meta, response ? [
            { label: 'Elapsed', value: formatElapsed(response.elapsedMs) },
            { label: 'Received', value: formatTime(result?.receivedAt) },
            { label: 'Models', value: entries.length },
            { label: 'Succeeded', value: entries.filter((entry) => entry?.ok).length },
            { label: 'Failed', value: entries.filter((entry) => !entry?.ok).length },
            { label: 'View', value: getOnlyDifferences() ? 'Only differences' : 'Full outputs' },
            { label: 'Temperature', value: response.result?.temperature },
            { label: 'Max Tokens', value: response.result?.maxTokens },
        ] : []);
        renderWarnings(refs.warnings, response ? getWarnings(response) : []);
        renderDebug(refs.debug, refs.raw, result?.debugRaw || response);
        renderCompareCard(
            {
                label: refs.aLabel,
                meta: refs.aMeta,
                text: refs.aText,
                usage: refs.aUsage,
                error: refs.aError,
                copy: refs.aCopy,
                copyDiff: refs.aCopyDiff,
            },
            entries[0] || null,
            {
                displayText: viewA.displayText,
                onlyDifferences: getOnlyDifferences() && diff.available && !!entries[0]?.ok,
                copyDiff: {
                    visible: viewA.showCopyButton,
                    disabled: viewA.copyDisabled,
                    title: viewA.copyTitle,
                },
            }
        );
        renderCompareCard(
            {
                label: refs.bLabel,
                meta: refs.bMeta,
                text: refs.bText,
                usage: refs.bUsage,
                error: refs.bError,
                copy: refs.bCopy,
                copyDiff: refs.bCopyDiff,
            },
            entries[1] || null,
            {
                displayText: viewB.displayText,
                onlyDifferences: getOnlyDifferences() && diff.available && !!entries[1]?.ok,
                copyDiff: {
                    visible: viewB.showCopyButton,
                    disabled: viewB.copyDisabled,
                    title: viewB.copyTitle,
                },
            }
        );
        renderCompareDiff(entries);

        if (!result) {
            setResultState(refs.state, 'neutral', 'No compare run yet.');
            return;
        }

        if (result.status === 'loading') {
            setResultState(
                refs.state,
                'loading',
                response ? 'Running model comparison. Previous result shown below.' : 'Running model comparison...'
            );
            return;
        }

        if (result.status === 'aborted') {
            setResultState(
                refs.state,
                'aborted',
                response ? 'Compare request cancelled. Previous result preserved.' : 'Compare request cancelled.'
            );
            return;
        }

        if (result.status === 'timeout') {
            setResultState(
                refs.state,
                'timeout',
                response
                    ? `${result.error || 'Compare request timed out.'} Previous result preserved.`
                    : result.error || 'Compare request timed out.'
            );
            return;
        }

        if (result.status === 'error') {
            setResultState(
                refs.state,
                'error',
                response
                    ? `${describeError(result.error, resultCode)} Previous result preserved.`
                    : describeError(result.error, resultCode)
            );
            return;
        }

        setResultState(
            refs.state,
            'success',
            response?.code === 'partial_success'
                ? 'Compare response ready with partial success. Review warnings and per-model errors.'
                : 'Compare response ready.'
        );
    }

    return { render: renderCompareResult, getDifferenceView: getCompareDifferenceView };
}
