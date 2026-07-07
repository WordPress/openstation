/**
 * My WordPress — type-aware media preview pane.
 *
 * Switches on MIME group:
 *
 *   - `image/*` → `<img>` with object-fit:contain
 *   - `video/*` → `<video controls>` (with poster when available)
 *   - `audio/*` → poster + `<audio controls>`
 *   - PDF / documents → big dashicon + metadata table
 *
 * Renders a metadata grid (filename, dimensions, filesize, MIME,
 * uploaded, uploader, alt text, caption, description) and an
 * action-button row sourced from server descriptors merged with
 * the `desktop-mode.my-wordpress.preview-actions` JS filter.
 *
 * Plugins can inject arbitrary DOM into the three named slots
 * (`'header'`, `'meta'`, `'footer'`) via the
 * `desktop-mode.my-wordpress.preview-extras` action.
 *
 * @public
 * @since 0.8.6
 */

import { __ } from '../i18n';
import { applyFilters, doAction } from '../hooks';
import { stripTags } from './dom-utils';
import type {
	MediaListItem,
	MediaPreviewAction,
	MediaPreviewActionContext,
	MediaPreviewSlot,
} from './types';

const MIME_DASHICON_FALLBACK = 'dashicons-media-default';

const MIME_DASHICON_MAP: Array< { test: RegExp; icon: string } > = [
	{ test: /^image\//, icon: 'dashicons-format-image' },
	{ test: /^video\//, icon: 'dashicons-format-video' },
	{ test: /^audio\//, icon: 'dashicons-format-audio' },
	{ test: /pdf$/, icon: 'dashicons-media-document' },
	{ test: /^application\/(zip|x-tar|x-rar|x-7z)/, icon: 'dashicons-media-archive' },
	{ test: /spreadsheet|excel/, icon: 'dashicons-media-spreadsheet' },
	{ test: /word|document/, icon: 'dashicons-media-document' },
	{ test: /^text\//, icon: 'dashicons-media-text' },
];

/**
 * Pick a dashicon for the given MIME type.
 *
 * @public
 * @since 0.8.6
 */
export function dashiconForMime( mime: string ): string {
	for ( const entry of MIME_DASHICON_MAP ) {
		if ( entry.test.test( mime ) ) {
			return entry.icon;
		}
	}
	return MIME_DASHICON_FALLBACK;
}

function mimeGroup( mime: string ): 'image' | 'video' | 'audio' | 'doc' {
	if ( mime.startsWith( 'image/' ) ) {
		return 'image';
	}
	if ( mime.startsWith( 'video/' ) ) {
		return 'video';
	}
	if ( mime.startsWith( 'audio/' ) ) {
		return 'audio';
	}
	return 'doc';
}

function formatBytes( bytes: number | undefined ): string {
	if ( ! bytes || ! Number.isFinite( bytes ) ) {
		return '';
	}
	if ( bytes < 1024 ) {
		return `${ bytes } B`;
	}
	const units = [ 'KB', 'MB', 'GB', 'TB' ];
	let value = bytes / 1024;
	let unit = 0;
	while ( value >= 1024 && unit < units.length - 1 ) {
		value /= 1024;
		unit += 1;
	}
	return `${ value.toFixed( value >= 10 ? 0 : 1 ) } ${ units[ unit ] }`;
}

function formatDate( iso: string | undefined ): string {
	if ( ! iso ) {
		return '';
	}
	const d = new Date( iso );
	if ( Number.isNaN( d.valueOf() ) ) {
		return iso;
	}
	return d.toLocaleDateString( undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	} );
}

function buildMediaVisual( media: MediaListItem ): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'desktop-mode-my-wordpress__media-visual';
	const group = mimeGroup( media.mime_type );

	if ( group === 'image' ) {
		const img = document.createElement( 'img' );
		const sizes = media.media_details?.sizes;
		img.src =
			sizes?.large?.source_url ??
			sizes?.medium_large?.source_url ??
			sizes?.medium?.source_url ??
			media.source_url;
		img.alt = media.alt_text ?? stripTags( media.title.rendered );
		img.loading = 'lazy';
		img.decoding = 'async';
		img.className = 'desktop-mode-my-wordpress__media-image';
		wrap.appendChild( img );
		return wrap;
	}

	if ( group === 'video' ) {
		const video = document.createElement( 'video' );
		video.controls = true;
		video.preload = 'metadata';
		video.src = media.source_url;
		const sizes = media.media_details?.sizes;
		const poster =
			sizes?.large?.source_url ?? sizes?.medium?.source_url ?? '';
		if ( poster ) {
			video.poster = poster;
		}
		video.className = 'desktop-mode-my-wordpress__media-video';
		wrap.appendChild( video );
		return wrap;
	}

	if ( group === 'audio' ) {
		const stack = document.createElement( 'div' );
		stack.className = 'desktop-mode-my-wordpress__media-audio-stack';
		const icon = document.createElement( 'span' );
		icon.className =
			'desktop-mode-my-wordpress__media-fallback-icon dashicons ' +
			dashiconForMime( media.mime_type );
		icon.setAttribute( 'aria-hidden', 'true' );
		stack.appendChild( icon );
		const audio = document.createElement( 'audio' );
		audio.controls = true;
		audio.preload = 'metadata';
		audio.src = media.source_url;
		audio.className = 'desktop-mode-my-wordpress__media-audio';
		stack.appendChild( audio );
		wrap.appendChild( stack );
		return wrap;
	}

	// Documents — big dashicon and a "View file" link.
	const icon = document.createElement( 'span' );
	icon.className =
		'desktop-mode-my-wordpress__media-fallback-icon dashicons ' +
		dashiconForMime( media.mime_type );
	icon.setAttribute( 'aria-hidden', 'true' );
	wrap.appendChild( icon );
	const link = document.createElement( 'a' );
	link.href = media.source_url;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.className = 'desktop-mode-my-wordpress__media-doc-link';
	link.textContent = __( 'Open file', 'desktop-mode' );
	wrap.appendChild( link );
	return wrap;
}

/**
 * Build a single `<dt>` + `<dd>` pair for the metadata grid. The
 * outer `<dl>` keeps the semantic list intact for screen readers
 * that support definition-list navigation; CSS Grid handles the
 * two-column layout via `display: contents` on the wrapper.
 */
function buildMetaRow(
	label: string,
	value: string | HTMLElement,
): Array< HTMLElement > | null {
	if ( typeof value === 'string' && value.trim() === '' ) {
		return null;
	}
	const dt = document.createElement( 'dt' );
	dt.className = 'desktop-mode-my-wordpress__media-meta-term';
	dt.textContent = label;
	const dd = document.createElement( 'dd' );
	dd.className = 'desktop-mode-my-wordpress__media-meta-value';
	if ( typeof value === 'string' ) {
		dd.textContent = value;
	} else {
		dd.appendChild( value );
	}
	return [ dt, dd ];
}

function buildMetadataGrid( media: MediaListItem ): HTMLElement {
	const grid = document.createElement( 'dl' );
	grid.className = 'desktop-mode-my-wordpress__media-meta';

	const filename = media.media_details?.file
		? media.media_details.file.split( '/' ).pop() ?? ''
		: media.source_url.split( '/' ).pop() ?? '';
	const dims = media.media_details?.width && media.media_details?.height
		? `${ media.media_details.width } × ${ media.media_details.height }`
		: '';
	const filesize = formatBytes( media.media_details?.filesize );
	const uploaded = formatDate( media.date );
	const uploader = media._embedded?.author?.[ 0 ]?.name ?? '';
	const alt = ( media.alt_text ?? '' ).trim();
	const caption = stripTags( media.caption?.rendered ?? '' );
	const description = stripTags( media.description?.rendered ?? '' );

	const rows: Array< Array< HTMLElement > | null > = [
		buildMetaRow( __( 'Filename', 'desktop-mode' ), filename ),
		buildMetaRow( __( 'Type', 'desktop-mode' ), media.mime_type ),
		buildMetaRow( __( 'Dimensions', 'desktop-mode' ), dims ),
		buildMetaRow( __( 'File size', 'desktop-mode' ), filesize ),
		buildMetaRow( __( 'Uploaded', 'desktop-mode' ), uploaded ),
		buildMetaRow( __( 'Uploader', 'desktop-mode' ), uploader ),
		buildMetaRow( __( 'Alt text', 'desktop-mode' ), alt ),
		buildMetaRow( __( 'Caption', 'desktop-mode' ), caption ),
		buildMetaRow( __( 'Description', 'desktop-mode' ), description ),
	];

	for ( const pair of rows ) {
		if ( pair ) {
			grid.append( ...pair );
		}
	}
	return grid;
}

/**
 * Run the `desktop-mode.my-wordpress.preview-extras` action,
 * passing each registered subscriber a host element for the named
 * slot so they can append arbitrary DOM.
 *
 * @since 0.8.6
 */
function fireSlot(
	host: HTMLElement,
	slot: MediaPreviewSlot,
	entityId: string,
	kind: string,
	item: Record< string, unknown >,
): void {
	doAction(
		'desktop-mode.my-wordpress.preview-extras',
		{
			slot,
			container: host,
			entityId,
			kind,
			item,
		},
	);
}

/**
 * Resolve which action descriptors apply to the given context and
 * call the JS-filter so plugins can attach handlers / hide entries.
 *
 * @since 0.8.6
 */
export function resolvePreviewActions(
	descriptors: MediaPreviewAction[],
	ctx: MediaPreviewActionContext,
): MediaPreviewAction[] {
	const scoped = descriptors.filter( ( a ) => {
		if ( a.sections && a.sections.length > 0 ) {
			if ( ! a.sections.includes( ctx.entityId ) && ! a.sections.includes( '*' ) ) {
				return false;
			}
		}
		if ( a.mime ) {
			// MIME-scoped descriptor: fail closed on the
			// non-media-context call site so a `^image/` action
			// doesn't leak into a Posts preview pane.
			if ( ! ctx.mime ) {
				return false;
			}
			try {
				const re = new RegExp( a.mime );
				if ( ! re.test( ctx.mime ) ) {
					return false;
				}
			} catch {
				// Malformed regex from PHP — skip the action.
				return false;
			}
		}
		return true;
	} );
	const merged = applyFilters<
		MediaPreviewAction[],
		[ MediaPreviewActionContext ]
	>( 'desktop-mode.my-wordpress.preview-actions', scoped, ctx );
	return Array.isArray( merged ) ? merged : scoped;
}

function buildActionRow(
	actions: MediaPreviewAction[],
	ctx: MediaPreviewActionContext,
): HTMLElement | null {
	const visible = actions.filter( ( a ) =>
		typeof a.isVisible === 'function' ? a.isVisible( ctx ) : true,
	);
	if ( visible.length === 0 ) {
		return null;
	}
	const row = document.createElement( 'div' );
	row.className = 'desktop-mode-my-wordpress__media-actions';
	row.setAttribute( 'role', 'toolbar' );
	for ( const action of visible ) {
		const btn = document.createElement( 'wpd-button' );
		btn.setAttribute( 'variant', 'secondary' );
		btn.dataset.actionId = action.id;
		if ( action.icon ) {
			btn.setAttribute( 'icon', action.icon );
		}
		btn.textContent = action.label;
		btn.addEventListener( 'click', () => {
			if ( typeof action.onSelect === 'function' ) {
				try {
					void action.onSelect( ctx );
				} catch {
					// Handler is plugin code — log via console only.
					// eslint-disable-next-line no-console
					console.error(
						`[my-wordpress] preview action ${ action.id } threw.`,
					);
				}
			}
		} );
		row.appendChild( btn );
	}
	return row;
}

/**
 * Paint the right-pane preview for a media item. Replaces any
 * existing content under `host`.
 *
 * @public
 * @since 0.8.6
 */
export function renderMediaPreview(
	host: HTMLElement,
	media: MediaListItem,
	opts: {
		entityId: string;
		previewActions: MediaPreviewAction[];
		onOpenDetail?: () => void;
	},
): void {
	host.replaceChildren();
	const pane = document.createElement( 'div' );
	pane.className = 'desktop-mode-my-wordpress__media-pane';

	const header = document.createElement( 'header' );
	header.className = 'desktop-mode-my-wordpress__media-header';
	const heading = document.createElement( 'h2' );
	heading.className = 'desktop-mode-my-wordpress__media-title';
	heading.textContent =
		stripTags( media.title.rendered ) || __( '(no title)', 'desktop-mode' );
	header.appendChild( heading );
	pane.appendChild( header );

	const item = media as unknown as Record< string, unknown >;
	const ctx: MediaPreviewActionContext = {
		entityId: opts.entityId,
		kind: 'media',
		mime: media.mime_type,
		item,
	};

	fireSlot( header, 'header', opts.entityId, 'media', item );

	pane.appendChild( buildMediaVisual( media ) );

	const meta = buildMetadataGrid( media );
	pane.appendChild( meta );
	fireSlot( meta, 'meta', opts.entityId, 'media', item );

	const resolved = resolvePreviewActions( opts.previewActions, ctx );
	const actionRow = buildActionRow( resolved, ctx );
	if ( actionRow ) {
		pane.appendChild( actionRow );
	}

	if ( opts.onOpenDetail ) {
		const footer = document.createElement( 'footer' );
		footer.className = 'desktop-mode-my-wordpress__article-footer';
		const drillBtn = document.createElement( 'wpd-button' );
		drillBtn.setAttribute( 'variant', 'primary' );
		drillBtn.textContent = __( 'See where this is used', 'desktop-mode' );
		drillBtn.title = __(
			'Show the posts, pages, and custom-post-type entries that reference this file.',
			'desktop-mode',
		);
		drillBtn.addEventListener( 'click', () => opts.onOpenDetail?.() );
		footer.appendChild( drillBtn );
		pane.appendChild( footer );
		fireSlot( footer, 'footer', opts.entityId, 'media', item );
	} else {
		const footer = document.createElement( 'div' );
		footer.className = 'desktop-mode-my-wordpress__media-footer';
		pane.appendChild( footer );
		fireSlot( footer, 'footer', opts.entityId, 'media', item );
	}

	host.appendChild( pane );
}
