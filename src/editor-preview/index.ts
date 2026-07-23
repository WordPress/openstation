/**
 * Desktop Mode — editor-preview ("eye") title-bar button.
 *
 * Registers the built-in "Preview" button through the very same
 * public surface a plugin would use (`registerTitleBarButton`). The
 * button appears only on windows whose content identity carries a
 * `previewUrl` — built server-side by
 * `desktop_mode_window_preview_url()` in `includes/window-links.php`
 * for post/page/CPT edit screens of viewable post types, and
 * travelling with the `desktop-mode-content-identity` bridge payload.
 *
 * Clicking the eye:
 *  1. Snaps the editor window to the left half (instant feedback;
 *     skipped on small screens).
 *  2. Asks the editor iframe to autosave (`requestEditorAutosave`),
 *     so the preview reflects on-screen content — the same thing
 *     Gutenberg's own Preview button does.
 *  3. Opens the front-end preview as a companion window snapped to
 *     the right half, and records the editor↔preview pairing.
 *
 * The pairing drives everything after that: the preview auto-reloads
 * whenever the post is saved (via the `desktop-mode.<type>.changed`
 * broadcast every save path already emits), closes when the editor
 * closes or navigates to different content, and toggles off on a
 * second eye click. Closing the preview never touches the editor.
 * After the initial placement the module never re-snaps either window
 * — the user is free to rearrange, the pairing survives.
 *
 * Developer surface: the `desktop_mode_window_preview_url` PHP filter
 * rewrites/suppresses the URL; `HOOKS.EDITOR_PREVIEW_WINDOW_CONFIG`
 * filters the companion's `WindowConfig`;
 * `HOOKS.EDITOR_PREVIEW_OPENED` / `EDITOR_PREVIEW_CLOSED` (and the
 * matching document CustomEvents) report pairing lifecycle.
 *
 * @since 0.9.8
 */

import { subscribe } from '../broadcast';
import { addAction, applyFilters, doAction, HOOKS } from '../hooks';
import { __, sprintf } from '../i18n';
import { createSharedStore } from '../shared-store';
import { showToast } from '../toast';
import { registerTitleBarButton } from '../title-bar-buttons/registry';
import { getWindowContent } from '../window-links/engine';
import type { WindowContentRef } from '../window-links/types';
import type { WindowConfig } from '../types';
import {
	requestEditorAutosave,
	sameOriginUrl,
	type AutosaveResult,
} from './autosave';

/**
 * The slice of a `Window` instance this module touches — structural
 * so the main-bundle boot never imports the lazy window-system
 * bundle's classes.
 */
interface EditorPreviewWindowLike {
	id: string;
	config: { native?: boolean; ephemeral?: boolean };
	iframe?: HTMLIFrameElement | null;
	getCurrentUrl?: () => string;
	applySnap?: ( zone: 'left' | 'right' ) => void;
	renderCustomTitleBarButtons?: () => void;
	reload?: () => void;
	swapReload?: ( url?: string ) => void;
	navigateTo?: ( url: string ) => boolean;
	destroy?: () => void;
	close?: () => void;
}

/** The subset of the window manager the module needs. */
interface EditorPreviewManager {
	getById: ( id: string ) => EditorPreviewWindowLike | null | undefined;
	open: (
		config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		},
	) => Promise< unknown >;
}

/** One live editor↔preview pairing. */
interface PreviewPairing {
	editorWindowId: string;
	previewWindowId: string;
	/** `'<type>:<id>'` of the content the pairing belongs to. */
	postKey: string;
	/** The previewUrl the companion currently shows. */
	openUrl: string;
	/** Broadcast unsubscription for the save-driven reload. */
	unsubscribe: () => void;
	/** Debounce handle for the save-driven reload. */
	reloadTimer: number | null;
	/**
	 * Correlation id of the iframe-side live watch (typing →
	 * debounced autosave → `desktop-mode-editor-live-saved`).
	 * Empty when live updates are disabled via the
	 * `desktop-mode.editor-preview.live` filter.
	 */
	watchId: string;
}

interface EditorPreviewState {
	/** Pairings keyed by EDITOR window id. */
	pairings: Map< string, PreviewPairing >;
	/** Editor windows with an autosave round-trip in flight. */
	busyEditors: Set< string >;
}

const store = createSharedStore< EditorPreviewState >(
	'desktop-mode/editor-preview',
	() => ( {
		pairings: new Map(),
		busyEditors: new Set(),
	} ),
);

