/**
 * OS-file drop manager.
 *
 * Catches files dragged from the user's host operating system
 * (macOS Finder, Windows Explorer, Linux Nautilus) onto **any**
 * surface inside Desktop Mode and routes them through a
 * confirmation dialog before uploading to the Media Library.
 *
 * Coverage:
 *
 *   - The wallpaper / desktop area (window-level `dragover` +
 *     `drop` listeners).
 *   - Any native window, folder grid, or shell overlay (same
 *     window-level listeners — they see everything that bubbles
 *     up from the shell DOM).
 *   - Chromeless admin iframes — handled by the chromeless bridge
 *     embedded in `includes/render/chromeless-bridge.php`, which
 *     intercepts iframe-side drops and `postMessage`s the raw
 *     `File[]` up to the parent shell (see `forwardIframeDrops`).
 *
 * Filtering: every dropped file is checked against the
 * server-supplied allowed-mime list and the size cap. Rejected
 * files raise a toast + the `desktop-mode.drop.files-rejected`
 * action; accepted files run through the `desktop-mode.drop.*`
 * hook chain (`files-detected` → `dialog-fields` → user confirms
 * → `before-upload` → `after-upload` / `upload-failed`).
 *
 * The manager is mounted by `desktop.ts` at boot and lives for
 * the lifetime of the shell. There is at most one instance —
 * `mountOsFileDropManager()` is idempotent.
 *
 * @since 0.30.0
 */

import { applyFilters, doAction } from '../hooks';
import { showToast } from '../toast';
import { FILE_DROP_HOOKS } from './hooks';
import type {
	DropContext,
	DropFileEntry,
	DropRejection,
	DropDialogFields,
} from './types';

/**
 * Sentinel that survives across Vite bundles. Routing through
 * `window` (rather than module-local state) means a stray
 * import from a feature bundle can't double-mount the manager.
 *
 * @see AGENTS.md → "Cross-bundle state" rule.
 */
interface SentinelHost {
	__desktopModeOsFileDropMounted?: MountedManager;
}

/**
 * Selectors of in-iframe drop receivers we leave untouched —
 * Gutenberg's drop zone, the legacy media uploader, and any
 * element a plugin marks with `data-drop-zone`. The chromeless
 * bridge consults this list before escalating an OS-file drop
 * up to the parent shell, so plugins that own their own file
 * handling inside an iframe keep working.
 *
 * Public surface — re-exported via the bridge protocol doc.
 */
export const IFRAME_PASSTHROUGH_SELECTORS = [
	'.components-drop-zone',
	'[data-drop-zone]',
	'.uploader-window',
	'.media-frame-content',
];

/**
 * `DragEvent.dataTransfer.types` shape varies across browsers —
 * sometimes a `DOMStringList`, sometimes a plain array. Cover
 * both without leaning on iteration that may throw under
 * strict TS.
 */
export function dragHasFiles( ev: DragEvent ): boolean {
	const types = ev.dataTransfer?.types;
	if ( ! types ) {
		return false;
	}
	const list = types as unknown as {
		includes?: ( s: string ) => boolean;
		contains?: ( s: string ) => boolean;
		length: number;
		[ i: number ]: string;
	};
	if ( typeof list.includes === 'function' ) {
		return list.includes( 'Files' );
	}
	if ( typeof list.contains === 'function' ) {
		return list.contains( 'Files' );
	}
	for ( let i = 0; i < list.length; i++ ) {
		if ( list[ i ] === 'Files' ) {
			return true;
		}
	}
	return false;
}

/** Resolve a posted-from `Window` source to its host window id. */
function resolveWindowIdFromSource(
	source: MessageEventSource | null,
): string | undefined {
	if ( ! source ) {
		return undefined;
	}
	const iframes = document.querySelectorAll< HTMLIFrameElement >( 'iframe' );
	for ( const f of Array.from( iframes ) ) {
		if ( f.contentWindow === source ) {
			const host = f.closest( '[data-window-id]' );
			return host?.getAttribute( 'data-window-id' ) || undefined;
		}
	}
	return undefined;
}

import type { DropConfig } from './types';

interface MountOptions {
	config: DropConfig;
	mediaUrl: string;
	restNonce: string;
	/**
	 * Dialog opener — the dialog module is lazy-loaded so its
	 * `<wpd-modal>` import doesn't ship in the boot path for
	 * users who never drop a file. Wired by `index.ts`.
	 */
	openDialog: ( entries: DropFileEntry[], ctx: DropContext ) => Promise< void >;
}

