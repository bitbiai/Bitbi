import { formatTime } from '../../shared/format-time.js';
import {
    apiGetMe,
    apiGetPublicMediaInteractions,
    apiTogglePublicMediaFollow,
    apiTogglePublicMediaLike,
} from '../../shared/auth-api.js';
import { getAuthState } from '../../shared/auth-state.js';
import { localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

const COMMENT_BODY_MAX_LENGTH = 1000;
const PUBLIC_DETAIL_TITLE_MAX_LENGTH = 21;
let commentAuthStatePromise = null;

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
    return details;
}

function truncatePublicDetailTitle(value, maxLength = PUBLIC_DETAIL_TITLE_MAX_LENGTH) {
    const fallback = String(value || '').trim();
    if (!fallback) return '';
    const characters = Array.from(fallback);
    if (characters.length <= maxLength) return fallback;
    return `${characters.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

async function resolveCommentAuthState() {
    const state = getAuthState();
    if (state.ready) return !!state.loggedIn;
    if (!commentAuthStatePromise) {
        commentAuthStatePromise = apiGetMe()
            .then((result) => !!(result?.ok && result.data?.loggedIn && result.data?.user))
            .catch(() => false);
    }
    return commentAuthStatePromise;
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

function formatCount(value) {
    const count = Math.max(0, Number(value) || 0);
    return new Intl.NumberFormat(getLocale(), { notation: count >= 1000 ? 'compact' : 'standard' }).format(count);
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
    const follow = createButton(localeText('browse.follow'), 'public-media-detail__follow');
    follow.setAttribute('aria-pressed', 'false');
    header.append(avatarWrap, identity, follow);
    root.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'public-media-detail__actions';
    const like = createButton(localeText('browse.like'), 'public-media-detail__action public-media-detail__action--like');
    like.setAttribute('aria-pressed', 'false');
    like.setAttribute('aria-label', localeText('browse.like'));
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
    const interactionStatus = document.createElement('p');
    interactionStatus.className = 'public-media-detail__interaction-status';
    interactionStatus.setAttribute('aria-live', 'polite');
    root.appendChild(interactionStatus);

    const title = document.createElement('h3');
    title.className = 'public-media-detail__title';
    title.textContent = truncatePublicDetailTitle(item?.title || getCollectionLabel(collection));
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
    const authHint = document.createElement('p');
    authHint.className = 'public-media-comments__auth-hint';
    authHint.textContent = localeText('browse.signInToComment');
    authHint.hidden = true;
    const form = document.createElement('form');
    form.className = 'public-media-comments__form';
    const textarea = document.createElement('textarea');
    textarea.className = 'public-media-comments__input';
    textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
    textarea.rows = 3;
    textarea.placeholder = localeText('browse.shareThoughts');
    const submit = createButton(localeText('browse.postComment'), 'public-media-comments__submit');
    form.append(textarea, submit);
    commentsPanel.append(commentsStatus, commentsList, authHint, form);
    root.append(detailsPanel, commentsPanel);

    let loaded = false;
    let loading = false;
    let destroyed = false;
    let canComment = false;
    let interactionBusy = false;
    let interactionState = {
        like_count: Number(item?.like_count) || 0,
        liked_by_viewer: false,
        follower_count: null,
        followed_by_viewer: false,
        can_follow: false,
        is_own_media: false,
    };

    function setCommentCount(nextCount) {
        commentCount = Math.max(0, Number(nextCount) || 0);
        commentsTab.textContent = localeText('browse.commentsWithCount', { count: commentCount });
        if (typeof onCommentCountChange === 'function') onCommentCountChange(commentCount);
    }

    function renderCommentAuthState(loggedIn) {
        canComment = loggedIn === true;
        authHint.hidden = canComment;
        form.hidden = !canComment;
        submit.disabled = !canComment;
    }

    function renderInteractionState() {
        const likeCount = Math.max(0, Number(interactionState.like_count) || 0);
        like.textContent = interactionState.liked_by_viewer
            ? localeText('browse.likedWithCount', { count: formatCount(likeCount) })
            : localeText('browse.likeWithCount', { count: formatCount(likeCount) });
        like.setAttribute('aria-pressed', String(Boolean(interactionState.liked_by_viewer)));
        like.disabled = interactionBusy;

        if (Number.isFinite(Number(interactionState.follower_count))) {
            followers.textContent = localeText('browse.followersCount', {
                count: formatCount(interactionState.follower_count),
            });
        }

        follow.textContent = interactionState.followed_by_viewer
            ? localeText('browse.following')
            : localeText('browse.follow');
        follow.setAttribute('aria-pressed', String(Boolean(interactionState.followed_by_viewer)));
        follow.disabled = interactionBusy || interactionState.is_own_media === true;
        follow.hidden = interactionState.is_own_media === true;
    }

    function dispatchInteractionChange() {
        if (typeof window?.dispatchEvent !== 'function') return;
        window.dispatchEvent(new CustomEvent('bitbi:public-media-interaction-change', {
            detail: {
                collection,
                mediaId,
                likeCount: interactionState.like_count,
                likedByViewer: interactionState.liked_by_viewer,
                followedByViewer: interactionState.followed_by_viewer,
            },
        }));
    }

    async function loadInteractionState() {
        if (!mediaId || !collection) return;
        try {
            const result = await apiGetPublicMediaInteractions(collection, mediaId);
            if (!result.ok) return;
            const data = result.data?.data || result.data || {};
            interactionState = {
                ...interactionState,
                like_count: Number(data.like_count) || 0,
                liked_by_viewer: data.liked_by_viewer === true,
                follower_count: Number(data.follower_count),
                followed_by_viewer: data.followed_by_viewer === true,
                can_follow: data.can_follow === true,
                is_own_media: data.is_own_media === true,
            };
            if (Number.isFinite(Number(data.comment_count))) {
                setCommentCount(Number(data.comment_count));
            }
            renderInteractionState();
        } catch {
            // Interaction state is progressive enhancement; comments/media remain usable.
        }
    }

    async function requireInteractionAuth() {
        const loggedIn = await resolveCommentAuthState();
        if (loggedIn) return true;
        interactionStatus.textContent = localeText('browse.signInToInteract');
        return false;
    }

    async function toggleLike() {
        if (interactionBusy || !mediaId) return;
        if (!await requireInteractionAuth()) return;
        interactionBusy = true;
        interactionStatus.textContent = '';
        const nextLiked = !interactionState.liked_by_viewer;
        interactionState = {
            ...interactionState,
            liked_by_viewer: nextLiked,
            like_count: Math.max(0, Number(interactionState.like_count || 0) + (nextLiked ? 1 : -1)),
        };
        renderInteractionState();
        const result = await apiTogglePublicMediaLike(collection, mediaId, nextLiked);
        interactionBusy = false;
        if (result.ok) {
            const data = result.data?.data || result.data || {};
            interactionState = {
                ...interactionState,
                like_count: Number(data.like_count) || 0,
                liked_by_viewer: data.liked_by_viewer === true,
            };
            dispatchInteractionChange();
        } else {
            interactionStatus.textContent = result.status === 401 || result.status === 403
                ? localeText('browse.signInToInteract')
                : localeText('browse.interactionFailed');
            await loadInteractionState();
        }
        renderInteractionState();
    }

    async function toggleFollow() {
        if (interactionBusy || !mediaId || interactionState.is_own_media) return;
        if (!await requireInteractionAuth()) return;
        interactionBusy = true;
        interactionStatus.textContent = '';
        const nextFollowed = !interactionState.followed_by_viewer;
        interactionState = {
            ...interactionState,
            followed_by_viewer: nextFollowed,
            follower_count: Number.isFinite(Number(interactionState.follower_count))
                ? Math.max(0, Number(interactionState.follower_count) + (nextFollowed ? 1 : -1))
                : interactionState.follower_count,
        };
        renderInteractionState();
        const result = await apiTogglePublicMediaFollow(collection, mediaId, nextFollowed);
        interactionBusy = false;
        if (result.ok) {
            const data = result.data?.data || result.data || {};
            interactionState = {
                ...interactionState,
                follower_count: Number(data.follower_count),
                followed_by_viewer: data.followed_by_viewer === true,
                can_follow: data.can_follow === true,
            };
            dispatchInteractionChange();
        } else {
            interactionStatus.textContent = result.status === 401 || result.status === 403
                ? localeText('browse.signInToInteract')
                : localeText('browse.interactionFailed');
            await loadInteractionState();
        }
        renderInteractionState();
    }

    async function refreshCommentAuthState() {
        const loggedIn = await resolveCommentAuthState();
        if (!destroyed) renderCommentAuthState(loggedIn);
    }

    function handleAuthChange(event) {
        renderCommentAuthState(event?.detail?.loggedIn === true);
    }

    function setActiveTab(name) {
        const showComments = name === 'comments';
        detailsPanel.hidden = showComments;
        commentsPanel.hidden = !showComments;
        detailsTab.classList.toggle('is-active', !showComments);
        commentsTab.classList.toggle('is-active', showComments);
        detailsTab.setAttribute('aria-selected', showComments ? 'false' : 'true');
        commentsTab.setAttribute('aria-selected', showComments ? 'true' : 'false');
        if (showComments) {
            refreshCommentAuthState();
            loadComments();
        }
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
        if (!canComment) {
            commentsStatus.textContent = localeText('browse.signInToComment');
            authHint.hidden = false;
            return;
        }
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
                renderCommentAuthState(false);
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
            submit.disabled = !canComment;
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
    document.addEventListener('bitbi:auth-change', handleAuthChange);
    like.addEventListener('click', toggleLike);
    follow.addEventListener('click', toggleFollow);
    detailsTab.addEventListener('click', () => setActiveTab('details'));
    commentsTab.addEventListener('click', () => setActiveTab('comments'));
    form.addEventListener('submit', submitComment);
    renderCommentAuthState(false);
    renderInteractionState();
    loadInteractionState();

    return {
        root,
        destroy() {
            destroyed = true;
            document.removeEventListener('click', handleDocumentClick);
            document.removeEventListener('bitbi:auth-change', handleAuthChange);
            root.remove();
        },
    };
}