/** Debounce for save-driven preview reloads, in milliseconds. */
const RELOAD_DEBOUNCE_MS = 400;

/**
 * Default settle window for live (typing-driven) preview updates —
 * how long after the last edit the editor iframe waits before
 * autosaving and nudging the preview to reload. Filterable via
 * `desktop-mode.editor-preview.live`.
 */
const LIVE_DEBOUNCE_DEFAULT_MS = 1500;

/** Stable content key, mirroring the relations engine's `'post:123'`. */
function contentKey( content: WindowContentRef | null | undefined ): string {
	return content ? `${ content.type }:${ content.id }` : '';
}

/** Pairing whose PREVIEW window has the given id, if any. */
function pairingForPreview( windowId: string ): PreviewPairing | undefined {
	for ( const pairing of store.state.pairings.values() ) {
		if ( pairing.previewWindowId === windowId ) {
			return pairing;
		}
	}
	return undefined;
}

/**
 * Windows auto-maximize below the desktop breakpoint — snapping two
 * halves side by side has nothing to attach to there.
 */
function isSmallScreen(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(max-width: 767px)' ).matches
	);
}

/**
 * True while the window shows the "Add New" editor screen
 * (`post-new.php`). An unsaved auto-draft has no identity (and no
 * preview) yet — the eye renders DISABLED there instead of hiding, so
 * the affordance is discoverable before the first save. The moment
 * the post is saved, the save-watcher's identity refetch delivers a
 * `previewUrl` and the repaint enables the button.
 */
function isUnsavedEditorScreen( win: EditorPreviewWindowLike ): boolean {
	const url = win.getCurrentUrl?.() ?? '';
	if ( ! url ) {
		return false;
	}
	try {
		return new URL( url, window.location.origin ).pathname.endsWith(
			'/post-new.php',
		);
	} catch {
		return false;
	}
}

/**
 * End a pairing: unhook the save subscription, drop the record, fire
 * the closed hook/CustomEvent, and repaint the editor's title-bar
 * buttons so the eye un-presses. Optionally closes the companion —
 * `destroy` (editor closed: skip the pointless unsaved-changes query,
 * a front-end page has none) or `close` (eye toggled off / editor
 * navigated away: normal close animation).
 */
function teardownPairing(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
	reason: 'toggled' | 'editor-closed' | 'preview-closed' | 'content-changed',
	closePreview: 'destroy' | 'close' | 'none',
): void {
	// Delete BEFORE closing the companion — its WINDOW_CLOSED will
	// re-enter our handler, and a stale record would double-fire the
	// closed hook with reason 'preview-closed'.
	store.state.pairings.delete( pairing.editorWindowId );
	if ( pairing.reloadTimer !== null ) {
		window.clearTimeout( pairing.reloadTimer );
		pairing.reloadTimer = null;
	}
	try {
		pairing.unsubscribe();
	} catch {
		/* already unsubscribed */
	}

	// Stop the iframe-side live watch. Best-effort: when the editor
	// window itself is closing (or already navigated away) the watch
	// dies with the page anyway.
	if ( pairing.watchId ) {
		const editorWin = manager.getById( pairing.editorWindowId );
		try {
			editorWin?.iframe?.contentWindow?.postMessage(
				{
					type: 'desktop-mode-editor-live-unwatch',
					watchId: pairing.watchId,
				},
				window.location.origin,
			);
		} catch {
			/* frame gone */
		}
	}

	if ( closePreview !== 'none' ) {
		const previewWin = manager.getById( pairing.previewWindowId );
		if ( previewWin ) {
			if ( closePreview === 'destroy' ) {
				previewWin.destroy?.();
			} else {
				previewWin.close?.();
			}
		}
	}

	const detail = {
		editorWindowId: pairing.editorWindowId,
		previewWindowId: pairing.previewWindowId,
		reason,
	};
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-editor-preview-closed', { detail } ),
	);
	doAction( HOOKS.EDITOR_PREVIEW_CLOSED, detail );

	manager
		.getById( pairing.editorWindowId )
		?.renderCustomTitleBarButtons?.();
}

/**
 * Debounced refresh of the companion. Coalesces bursts (a save
 * broadcast landing next to a live-saved nudge), then refreshes —
 * preferring the double-buffered `swapReload()` (no loading overlay,
 * no blank frame, scroll preserved; passing the fresher previewUrl
 * when one is known, e.g. a draft→publish permalink change), with
 * `navigateTo()`/`reload()` as the classic fallback.
 */
