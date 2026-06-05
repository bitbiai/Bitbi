import { formatTime } from '../../shared/format-time.js';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

const COMMENT_BODY_MAX_LENGTH = 1000;

function getLocale() {
    const lang = String(document.documentElement?.lang || '').toLowerCase();
    return lang.startsWith('de') ? 'de-DE' : 'en-US';
}

function formatPublishedDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    try {
        return new Intl.DateTimeFormat(getLocale(), {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
    } catch {
        return String(value).slice(0, 16).replace('T', ' ');
    }
}

function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function getCollectionLabel(collection) {
    if (collection === 'mempics') return 'Mempic';
    if (collection === 'memvids') return 'Memvid';
    if (collection === 'memtracks') return 'Memtrack';
    return 'Media';
}

function getMediaDetails(item, collection) {
    const details = [
        [localeText('browse.mediaType'), getCollectionLabel(collection)],
        [localeText('browse.published'), formatPublishedDate(item?.published_at || item?.created_at)],
    ];
    if (item?.mime_type) details.push([localeText('browse.mimeType'), item.mime_type]);
    if (item?.duration_seconds) details.push([localeText('browse.duration'), formatTime(Number(item.duration_seconds) || 0)]);
    const width = Number(item?.width || item?.video_width || item?.preview?.w || item?.poster?.w);
    const height = Number(item?.height || item?.video_height || item?.preview?.h || item?.poster?.h);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        details.push([localeText('browse.resolution'), `${Math.round(width)} × ${Math.round(height)}`]);
    }
    if (item?.aspect_ratio) details.push([localeText('browse.aspect'), item.aspect_ratio]);
    const size = formatBytes(item?.size_bytes);
    if (size) details.push([localeText('browse.fileSize'), size]);
    details.push([localeText('browse.commentCount'), String(Number(item?.comment_count) || 0)]);
    return details;
}

function createButton(text, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
}

function createPlaceholderButton(text, className) {
    const button = createButton(text, className);
    button.addEventListener('click', (event) => {
        event.preventDefault();
    });
    return button;
}

function renderAvatar(parent, publisher) {
    if (publisher?.avatar?.url) {
        const avatar = new Image();
        avatar.className = 'public-media-detail__avatar';
        avatar.src = publisher.avatar.url;
        avatar.alt = '';
        avatar.loading = 'lazy';
        avatar.decoding = 'async';
        avatar.onerror = () => {
            avatar.remove();
            renderAvatar(parent, null);
        };
        parent.appendChild(avatar);
        return;
    }
    const fallback = document.createElement('span');
    fallback.className = 'public-media-detail__avatar public-media-detail__avatar--fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = 'B';
    parent.appendChild(fallback);
}

function createCommentNode(comment) {
    const item = document.createElement('article');
    item.className = 'public-media-comments__item';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'public-media-comments__avatar-wrap';
    renderAvatar(avatarWrap, comment.author || null);
    item.appendChild(avatarWrap);

    const body = document.createElement('div');
    body.className = 'public-media-comments__body';
    const meta = document.createElement('div');
    meta.className = 'public-media-comments__meta';
    const name = document.createElement('strong');
    name.textContent = comment.author?.display_name || localeText('browse.publicMember');
    const time = document.createElement('time');
    time.dateTime = comment.created_at || '';
    time.textContent = formatPublishedDate(comment.created_at);
    meta.append(name, time);
    const text = document.createElement('p');
    text.textContent = comment.body || '';
    body.append(meta, text);
    item.appendChild(body);
    return item;
}

