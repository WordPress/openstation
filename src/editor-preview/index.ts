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

interface PreviewPairing {
	editorWindowId: string;
	previewWindowId: string;

	postKey: string;

	openUrl: string;

	unsubscribe: () => void;

	reloadTimer: number | null;

	watchId: string;
}

interface EditorPreviewState {

	pairings: Map< string, PreviewPairing >;

	busyEditors: Set< string >;
}

const store = createSharedStore< EditorPreviewState >(
	'desktop-mode/editor-preview',
	() => ( {
		pairings: new Map(),
		busyEditors: new Set(),
	} ),
);

const RELOAD_DEBOUNCE_MS = 400;

const LIVE_DEBOUNCE_DEFAULT_MS = 1500;

function contentKey( content: WindowContentRef | null | undefined ): string {
	return content ? `${ content.type }:${ content.id }` : '';
}

function pairingForPreview( windowId: string ): PreviewPairing | undefined {
	for ( const pairing of store.state.pairings.values() ) {
		if ( pairing.previewWindowId === windowId ) {
			return pairing;
		}
	}
	return undefined;
}

function isSmallScreen(): boolean {
	return (
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(max-width: 767px)' ).matches
	);
}

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

function teardownPairing(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
	reason: 'toggled' | 'editor-closed' | 'preview-closed' | 'content-changed',
	closePreview: 'destroy' | 'close' | 'none',
): void {
	store.state.pairings.delete( pairing.editorWindowId );
	if ( pairing.reloadTimer !== null ) {
		window.clearTimeout( pairing.reloadTimer );
		pairing.reloadTimer = null;
	}
	try {
		pairing.unsubscribe();
	} catch {

	}

	stopLiveWatch( manager, pairing );

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
		new CustomEvent( 'os-editor-preview-closed', { detail } ),
	);
	doAction( HOOKS.EDITOR_PREVIEW_CLOSED, detail );

	manager
		.getById( pairing.editorWindowId )
		?.renderCustomTitleBarButtons?.();
}

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

function wireSaveReload(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
	content: WindowContentRef,
): void {
	const topic = `os.${ content.type }.changed`;
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

let watchCounter = 0;

function stopLiveWatch(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
): void {
	if ( ! pairing.watchId ) {
		return;
	}
	const editorWin = manager.getById( pairing.editorWindowId );
	try {
		editorWin?.iframe?.contentWindow?.postMessage(
			{
				type: 'os-editor-live-unwatch',
				watchId: pairing.watchId,
			},
			window.location.origin,
		);
	} catch {

	}
	pairing.watchId = '';
}

function startLiveWatch(
	manager: EditorPreviewManager,
	pairing: PreviewPairing,
	content: WindowContentRef,
): void {
	stopLiveWatch( manager, pairing );

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
				type: 'os-editor-live-watch',
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

	}
}

let requestAutosave: (
	win: EditorPreviewWindowLike,
) => Promise< AutosaveResult > = requestEditorAutosave;

export function _setAutosaveTransportForTests(
	fn: typeof requestAutosave | null,
): void {
	requestAutosave = fn ?? requestEditorAutosave;
}

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
		return;
	}

	if ( ! manager.getById( win.id ) ) {
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

	const autosavePromise = requestAutosave( win );
	void autosavePromise
		.then( ( result ) => {
			if ( result.status === 'error' ) {
				showToast( {
					message: __(
						"Couldn't save your latest changes — the preview shows the last saved version.",
					),
				} );
			}
		} )
		.finally( () => {
			store.state.busyEditors.delete( win.id );
			manager.getById( win.id )?.renderCustomTitleBarButtons?.();
		} );

	const previewId = `editor-preview-${ String( content.type ).replace(
		/\//g,
		'-',
	) }-${ content.id }`;
	let title = __( 'Preview' );
	if ( content.label ) {
		title = sprintf( __( 'Preview: %s' ), content.label );
	}

	let config: Partial< WindowConfig > & {
		id: string;
		url: string;
		title: string;
	} = {
		id: previewId,
		baseId: previewId,
		url: content.previewUrl,
		title,
		icon: 'dashicons-visibility',
		ephemeral: true,
		...( small ? {} : { initialState: 'snapped-right' as const } ),
	};
	const filtered = applyFilters< typeof config >(
		HOOKS.EDITOR_PREVIEW_WINDOW_CONFIG,
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
		console.warn(
			'[openstation] `os.editor-preview.window-config` ' +
				'filter returned an invalid config; using the default.',
		);
	}

	await manager.open( config );

	if (
		! manager.getById( win.id ) ||
		contentKey( getWindowContent( win.id ) ) !== contentKey( content )
	) {
		manager.getById( config.id )?.destroy?.();
		return;
	}

	const pairing: PreviewPairing = {
		editorWindowId: win.id,
		previewWindowId: config.id,
		postKey: contentKey( content ),
		openUrl: config.url,
		unsubscribe: () => undefined,
		reloadTimer: null,
		watchId: '',
	};
	wireSaveReload( manager, pairing, content );
	startLiveWatch( manager, pairing, content );
	store.state.pairings.set( win.id, pairing );

	const detail = {
		editorWindowId: win.id,
		previewWindowId: config.id,
		content,
	};
	document.dispatchEvent(
		new CustomEvent( 'os-editor-preview-opened', {
			detail,
		} ),
	);
	doAction( HOOKS.EDITOR_PREVIEW_OPENED, detail );

	void autosavePromise.then( ( result ) => {
		if ( store.state.pairings.get( win.id ) !== pairing ) {
			return;
		}
		if ( result.status === 'saved' ) {
			scheduleReload( manager, pairing, result.previewUrl );
		}
	} );
}

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
		order: 55,
		match: ( win ) =>
			! win.config.native &&
			( !! getWindowContent( win.id )?.previewUrl ||
				isUnsavedEditorScreen( win ) ),
		render: ( host, win ) => {
			if ( ! getWindowContent( win.id )?.previewUrl ) {
				const hint = __( 'Save the post to enable its preview' );
				host.setAttribute( 'aria-disabled', 'true' );
				host.setAttribute( 'aria-label', hint );
				host.setAttribute( 'title', hint );
				host.classList.add( 'os-window__btn--disabled' );
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
				host.classList.add( 'os-window__btn--busy' );
			}
			host.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				void onEyeClick( manager, win );
			} );
		},
	} );

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

	addAction(
		HOOKS.IFRAME_READY,
		'desktop-mode/editor-preview',
		( e: { windowId?: string } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			const pairing = store.state.pairings.get( e.windowId );
			if ( pairing ) {
				const content = getWindowContent( e.windowId );
				if ( content && contentKey( content ) === pairing.postKey ) {
					startLiveWatch( manager, pairing, content );
				}
			}
			manager.getById( e.windowId )?.renderCustomTitleBarButtons?.();
		},
	);

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
			data.type !== 'os-editor-live-saved' ||
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