interface MountedManager {
	dispose: () => void;
}

/**
 * Mount the drop manager. Idempotent — repeated calls are a
 * no-op (returns the live manager). Uses a window-level
 * sentinel so cross-bundle double-imports stay safe.
 */
export function mountOsFileDropManager( opts: MountOptions ): MountedManager {
	const host = window as unknown as SentinelHost;
	if ( host.__desktopModeOsFileDropMounted ) {
		return host.__desktopModeOsFileDropMounted;
	}
	if ( ! opts.config.enabled ) {
		// User lacks `upload_files` — still mount a no-op so the
		// browser's default "open file" navigation doesn't fire
		// when a user drags a file in. Cancel the events but
		// don't surface a dialog.
		return mountNoOp();
	}

	const overlayEl = ensureDropOverlay();
	let dragDepth = 0;
	let dragWatchdog: ReturnType< typeof setTimeout > | null = null;

	const resetOverlay = (): void => {
		dragDepth = 0;
		overlayEl.classList.remove( 'is-active' );
		if ( dragWatchdog !== null ) {
			clearTimeout( dragWatchdog );
			dragWatchdog = null;
		}
	};

	const bumpWatchdog = (): void => {
		if ( dragWatchdog !== null ) {
			clearTimeout( dragWatchdog );
		}
		// If we don't see a `dragover` for ~250ms, the drag has
		// either crossed into an iframe (which never bubbles
		// back out) or the source app exited without firing
		// `dragend`. Fail safe: drop the overlay.
		dragWatchdog = setTimeout( resetOverlay, 250 );
	};

	const onDragEnter = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}
		ev.preventDefault();
		dragDepth++;
		overlayEl.classList.add( 'is-active' );
		bumpWatchdog();
	};

	const onDragOver = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}
		ev.preventDefault();
		if ( ev.dataTransfer ) {
			ev.dataTransfer.dropEffect = 'copy';
		}
		bumpWatchdog();
	};

	const onDragLeave = (): void => {
		// Some Chromium drag-leave events lose `dataTransfer.types`
		// mid-drag, so we can't gate on `dragHasFiles` here. Bound
		// the depth decrement either way.
		dragDepth = Math.max( 0, dragDepth - 1 );
		if ( dragDepth === 0 ) {
			overlayEl.classList.remove( 'is-active' );
		}
	};

	const onDrop = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}
		ev.preventDefault();
		resetOverlay();
		const files = ev.dataTransfer?.files
			? Array.from( ev.dataTransfer.files )
			: [];
		if ( files.length === 0 ) {
			return;
		}
		const ctx = classifyDropTarget( ev );
		void handleFiles( files, ctx, opts );
	};

	const onDragEnd = (): void => resetOverlay();
	const onVisibilityChange = (): void => {
		if ( document.visibilityState === 'hidden' ) {
			resetOverlay();
		}
	};

	const onIframeMessage = ( ev: MessageEvent ): void => {
		if ( ev.origin !== window.location.origin ) {
			return;
		}
		const data = ev.data as
			| {
					type?: string;
					files?: File[];
					windowId?: string;
					x?: number;
					y?: number;
				}
			| null;
		if ( ! data || data.type !== 'desktop-mode-os-file-drop' ) {
			return;
		}
		if ( ! Array.isArray( data.files ) || data.files.length === 0 ) {
			return;
		}
		// Validate every entry is actually a File. postMessage
		// preserves File identity across same-origin frames, so
		// `instanceof File` is the safest filter.
		const files = data.files.filter( ( f ): f is File => f instanceof File );
		if ( files.length === 0 ) {
			return;
		}
		// Resolve the source iframe → windowId by matching the
		// posted-from `contentWindow` against every iframe in the
		// shell. The iframe's parent element carries the
		// `data-window-id` attribute the window manager stamps on.
		// If we can't resolve the source to a real shell iframe,
		// drop the message — even though same-origin parity makes
		// this low-risk, declining unknown posters keeps the
		// upload dialog from being triggered by an unrelated
		// background page that happens to share the origin.
		const windowId = resolveWindowIdFromSource( ev.source );
		if ( ! windowId ) {
			return;
		}
		const ctx: DropContext = {
			surface: 'iframe',
			windowId,
			x: typeof data.x === 'number' ? data.x : 0,
			y: typeof data.y === 'number' ? data.y : 0,
		};
		// Reset the depth counter / overlay — iframe drops never
		// fire `dragleave` on the parent because the drag never
		// crosses back out of the iframe.
		dragDepth = 0;
		overlayEl.classList.remove( 'is-active' );
		void handleFiles( files, ctx, opts );
	};

	window.addEventListener( 'dragenter', onDragEnter );
	window.addEventListener( 'dragover', onDragOver );
	window.addEventListener( 'dragleave', onDragLeave );
	window.addEventListener( 'drop', onDrop );
	window.addEventListener( 'dragend', onDragEnd );
	document.addEventListener( 'visibilitychange', onVisibilityChange );
	window.addEventListener( 'blur', onDragEnd );
	window.addEventListener( 'message', onIframeMessage );

	const manager: MountedManager = {
		dispose: (): void => {
			window.removeEventListener( 'dragenter', onDragEnter );
			window.removeEventListener( 'dragover', onDragOver );
			window.removeEventListener( 'dragleave', onDragLeave );
			window.removeEventListener( 'drop', onDrop );
			window.removeEventListener( 'dragend', onDragEnd );
			document.removeEventListener(
				'visibilitychange',
				onVisibilityChange,
			);
			window.removeEventListener( 'blur', onDragEnd );
			window.removeEventListener( 'message', onIframeMessage );
			overlayEl.remove();
			delete ( window as unknown as SentinelHost )
				.__desktopModeOsFileDropMounted;
		},
	};
	host.__desktopModeOsFileDropMounted = manager;
	return manager;
}