function scheduleReload(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
	freshUrl?: string,
): void {
	if ( pairing.reloadTimer !== null ) {
		window.clearTimeout( pairing.reloadTimer );
	}
	pairing.reloadTimer = window.setTimeout( () => {
		pairing.reloadTimer = null;
		const previewWin = manager.getById( pairing.previewWindowId );
		if ( ! previewWin ) {
			return;
		}
		const latestUrl =
			freshUrl ||
			getWindowContent( pairing.editorWindowId )?.previewUrl;
		const target =
			latestUrl && latestUrl !== pairing.openUrl
				? latestUrl
				: undefined;
		if ( typeof previewWin.swapReload === 'function' ) {
			if ( target ) {
				pairing.openUrl = target;
			}
			previewWin.swapReload( target );
		} else if ( target && previewWin.navigateTo ) {
			pairing.openUrl = target;
			previewWin.navigateTo( target );
		} else {
			previewWin.reload?.();
		}
	}, RELOAD_DEBOUNCE_MS );
}

/**
 * Wire the save-driven reload for a fresh pairing: subscribe to the
 * content-change topic every save path emits
 * (`desktop-mode.<type>.changed` — Gutenberg save-watcher, classic
 * footer emitter, Heartbeat catch-up) and soft-reload the companion,
 * debounced.
 */
function wireSaveReload(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
	content: WindowContentRef,
): void {
	const topic = `desktop-mode.${ content.type }.changed`;
	const postId = String( content.id );

	pairing.unsubscribe = subscribe< { ids?: unknown } >(
		topic,
		( payload ) => {
			const ids = payload?.ids;
			if (
				! Array.isArray( ids ) ||
				! ids.some( ( id ) => String( id ) === postId )
			) {
				return;
			}
			scheduleReload( manager, pairing );
		},
	);
}

/** Monotonic suffix so re-opened pairings never reuse a watch id. */
let watchCounter = 0;

/**
 * Ask the editor iframe to watch its own content and autosave after
 * every typing pause (`desktop-mode-editor-live-watch`) — the live
 * half of the preview. The `desktop-mode.editor-preview.live` filter
 * can disable it or tune the settle window; without a reachable
 * iframe (or with `enabled: false`) the pairing falls back to
 * save-driven reloads only.
 */
function startLiveWatch(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
	content: WindowContentRef,
): void {
	const live = applyFilters< {
		enabled?: boolean;
		debounceMs?: number;
	} | null >(
		HOOKS.EDITOR_PREVIEW_LIVE,
		{ enabled: true, debounceMs: LIVE_DEBOUNCE_DEFAULT_MS },
		{ editorWindowId: pairing.editorWindowId, content },
	);
	if ( ! live || live.enabled === false ) {
		return;
	}

	const target = manager.getById( pairing.editorWindowId )?.iframe
		?.contentWindow;
	if ( ! target ) {
		return;
	}

	watchCounter += 1;
	const watchId = `${ pairing.previewWindowId }-watch-${ watchCounter }`;
	try {
		target.postMessage(
			{
				type: 'desktop-mode-editor-live-watch',
				watchId,
				debounceMs:
					typeof live.debounceMs === 'number'
						? live.debounceMs
						: LIVE_DEBOUNCE_DEFAULT_MS,
			},
			window.location.origin,
		);
		pairing.watchId = watchId;
	} catch {
		/* frame gone — save-driven reloads still work */
	}
}

/**
 * Indirection over `requestEditorAutosave` so tests can stub the
 * bridge round-trip without faking iframes and postMessage plumbing.
 *
 * @internal
 */
let requestAutosave: (
	win: EditorPreviewWindowLike,
) => Promise< AutosaveResult > = requestEditorAutosave;

/**
 * Test-only override of the autosave transport. Pass `null` to
 * restore the real bridge round-trip.
 *
 * @internal
 */
export function _setAutosaveTransportForTests(
	fn: typeof requestAutosave | null,
): void {
	requestAutosave = fn ?? requestEditorAutosave;
}

/**
 * The eye click: toggle off when paired, otherwise snap-left +
 * autosave + open the companion snapped right.
 */
