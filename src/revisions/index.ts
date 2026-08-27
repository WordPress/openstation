/**
 * OpenStation — "View revisions" in the window ⋯ menu.
 *
 * Core's revision browser is a whole admin screen, and the block
 * editor can only reach it by navigating the editor away from itself
 * — which is why Gutenberg grew an inline revision viewer, and why
 * that viewer inherits the editor's constraints. On a desktop the
 * answer is the ordinary one: it is another window.
 *
 * So every post / page / CPT editor window whose content has revisions
 * — Gutenberg **and** classic, any post type whose registration
 * supports `revisions` — grows a "View revisions (N)" row in its ⋯
 * menu. Picking it opens `revision.php` as its own desktop window,
 * placed clear of the editor and **tied to it by a window link**: the
 * revision browser announces itself as a child of the post it belongs
 * to (`openstation_build_content_identity()`'s `revision.php` branch),
 * so the desktop draws a spline between the two and keeps them
 * together when either is focused.
 *
 * The row is registered through the very same public surface a plugin
 * would use (`registerWindowAction`), and its visibility follows the
 * identity's `revisionsUrl` — built server-side by
 * `openstation_window_revisions()` in `includes/window-links.php` and
 * travelling with the `os-content-identity` bridge payload. A draft
 * with no revisions yet simply has no row; the block editor's
 * save-watcher refetches the identity after the first save, so the row
 * appears the moment there is something to browse, with no reload.
 *
 * Developer surface: the `openstation_window_revisions` PHP filter
 * rewrites or suppresses the URL and count;
 * `HOOKS.REVISIONS_WINDOW_CONFIG` filters the window's `WindowConfig`
 * before it opens; `HOOKS.REVISIONS_OPENED` (and the matching
 * `os-revisions-opened` CustomEvent) reports that it did.
 */

import { applyFilters, doAction, HOOKS } from '../hooks';
import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import { registerWindowAction } from '../window-actions/registry';
import { getWindowContent } from '../window-links/engine';
import { loadNativeWindowGeometry } from '../window-manager/native-window-geometry';
import { revisionWindowPlacement } from './placement';

import type { WindowConfig } from '../types';
import type { WindowContentRef } from '../window-links/types';

/**
 * The slice of a `Window` instance this module touches — structural so
 * the main-bundle boot never imports the lazy window-system bundle's
 * classes.
 */
interface RevisionsWindowLike {
	id: string;
	element?: HTMLElement | null;
}

/** The subset of the window manager the module needs. */
interface RevisionsManager {
	getById: ( id: string ) => RevisionsWindowLike | null | undefined;
	open: (
		config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		},
	) => Promise< unknown >;
}

/** Window config for the revision browser, with the required keys pinned. */
type RevisionsWindowConfig = Partial< WindowConfig > & {
	id: string;
	url: string;
	title: string;
};

/**
 * Window id for a post's revision browser. One window per post —
 * reopening from the same editor focuses it rather than stacking a
 * second copy, and the id is stable across sessions so a remembered
 * size and position come back with it.
 *
 * Slashes are legal in a content `type` (`vendor/sub-type`) and not in
 * a window id, so they collapse to hyphens exactly as the
 * editor-preview companion's id does.
 *
 * @param content The editor window's content identity.
 * @return Window id.
 */
export function revisionsWindowId( content: WindowContentRef ): string {
	return `revisions-${ String( content.type ).replace( /\//g, '-' ) }-${
		content.id
	}`;
}

/**
 * Menu-row label: the count when the server sent one, the bare verb
 * otherwise. Re-read on every menu open, so a post that gains
 * revisions while its window stays open counts up.
 *
 * @param content The editor window's content identity, if any.
 * @return Translated label.
 */
export function revisionsLabel(
	content: WindowContentRef | null | undefined,
): string {
	const count = content?.revisionCount;
	if ( typeof count === 'number' && count > 0 ) {
		return sprintf(
			/* translators: %d: number of revisions. */
			__( 'View revisions (%d)' ),
			count,
		);
	}
	return __( 'View revisions' );
}

/**
 * Opening geometry for the revision window, or `{}` to let the window
 * manager decide.
 *
 * The manager's own resolution — remembered per-baseId geometry first,
 * then a cascade slot — is right in every case except the first open,
 * which is the one that has to look deliberate. So: compute a
 * placement only when there is nothing remembered for this window and
 * the editor is actually measurable, and stay out of the way
 * otherwise. Below the desktop breakpoint windows auto-maximize and
 * there is no arrangement to make.
 *
 * @param manager  Window manager.
 * @param editorId The editor window's id.
 * @param windowId The revision window's id (also its baseId).
 * @return Partial geometry, possibly empty.
 */