/**
 * Visible during dragenter / dragover. Sized to cover the shell
 * but kept under the modal layer so the upload dialog renders
 * on top.
 */
function ensureDropOverlay(): HTMLElement {
	const existing = document.querySelector( '.desktop-mode-os-drop-overlay' );
	if ( existing ) {
		return existing as HTMLElement;
	}
	const el = document.createElement( 'div' );
	el.className = 'desktop-mode-os-drop-overlay';
	el.setAttribute( 'aria-hidden', 'true' );
	el.style.cssText = [
		'position:fixed',
		'inset:0',
		'pointer-events:none',
		'z-index:200',
		'opacity:0',
		'transition:opacity 120ms ease',
		'background:radial-gradient(circle at center, rgba(34,113,177,0.18) 0%, rgba(34,113,177,0.06) 60%, transparent 100%)',
		'box-shadow:inset 0 0 0 3px rgba(34,113,177,0.55)',
	].join( ';' );
	const label = document.createElement( 'div' );
	label.style.cssText = [
		'position:absolute',
		'top:50%',
		'left:50%',
		'transform:translate(-50%,-50%)',
		'padding:14px 22px',
		'border-radius:12px',
		'background:rgba(20,20,24,0.78)',
		'color:#fff',
		'font:600 14px/1.2 -apple-system,BlinkMacSystemFont,sans-serif',
		'letter-spacing:0.02em',
	].join( ';' );
	label.textContent = 'Drop to upload';
	el.appendChild( label );
	document.body.appendChild( el );
	const style = document.createElement( 'style' );
	style.textContent =
		'.desktop-mode-os-drop-overlay.is-active{opacity:1!important;}';
	document.head.appendChild( style );
	return el;
}

/**
 * Capability-less mount path. The user has no `upload_files`
 * cap, so we still cancel the browser default (otherwise
 * dropping a file navigates the tab away from the shell), but
 * we don't show a dialog or surface a toast on every drop.
 */
function mountNoOp(): MountedManager {
	const cancel = ( ev: DragEvent ): void => {
		if ( ! dragHasFiles( ev ) ) {
			return;
		}
		// Don't block in-page drop receivers (Gutenberg, media
		// frame). A user with `upload_files` stripped should still
		// be able to use the editor's own drop handler.
		const target = ev.target as Element | null;
		if (
			target?.closest &&
			IFRAME_PASSTHROUGH_SELECTORS.some( ( s ) => target.closest( s ) )
		) {
			return;
		}
		ev.preventDefault();
	};
	window.addEventListener( 'dragover', cancel );
	window.addEventListener( 'drop', cancel );
	const host = window as unknown as SentinelHost;
	const manager: MountedManager = {
		dispose: (): void => {
			window.removeEventListener( 'dragover', cancel );
			window.removeEventListener( 'drop', cancel );
			delete host.__desktopModeOsFileDropMounted;
		},
	};
	host.__desktopModeOsFileDropMounted = manager;
	return manager;
}

