/**
 * Native browser URL drop + focused-files-surface paste intake.
 *
 * This is separate from DragManager (in-shell pointer drags) and the OS file
 * drop manager (`Files` payloads). It only claims native drags advertising
 * `text/uri-list` or `text/plain`, so the three systems do not compete.
 */

import { looksLikeWebUrl, normalizeWebUrl, urlFromUriList } from './web-url';
import { showToast } from '../toast';

export interface UrlIntakeRequest {
	url: string;
	source: 'drop' | 'paste';
	clientX?: number;
	clientY?: number;
	eventTarget: EventTarget | null;
}

export interface UrlIntakeTarget {
	host: HTMLElement;
	onUrl: ( request: UrlIntakeRequest ) => Promise< void > | void;
}

interface ReadResult {
	url: string;
	intentional: boolean;
}

const targets = new Set< UrlIntakeTarget >();
let activeTarget: UrlIntakeTarget | null = null;
let highlighted: HTMLElement | null = null;
let dragWatchdog: ReturnType< typeof setTimeout > | null = null;
let listenersInstalled = false;

function transferTypes( transfer: DataTransfer | null ): string[] {
	if ( ! transfer?.types ) {
		return [];
	}
	return Array.from( transfer.types as unknown as ArrayLike< string > );
}

export function transferMayContainUrl( transfer: DataTransfer | null ): boolean {
	const types = transferTypes( transfer );
	return (
		! types.includes( 'Files' ) &&
		( types.includes( 'text/uri-list' ) || types.includes( 'text/plain' ) )
	);
}

function readUrl( getter: ( type: string ) => string ): ReadResult {
	const uriList = getter( 'text/uri-list' );
	if ( uriList.trim() ) {
		return { url: urlFromUriList( uriList ), intentional: true };
	}
	const plain = getter( 'text/plain' ).trim();
	if ( ! plain || ! looksLikeWebUrl( plain ) ) {
		return { url: '', intentional: false };
	}
	return { url: normalizeWebUrl( plain ), intentional: true };
}

function targetFromPath( path: EventTarget[] ): UrlIntakeTarget | null {
	for ( const item of path ) {
		if ( ! ( item instanceof Element ) ) {
			continue;
		}
		for ( const target of targets ) {
			if ( item === target.host ) {
				return target;
			}
		}
		// The root desktop host contains every window. Crossing a window
		// before finding a nested folder layer means this is not a files
		// surface and must not fall through to the wallpaper.
		if ( item.classList.contains( 'desktop-mode-window' ) ) {
			return null;
		}
	}
	return null;
}

/**
 * Return the outermost connected files surface. The wallpaper layer mounts
 * before folder layers in production, but choosing by containment keeps the
 * fallback deterministic in tests and during remounts too.
 */
function defaultTarget(): UrlIntakeTarget | null {
	let candidate: UrlIntakeTarget | null = null;
	for ( const target of targets ) {
		if ( ! document.contains( target.host ) ) {
			continue;
		}
		if ( ! candidate || target.host.contains( candidate.host ) ) {
			candidate = target;
		}
	}
	return candidate;
}

function clearHighlight(): void {
	highlighted?.removeAttribute( 'data-desktop-mode-url-drop-active' );
	highlighted = null;
	if ( dragWatchdog !== null ) {
		clearTimeout( dragWatchdog );
		dragWatchdog = null;
	}
}

function paintHighlight( target: UrlIntakeTarget, eventTarget: EventTarget | null ): void {
	const element = eventTarget instanceof Element ? eventTarget : null;
	const folderTile = element?.closest< HTMLElement >(
		'.desktop-mode-file-tile[data-file-type="folder"]',
	);
	const next = folderTile && target.host.contains( folderTile )
		? folderTile
		: target.host;
	if ( highlighted !== next ) {
		clearHighlight();
		highlighted = next;
		highlighted.setAttribute( 'data-desktop-mode-url-drop-active', '' );
	}
	dragWatchdog = setTimeout( clearHighlight, 180 );
}

function pathIsEditable( path: EventTarget[] ): boolean {
	return path.some(
		( item ) =>
			item instanceof Element &&
			item.matches(
				'input, textarea, select, [contenteditable]:not([contenteditable="false"]), wpd-text-field',
			),
	);
}

function modalOrIframeOwnsFocus( target: UrlIntakeTarget ): boolean {
	const ownerDocument = target.host.ownerDocument;
	if ( ownerDocument.activeElement instanceof HTMLIFrameElement ) {
		return true;
	}
	return Boolean(
		ownerDocument.querySelector(
			'wpd-modal, dialog[open], [aria-modal="true"]',
		),
	);
}