function openingGeometry(
	manager: RevisionsManager,
	editorId: string,
	windowId: string,
): Partial< Pick< WindowConfig, 'x' | 'y' | 'width' | 'height' > > {
	if ( loadNativeWindowGeometry( windowId ) ) {
		return {};
	}
	if (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(max-width: 767px)' ).matches
	) {
		return {};
	}
	const editorEl = manager.getById( editorId )?.element;
	const area = document.getElementById( 'os-area' );
	// `offsetLeft` / `offsetTop` are already desktop-area coordinates —
	// the windows and the link layer share `#os-area` as offset parent,
	// which is the same measurement the link renderer draws from.
	if (
		! editorEl ||
		! area ||
		editorEl.offsetParent === null ||
		editorEl.offsetWidth === 0
	) {
		return {};
	}
	return revisionWindowPlacement(
		{
			x: editorEl.offsetLeft,
			y: editorEl.offsetTop,
			width: editorEl.offsetWidth,
			height: editorEl.offsetHeight,
		},
		{ width: area.clientWidth, height: area.clientHeight },
	);
}

/**
 * Open (or focus) the revision browser for an editor window.
 *
 * The window is seeded with the same content identity the
 * `revision.php` bridge will announce a moment later — `revisions`,
 * keyed by the post, rooted at it — so the spline to the editor draws
 * immediately instead of waiting on the iframe load. The server's
 * announcement then overwrites the seed with the authoritative one.
 *
 * @param manager Window manager.
 * @param win     The editor window the row was picked in.
 */
export async function openRevisionsWindow(
	manager: RevisionsManager,
	win: RevisionsWindowLike,
): Promise< void > {
	const content = getWindowContent( win.id );
	if ( ! content?.revisionsUrl ) {
		// The identity changed between the menu opening and the pick
		// (an in-window navigation, a revisions-disabling filter).
		showToast( {
			message: __( 'No revisions are available for this content.' ),
		} );
		return;
	}

	const windowId = revisionsWindowId( content );
	let title = __( 'Revisions' );
	if ( content.label ) {
		title = sprintf(
			/* translators: %s: post title. */
			__( 'Revisions: %s' ),
			content.label,
		);
	}

	let config: RevisionsWindowConfig = {
		id: windowId,
		baseId: windowId, // Singleton per post — reopening focuses.
		url: content.revisionsUrl,
		title,
		icon: 'dashicons-backup',
		content: {
			type: 'revisions',
			id: content.id,
			root: { type: content.type, id: content.id },
			label: title,
		},
		...openingGeometry( manager, win.id, windowId ),
	};

	const filtered = applyFilters< RevisionsWindowConfig >(
		HOOKS.REVISIONS_WINDOW_CONFIG,
		config,
		{ editorWindowId: win.id, content },
	);
	if (
		filtered &&
		typeof filtered === 'object' &&
		typeof filtered.id === 'string' &&
		filtered.id !== '' &&
		typeof filtered.url === 'string' &&
		filtered.url !== ''
	) {
		config = filtered;
	} else if ( typeof console !== 'undefined' ) {
		// eslint-disable-next-line no-console
		console.warn(
			'[openstation] `os.revisions.window-config` filter ' +
				'returned an invalid config; using the default.',
		);
	}

	await manager.open( config );

	const detail = {
		editorWindowId: win.id,
		revisionsWindowId: config.id,
		content,
	};
	document.dispatchEvent(
		new CustomEvent( 'os-revisions-opened', { detail } ),
	);
	doAction( HOOKS.REVISIONS_OPENED, detail );
}

/**
 * Register the built-in "View revisions" ⋯ menu row. Called once from
 * the `desktop.ts` boot after the window manager exists.
 *
 * No repaint subscription here, unlike the Related button and the
 * Preview eye: the ⋯ menu repaints its plugin rows on every open (and,
 * while open, on every registry change), so `isVisible` and `label`
 * are re-read at exactly the moment they are read by a user.
 *
 * @param opts         Options bag.
 * @param opts.manager Window manager (structural subset).
 */
export function bootRevisions( {
	manager,
}: {
	manager: RevisionsManager;
} ): void {
	registerWindowAction( {
		id: 'desktop-mode/view-revisions',
		label: ( win ) => revisionsLabel( getWindowContent( win.id ) ),
		icon: 'dashicons-backup',
		// After the built-in iframe verbs (reload, open in browser tab),
		// before third-party rows, which default to 100.
		order: 60,
		isVisible: ( win ) => !! getWindowContent( win.id )?.revisionsUrl,
		onSelect: ( win ) => {
			void openRevisionsWindow( manager, win );
		},
	} );
}