/**
 * Classify the drop target. Best-effort — we walk up the DOM
 * looking for known surface markers. Plugins that introduce
 * new surfaces can subscribe to the `desktop-mode.drop.dialog-fields`
 * filter and inspect the file themselves; the `surface` label is
 * advisory.
 */
function classifyDropTarget( ev: DragEvent ): DropContext {
	const x = ev.clientX;
	const y = ev.clientY;
	let node: Element | null = ev.target as Element | null;
	while ( node && node !== document.body ) {
		if ( node.tagName === 'IFRAME' ) {
			const id = ( node as HTMLIFrameElement ).closest(
				'[data-window-id]',
			);
			return {
				surface: 'iframe',
				windowId: id?.getAttribute( 'data-window-id' ) || undefined,
				x,
				y,
			};
		}
		if ( node.hasAttribute( 'data-window-id' ) ) {
			return {
				surface: 'window',
				windowId: node.getAttribute( 'data-window-id' ) || undefined,
				x,
				y,
			};
		}
		if ( node.classList.contains( 'desktop-mode-folder-grid' ) ) {
			return { surface: 'folder', x, y };
		}
		if (
			node.id === 'desktop-mode-wallpaper' ||
			node.classList.contains( 'desktop-mode-wallpaper' ) ||
			node.classList.contains( 'desktop-mode-desktop' )
		) {
			return { surface: 'wallpaper', x, y };
		}
		node = node.parentElement;
	}
	return { surface: 'unknown', x, y };
}

/**
 * Core pipeline: filter → defaults → dialog → upload.
 * Exported so the iframe-message path can reuse it, and so
 * tests can drive the manager without simulating drag events.
 */
export async function handleFiles(
	rawFiles: File[],
	ctx: DropContext,
	opts: MountOptions,
): Promise< void > {
	const detected = applyFilters(
		FILE_DROP_HOOKS.FILES_DETECTED,
		rawFiles,
		ctx,
	) as File[];
	if ( ! Array.isArray( detected ) || detected.length === 0 ) {
		return;
	}

	const { accepted, rejected } = partitionByPolicy(
		detected,
		opts.config,
	);

	if ( rejected.length > 0 ) {
		doAction( FILE_DROP_HOOKS.FILES_REJECTED, {
			rejections: rejected,
			context: ctx,
		} );
		showToast( {
			message:
				rejected.length === 1
					? rejected[ 0 ].message
					: `${ rejected.length } files couldn't be uploaded.`,
		} );
	}

	if ( accepted.length === 0 ) {
		return;
	}

	const entries: DropFileEntry[] = accepted.map( ( { file, mime } ) => {
		const base: DropFileEntry = {
			file,
			mime,
			fields: defaultFields( file, mime ),
		};
		const filtered = applyFilters(
			FILE_DROP_HOOKS.DIALOG_FIELDS,
			base,
			ctx,
		);
		// Defensive: a buggy filter that returns `undefined` or
		// mutates `fields` away crashes the dialog later. Fall
		// back to `base` on any shape mismatch.
		if (
			! filtered ||
			typeof filtered !== 'object' ||
			! ( 'fields' in filtered ) ||
			typeof ( filtered as DropFileEntry ).fields !== 'object'
		) {
			return base;
		}
		return filtered as DropFileEntry;
	} );

	await opts.openDialog( entries, ctx );
}

/**
 * Apply the server-supplied allowed-mime + size policy. Returns
 * the accepted file list (with the WordPress-canonical mime,
 * not the browser's guessed `file.type`) and the per-file
 * rejection list.
 */
export function partitionByPolicy(
	files: File[],
	config: DropConfig,
): { accepted: { file: File; mime: string }[]; rejected: DropRejection[] } {
	const accepted: { file: File; mime: string }[] = [];
	const rejected: DropRejection[] = [];
	for ( const file of files ) {
		if ( file.size === 0 ) {
			rejected.push( {
				file,
				reason: 'empty',
				message: `“${ file.name }” is empty.`,
			} );
			continue;
		}
		if ( config.maxSize > 0 && file.size > config.maxSize ) {
			rejected.push( {
				file,
				reason: 'size',
				message: `“${ file.name }” exceeds the ${ formatBytes(
					config.maxSize,
				) } upload limit.`,
			} );
			continue;
		}
		const mime = resolveAllowedMime(
			file,
			config.allowedMimes,
			config.extToMime,
		);
		if ( ! mime ) {
			rejected.push( {
				file,
				reason: 'mime',
				message: `“${ file.name }” is not an allowed file type.`,
			} );
			continue;
		}
		accepted.push( { file, mime } );
	}
	return { accepted, rejected };
}