async function onEyeClick(
	manager: EditorPreviewManager,
	win: EditorPreviewWindowLike,
): Promise< void > {
	const existing = store.state.pairings.get( win.id );
	if ( existing ) {
		teardownPairing( manager, existing, 'toggled', 'close' );
		return;
	}

	if ( store.state.busyEditors.has( win.id ) ) {
		// Autosave round-trip already in flight — ignore the re-click.
		return;
	}

	const content = getWindowContent( win.id );
	if ( ! content?.previewUrl ) {
		showToast( {
			message: __( 'No preview is available for this content.' ),
		} );
		return;
	}

	store.state.busyEditors.add( win.id );
	win.renderCustomTitleBarButtons?.();

	const small = isSmallScreen();
	if ( ! small ) {
		win.applySnap?.( 'left' );
	}

	try {
		const result = await requestAutosave( win );
		if ( result.status === 'error' ) {
			showToast( {
				message: __(
					"Couldn't save your latest changes — the preview shows the last saved version.",
				),
			} );
		}

		// The window may have closed (or navigated away) while the
		// autosave was in flight.
		if ( ! manager.getById( win.id ) ) {
			return;
		}
		const latest = getWindowContent( win.id ) ?? content;
		if ( contentKey( latest ) !== contentKey( content ) ) {
			return;
		}

		const url =
			( result.status === 'saved' && result.previewUrl ) ||
			latest.previewUrl ||
			content.previewUrl;
		if ( ! url ) {
			return;
		}

		const previewId = `editor-preview-${ String( content.type ).replace(
			/\//g,
			'-',
		) }-${ content.id }`;
		let title = __( 'Preview' );
		if ( latest.label ) {
			/* translators: %s: post title. */
			title = sprintf( __( 'Preview: %s' ), latest.label );
		}

		let config: Partial< WindowConfig > & {
			id: string;
			url: string;
			title: string;
		} = {
			id: previewId,
			baseId: previewId, // Singleton per post — reopen focuses.
			url,
			title,
			icon: 'dashicons-visibility',
			ephemeral: true,
			...( small ? {} : { initialState: 'snapped-right' as const } ),
		};
		const filtered = applyFilters< typeof config >(
			HOOKS.EDITOR_PREVIEW_WINDOW_CONFIG,
			config,
			{ editorWindowId: win.id, content: latest },
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
			console.warn(
				'[desktop-mode] `desktop-mode.editor-preview.window-config` ' +
					'filter returned an invalid config; using the default.',
			);
		}

		await manager.open( config );

		// The editor may have closed — or navigated to different
		// content — while the companion was OPENING: no pairing
		// existed yet, so the lifecycle handlers couldn't clean up.
		// Don't strand an orphaned companion.
		if (
			! manager.getById( win.id ) ||
			contentKey( getWindowContent( win.id ) ) !== contentKey( latest )
		) {
			manager.getById( config.id )?.destroy?.();
			return;
		}

		const pairing: PreviewPairing = {
			editorWindowId: win.id,
			previewWindowId: config.id,
			postKey: contentKey( latest ),
			openUrl: config.url,
			unsubscribe: () => undefined,
			reloadTimer: null,
			watchId: '',
		};
		wireSaveReload( manager, pairing, latest );
		startLiveWatch( manager, pairing, latest );
		store.state.pairings.set( win.id, pairing );

		const detail = {
			editorWindowId: win.id,
			previewWindowId: config.id,
			content: latest,
		};
		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-editor-preview-opened', {
				detail,
			} ),
		);
		doAction( HOOKS.EDITOR_PREVIEW_OPENED, detail );
	} finally {
		store.state.busyEditors.delete( win.id );
		manager.getById( win.id )?.renderCustomTitleBarButtons?.();
	}
}

/**
 * Register the built-in "Preview" (eye) title-bar button and wire the
 * pairing lifecycle. Called once from the `desktop.ts` boot after the
 * window manager exists.
 *
 * The repaint hook is load-bearing for the same reason as the Related
 * button's: identities arrive asynchronously (the chromeless bridge
 * announces them after the iframe loads and on every in-window
 * navigation), so without the targeted repaint the eye would never
 * appear on a freshly opened editor window.
 *
 * @param opts         Options bag.
 * @param opts.manager Window manager (structural subset).
 */