function reportInvalid(): void {
	showToast( {
		message: 'Only HTTP and HTTPS URLs can be added as bookmarks.',
	} );
}

function installListeners(): void {
	if ( listenersInstalled ) {
		return;
	}
	listenersInstalled = true;

	document.addEventListener( 'pointerdown', onPointerDown, true );
	document.addEventListener( 'focusin', onFocusIn, true );
	document.addEventListener( 'paste', onPaste );
	window.addEventListener( 'dragover', onDragOver );
	window.addEventListener( 'drop', onDrop );
	window.addEventListener( 'dragend', clearHighlight );
	window.addEventListener( 'blur', clearHighlight );
	document.addEventListener( 'visibilitychange', onVisibilityChange );
}

function uninstallListeners(): void {
	if ( ! listenersInstalled ) {
		return;
	}
	listenersInstalled = false;
	document.removeEventListener( 'pointerdown', onPointerDown, true );
	document.removeEventListener( 'focusin', onFocusIn, true );
	document.removeEventListener( 'paste', onPaste );
	window.removeEventListener( 'dragover', onDragOver );
	window.removeEventListener( 'drop', onDrop );
	window.removeEventListener( 'dragend', clearHighlight );
	window.removeEventListener( 'blur', clearHighlight );
	document.removeEventListener( 'visibilitychange', onVisibilityChange );
	activeTarget = null;
	clearHighlight();
}

function onPointerDown( event: PointerEvent ): void {
	activeTarget = targetFromPath( event.composedPath() );
}

function onFocusIn( event: FocusEvent ): void {
	activeTarget = targetFromPath( event.composedPath() );
}

function onPaste( event: ClipboardEvent ): void {
	if (
		event.defaultPrevented ||
		! activeTarget ||
		! document.contains( activeTarget.host ) ||
		modalOrIframeOwnsFocus( activeTarget ) ||
		pathIsEditable( event.composedPath() )
	) {
		return;
	}
	const clipboard = event.clipboardData;
	if ( ! clipboard ) {
		return;
	}
	const result = readUrl( ( type ) => clipboard.getData( type ) );
	if ( ! result.intentional ) {
		return;
	}
	event.preventDefault();
	if ( ! result.url ) {
		reportInvalid();
		return;
	}
	void activeTarget.onUrl( {
		url: result.url,
		source: 'paste',
		eventTarget: event.target,
	} );
}

function onDragOver( event: DragEvent ): void {
	if ( event.defaultPrevented || ! transferMayContainUrl( event.dataTransfer ) ) {
		return;
	}
	const target = targetFromPath( event.composedPath() );
	if ( ! target ) {
		clearHighlight();
		return;
	}
	event.preventDefault();
	if ( event.dataTransfer ) {
		event.dataTransfer.dropEffect = 'copy';
	}
	paintHighlight( target, event.target );
}

function onDrop( event: DragEvent ): void {
	if ( event.defaultPrevented || ! transferMayContainUrl( event.dataTransfer ) ) {
		return;
	}
	const target = targetFromPath( event.composedPath() );
	if ( ! target || ! event.dataTransfer ) {
		clearHighlight();
		return;
	}
	event.preventDefault();
	clearHighlight();
	const result = readUrl( ( type ) => event.dataTransfer?.getData( type ) ?? '' );
	if ( ! result.url ) {
		if ( result.intentional ) {
			reportInvalid();
		}
		return;
	}
	activeTarget = target;
	void target.onUrl( {
		url: result.url,
		source: 'drop',
		clientX: event.clientX,
		clientY: event.clientY,
		eventTarget: event.target,
	} );
}

function onVisibilityChange(): void {
	if ( document.visibilityState === 'hidden' ) {
		clearHighlight();
	}
}

export function registerUrlIntakeTarget( target: UrlIntakeTarget ): () => void {
	targets.add( target );
	installListeners();
	// A freshly mounted desktop is already the active application surface.
	// Requiring a pointer/focus event after mount made the first paste a silent
	// no-op, especially in Playground where the user may copy the URL before
	// the files layer finishes booting. Prefer a newly registered outer host,
	// but never replace an explicitly active nested folder with a sibling.
	if (
		! activeTarget ||
		! document.contains( activeTarget.host ) ||
		target.host.contains( activeTarget.host )
	) {
		activeTarget = target;
	}
	return () => {
		targets.delete( target );
		if ( activeTarget === target ) {
			activeTarget = defaultTarget();
		}
		if ( targets.size === 0 ) {
			uninstallListeners();
		}
	};
}

/** Test-only teardown for the module-level target registry. */
export function __resetUrlIntakeForTests(): void {
	targets.clear();
	uninstallListeners();
}