/**
 * Resolve the file's MIME against the server's allow-list.
 * Browser-reported `file.type` is preferred; when missing we
 * fall back to an extension lookup against the same list (the
 * server emits `ext => mime`, so the list captures both
 * dimensions).
 *
 * Returns the canonical MIME (the one we'll send to wp/v2/media)
 * or `null` when the file isn't allowed.
 */
export function resolveAllowedMime(
	file: File,
	allowedMimes: string[],
	extToMime?: Record< string, string >,
): string | null {
	if ( allowedMimes.length === 0 ) {
		return null;
	}
	const lower = file.type.toLowerCase();
	if ( lower && allowedMimes.includes( lower ) ) {
		return lower;
	}
	// `file.type` is blank for HEIC, AVIF, and a long tail of
	// formats. Fall back to the server-supplied ext→mime map
	// (canonical) and, only when that map is unavailable, the
	// built-in best-guess table below.
	const ext = extensionOf( file.name );
	if ( ! ext ) {
		return null;
	}
	if ( extToMime ) {
		for ( const [ key, mime ] of Object.entries( extToMime ) ) {
			// Server keys are extension globs like `jpg|jpeg|jpe`.
			if ( key.split( '|' ).includes( ext ) && allowedMimes.includes( mime ) ) {
				return mime;
			}
		}
		return null;
	}
	const guess = EXTENSION_GUESSES[ ext ];
	if ( guess && allowedMimes.includes( guess ) ) {
		return guess;
	}
	return null;
}

const EXTENSION_GUESSES: Record< string, string > = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	heic: 'image/heic',
	heif: 'image/heif',
	svg: 'image/svg+xml',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	pdf: 'application/pdf',
};

function extensionOf( name: string ): string {
	const dot = name.lastIndexOf( '.' );
	if ( dot < 0 ) {
		return '';
	}
	return name.slice( dot + 1 ).toLowerCase();
}

/**
 * Build the manager's default dialog metadata for a single
 * file. Subscribers to `desktop-mode.drop.dialog-fields` can
 * mutate the result before the dialog renders.
 */
export function defaultFields(
	file: File,
	mime: string,
): DropDialogFields {
	const safeName = sanitizeFilename( file.name );
	const ext = extensionOf( safeName );
	const stem = ext
		? safeName.slice( 0, safeName.length - ext.length - 1 )
		: safeName;
	const title = humanize( stem );
	return {
		title,
		altText: mime.startsWith( 'image/' ) ? title : '',
		caption: '',
		description: '',
		filename: safeName,
	};
}

/**
 * Trim weird whitespace, collapse runs of unsafe chars, keep
 * the extension. Matches what `sanitize_file_name()` does on
 * the server side closely enough that the dialog's pre-filled
 * filename round-trips through `wp_handle_upload`.
 */
export function sanitizeFilename( name: string ): string {
	// Strip path separators (traversal defence) and C0 controls;
	// collapse whitespace; trim. Unicode preserved — the server's
	// sanitize_file_name() is canonical for the final filename.
	const cleaned = name
		.replace( /[\\/]/g, '-' )
		// eslint-disable-next-line no-control-regex -- C0 + DEL.
		.replace( /[\x00-\x1f\x7f]/g, '' )
		.replace( /\s+/g, ' ' )
		.replace( / *- */g, '-' )
		.replace( /-+/g, '-' )
		.trim()
		.replace( /^[-.]+|[-.]+$/g, '' );
	return cleaned || 'upload';
}

/**
 * Cheap "human readable" basename: replaces dashes / underscores
 * with spaces and capitalises the first character. Surfaced as
 * the default `title` + `altText` in the upload dialog.
 */
export function humanize( stem: string ): string {
	const spaced = stem.replace( /[-_]+/g, ' ' ).trim();
	if ( ! spaced ) {
		return 'Upload';
	}
	return spaced.charAt( 0 ).toUpperCase() + spaced.slice( 1 );
}

function formatBytes( bytes: number ): string {
	if ( bytes >= 1024 * 1024 ) {
		return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 0 ) } MB`;
	}
	if ( bytes >= 1024 ) {
		return `${ ( bytes / 1024 ).toFixed( 0 ) } KB`;
	}
	return `${ bytes } B`;
}