export function createPublicMediaDetailPanel({
    item,
    collection,
    onCommentCountChange = null,
} = {}) {
    const mediaId = String(item?.id || '').trim();
    const root = document.createElement('aside');
    root.className = 'public-media-detail-panel';
    root.setAttribute('aria-label', localeText('browse.mediaDetails'));

    const publisher = item?.publisher || {};
    const header = document.createElement('header');
    header.className = 'public-media-detail__creator';
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'public-media-detail__avatar-wrap';
    renderAvatar(avatarWrap, publisher);
    const identity = document.createElement('div');
    identity.className = 'public-media-detail__identity';
    const creator = document.createElement('p');
    creator.className = 'public-media-detail__creator-name';
    creator.textContent = publisher.display_name || localeText('browse.publicMember');
    const count = document.createElement('p');
    count.className = 'public-media-detail__creator-count';
    const publicCount = publisher.stats?.public_media_count;
    count.textContent = Number.isFinite(Number(publicCount))
        ? localeText('browse.publicPosts', { count: Number(publicCount) })
        : localeText('browse.publicPostsUnknown');
    const followers = document.createElement('p');
    followers.className = 'public-media-detail__creator-count';
    followers.textContent = localeText('browse.followersPlaceholder');
    identity.append(creator, count, followers);
    const follow = createPlaceholderButton(localeText('browse.follow'), 'public-media-detail__follow');
    header.append(avatarWrap, identity, follow);
    root.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'public-media-detail__actions';
    const like = createPlaceholderButton(localeText('browse.like'), 'public-media-detail__action public-media-detail__action--like');
    like.setAttribute('aria-label', localeText('browse.likePlaceholder'));
    const menuWrap = document.createElement('div');
    menuWrap.className = 'public-media-detail__menu-wrap';
    const menuButton = createButton('•••', 'public-media-detail__action public-media-detail__menu-button');
    menuButton.setAttribute('aria-label', localeText('browse.moreActions'));
    menuButton.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'public-media-detail__menu';
    menu.hidden = true;
    [localeText('browse.share'), localeText('browse.download'), localeText('browse.report')].forEach((label) => {
        menu.appendChild(createPlaceholderButton(label, 'public-media-detail__menu-item'));
    });
    menuWrap.append(menuButton, menu);
    actions.append(like, menuWrap);
    root.appendChild(actions);

    const title = document.createElement('h3');
    title.className = 'public-media-detail__title';
    title.textContent = item?.title || getCollectionLabel(collection);
    root.appendChild(title);
    if (item?.caption) {
        const caption = document.createElement('p');
        caption.className = 'public-media-detail__caption';
        caption.textContent = item.caption;
        root.appendChild(caption);
    }

    let commentCount = Number(item?.comment_count) || 0;
    const tabs = document.createElement('div');
    tabs.className = 'public-media-detail__tabs';
    tabs.setAttribute('role', 'tablist');
    const detailsTab = createButton(localeText('browse.details'), 'public-media-detail__tab is-active');
    const commentsTab = createButton(localeText('browse.commentsWithCount', { count: commentCount }), 'public-media-detail__tab');
    detailsTab.setAttribute('role', 'tab');
    commentsTab.setAttribute('role', 'tab');
    detailsTab.setAttribute('aria-selected', 'true');
    commentsTab.setAttribute('aria-selected', 'false');
    tabs.append(detailsTab, commentsTab);
    root.appendChild(tabs);

    const detailsPanel = document.createElement('section');
    detailsPanel.className = 'public-media-detail__tab-panel';
    detailsPanel.setAttribute('role', 'tabpanel');
    const detailsList = document.createElement('dl');
    detailsList.className = 'public-media-detail__facts';
    getMediaDetails(item, collection).forEach(([label, value]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value || '—';
        detailsList.append(term, detail);
    });
    detailsPanel.appendChild(detailsList);

    const commentsPanel = document.createElement('section');
    commentsPanel.className = 'public-media-detail__tab-panel public-media-detail__tab-panel--comments';
    commentsPanel.setAttribute('role', 'tabpanel');
    commentsPanel.hidden = true;
    const commentsStatus = document.createElement('p');
    commentsStatus.className = 'public-media-comments__status';
    commentsStatus.setAttribute('aria-live', 'polite');
    const commentsList = document.createElement('div');
    commentsList.className = 'public-media-comments__list';
    const form = document.createElement('form');
    form.className = 'public-media-comments__form';
    const textarea = document.createElement('textarea');
    textarea.className = 'public-media-comments__input';
    textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
    textarea.rows = 3;
    textarea.placeholder = localeText('browse.shareThoughts');
    const submit = createButton(localeText('browse.postComment'), 'public-media-comments__submit');
    form.append(textarea, submit);
    commentsPanel.append(commentsStatus, commentsList, form);
    root.append(detailsPanel, commentsPanel);

    let loaded = false;
    let loading = false;
    let destroyed = false;

    function setCommentCount(nextCount) {
        commentCount = Math.max(0, Number(nextCount) || 0);
        commentsTab.textContent = localeText('browse.commentsWithCount', { count: commentCount });
        const lastFact = detailsList.querySelector('dd:last-child');
        if (lastFact) lastFact.textContent = String(commentCount);
        if (typeof onCommentCountChange === 'function') onCommentCountChange(commentCount);
    }

    function setActiveTab(name) {
        const showComments = name === 'comments';
        detailsPanel.hidden = showComments;
        commentsPanel.hidden = !showComments;
        detailsTab.classList.toggle('is-active', !showComments);
        commentsTab.classList.toggle('is-active', showComments);
        detailsTab.setAttribute('aria-selected', showComments ? 'false' : 'true');
        commentsTab.setAttribute('aria-selected', showComments ? 'true' : 'false');
        if (showComments) loadComments();
    }

    function renderComments(comments) {
        commentsList.replaceChildren();
        if (!comments.length) {
            commentsStatus.textContent = localeText('browse.noCommentsYet');
            return;
        }
        commentsStatus.textContent = '';
        comments.forEach((comment) => commentsList.appendChild(createCommentNode(comment)));
    }

    async function loadComments() {
        if (loaded || loading || !mediaId || destroyed) return;
        loading = true;
        commentsStatus.textContent = localeText('browse.loadingComments');
        try {
            const response = await fetch(`/api/gallery/${encodeURIComponent(collection)}/${encodeURIComponent(mediaId)}/comments`, {
                credentials: 'same-origin',
            });
            if (!response.ok) throw new Error('comments_failed');
            const payload = await response.json();
            const data = payload?.data || {};
            if (destroyed) return;
            loaded = true;
            setCommentCount(data.count);
            renderComments(Array.isArray(data.comments) ? data.comments : []);
        } catch {
            if (!destroyed) commentsStatus.textContent = localeText('browse.commentsLoadFailed');
        } finally {
            loading = false;
        }
    }

    async function submitComment(event) {
        event.preventDefault();
        const body = textarea.value.replace(/\s+/g, ' ').trim();
        if (!body) {
            commentsStatus.textContent = localeText('browse.commentEmpty');
            return;
        }
        if (body.length > COMMENT_BODY_MAX_LENGTH) {
            commentsStatus.textContent = localeText('browse.commentTooLong', { count: COMMENT_BODY_MAX_LENGTH });
            return;
        }
        submit.disabled = true;
        commentsStatus.textContent = localeText('browse.postingComment');
        try {
            const response = await fetch(`/api/gallery/${encodeURIComponent(collection)}/${encodeURIComponent(mediaId)}/comments`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
            });
            if (response.status === 401 || response.status === 403) {
                commentsStatus.textContent = localeText('browse.signInToComment');
                return;
            }
            if (!response.ok) throw new Error('comment_post_failed');
            const payload = await response.json();
            const comment = payload?.data?.comment;
            if (comment) {
                loaded = true;
                commentsList.prepend(createCommentNode(comment));
            }
            textarea.value = '';
            setCommentCount(payload?.data?.count ?? (commentCount + 1));
            commentsStatus.textContent = localeText('browse.commentPosted');
        } catch {
            commentsStatus.textContent = localeText('browse.commentPostFailed');
        } finally {
            submit.disabled = false;
        }
    }

    function closeMenu() {
        menu.hidden = true;
        menuButton.setAttribute('aria-expanded', 'false');
    }

    function handleDocumentClick(event) {
        if (!menuWrap.contains(event.target)) closeMenu();
    }

    menuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const nextHidden = !menu.hidden;
        menu.hidden = nextHidden;
        menuButton.setAttribute('aria-expanded', nextHidden ? 'false' : 'true');
    });
    document.addEventListener('click', handleDocumentClick);
    detailsTab.addEventListener('click', () => setActiveTab('details'));
    commentsTab.addEventListener('click', () => setActiveTab('comments'));
    form.addEventListener('submit', submitComment);
    loadComments();

    return {
        root,
        destroy() {
            destroyed = true;
            document.removeEventListener('click', handleDocumentClick);
            root.remove();
        },
    };
}