export function bootEditorPreview( {
	manager,
}: {
	manager: EditorPreviewManager;
} ): void {
	registerTitleBarButton( {
		id: 'desktop-mode/editor-preview',
		label: __( 'Preview' ),
		icon: 'dashicons-visibility',
		placement: 'right',
		order: 55, // Just before Related (60).
		match: ( win ) =>
			! win.config.native &&
			( !! getWindowContent( win.id )?.previewUrl ||
				isUnsavedEditorScreen( win ) ),
		render: ( host, win ) => {
			// "Add New" screen before the first save: the eye is
			// visible but disabled — the affordance stays
			// discoverable, and the identity refetch after the first
			// save repaints it enabled.
			if ( ! getWindowContent( win.id )?.previewUrl ) {
				const hint = __( 'Save the post to enable its preview' );
				host.setAttribute( 'aria-disabled', 'true' );
				host.setAttribute( 'aria-label', hint );
				host.setAttribute( 'title', hint );
				host.classList.add( 'desktop-mode-window__btn--disabled' );
				host.addEventListener( 'click', ( e: Event ) => {
					e.stopPropagation();
					showToast( {
						message: __(
							'The preview opens once the post has been saved.',
						),
					} );
				} );
				return;
			}

			const paired = store.state.pairings.has( win.id );
			const busy = store.state.busyEditors.has( win.id );
			host.setAttribute( 'aria-pressed', String( paired ) );
			if ( busy ) {
				host.setAttribute( 'aria-busy', 'true' );
				host.classList.add( 'desktop-mode-window__btn--busy' );
			}
			host.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				void onEyeClick( manager, win );
			} );
		},
	} );

	// Content changed inside a paired editor window: same post → keep
	// the pairing (the save-driven reload handles refreshes); a
	// different post (or no identity — user navigated to a list
	// table) → the preview no longer matches what's on screen, close
	// it. Always repaint so the eye appears/disappears with
	// `previewUrl`.
	addAction(
		HOOKS.WINDOW_CONTENT_CHANGED,
		'desktop-mode/editor-preview',
		( e: { windowId?: string; content?: WindowContentRef | null } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			const pairing = store.state.pairings.get( e.windowId );
			if ( pairing && contentKey( e.content ) !== pairing.postKey ) {
				teardownPairing( manager, pairing, 'content-changed', 'close' );
			}
			manager.getById( e.windowId )?.renderCustomTitleBarButtons?.();
		},
	);

	// Window closed: a paired EDITOR takes its companion down with it
	// (destroy — a front-end page has no unsaved-changes query worth
	// running); a paired PREVIEW only clears the pairing, the editor
	// is never touched.
	addAction(
		HOOKS.WINDOW_CLOSED,
		'desktop-mode/editor-preview',
		( e: { windowId?: string } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			const asEditor = store.state.pairings.get( e.windowId );
			if ( asEditor ) {
				teardownPairing( manager, asEditor, 'editor-closed', 'destroy' );
				return;
			}
			const asPreview = pairingForPreview( e.windowId );
			if ( asPreview ) {
				teardownPairing( manager, asPreview, 'preview-closed', 'none' );
			}
		},
	);

	// Every iframe page load re-announces readiness — repaint that
	// window's buttons so the disabled eye appears when the user
	// navigates to "Add New" WITHOUT an identity change (list table →
	// post-new.php is a null → null identity transition, which fires
	// no WINDOW_CONTENT_CHANGED).
	addAction(
		HOOKS.IFRAME_READY,
		'desktop-mode/editor-preview',
		( e: { windowId?: string } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			manager.getById( e.windowId )?.renderCustomTitleBarButtons?.();
		},
	);

	// Live-preview settle nudges from watched editor iframes: the
	// page autosaved after a typing pause — refresh the companion.
	window.addEventListener( 'message', ( ev: MessageEvent ) => {
		if ( ev.origin !== window.location.origin ) {
			return;
		}
		const data = ev?.data as
			| { type?: unknown; watchId?: unknown; previewUrl?: unknown }
			| null;
		if (
			! data ||
			typeof data !== 'object' ||
			data.type !== 'desktop-mode-editor-live-saved' ||
			typeof data.watchId !== 'string'
		) {
			return;
		}
		for ( const pairing of store.state.pairings.values() ) {
			if ( pairing.watchId && pairing.watchId === data.watchId ) {
				scheduleReload(
					manager,
					pairing,
					sameOriginUrl( data.previewUrl ),
				);
				return;
			}
		}
	} );
}
