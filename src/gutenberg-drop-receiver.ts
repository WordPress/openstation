/**
 * Desktop Mode — Gutenberg drop receiver (iframe-side bundle).
 *
 * Loaded only inside `post.php` / `post-new.php` chromeless iframes
 * (PHP enqueue keyed on `current_screen()->base`). Listens for
 * `desktop-mode-drop` postMessages from the parent shell —
 * dispatched by `src/drag/iframe-drop-targets.ts` when the user
 * releases a shell-side drag (My WordPress media / post / user tile)
 * over a Gutenberg window's drop overlay.
 *
 * The receiver maps the bridge payload's `kind` (+ media `mime`) to
 * a Gutenberg block and inserts it via the Block Editor's data store:
 *
 *   - `attachment` `image/*`  → `core/image`
 *   - `attachment` `video/*`  → `core/video`
 *   - `attachment` `audio/*`  → `core/audio`
 *   - `attachment` other      → `core/file`
 *   - `post` / `user`         → `core/paragraph` with `<a href>title</a>`
 *
 * The block factory + dispatch are pure functions of the payload —
 * unit-tested in `gutenberg-drop-receiver.test.ts` against synthetic
 * `wp.blocks` / `wp.data` shims. The bundle itself never touches the
 * DOM; insertion happens entirely through Gutenberg's store.
 *
 * Origin trust: messages whose `e.origin !== window.location.origin`
 * are dropped. Same-origin admin scripts can still forge messages,
 * but the browser's same-origin boundary is the real defence.
 *
 * @since 0.22.0
 */

// ---------------------------------------------------------------------
// Payload shapes — mirror the discriminated union in `src/drag-bridge.ts`.
// Duplicated here (instead of imported) because this is a standalone
// iframe-side bundle with no shell dependencies.
// ---------------------------------------------------------------------

interface AttachmentDragPayload {
	kind: 'attachment';
	id: number;
	url: string;
	title: string;
	alt: string;
	mime: string;
	thumbnailUrl?: string;
	sizes?: Record< string, unknown >;
}

interface PostDragPayload {
	kind: 'post';
	id: number;
	postType: string;
	url: string;
	title: string;
}

interface UserDragPayload {
	kind: 'user';
	id: number;
	url: string;
	title: string;
}

type DragBridgePayload =
	| AttachmentDragPayload
	| PostDragPayload
	| UserDragPayload;

interface DropMsg {
	type: 'desktop-mode-drop';
	payload: DragBridgePayload;
	position?: { x: number; y: number };
}

// ---------------------------------------------------------------------
// Block factory — pure. Tested via vitest.
// ---------------------------------------------------------------------

interface BlockSpec {
	/** Block slug (`core/image`, `core/paragraph`, …). */
	name: string;
	/** Block attributes. */
	attributes: Record< string, unknown >;
}

/**
 * Escape a string for inclusion in HTML attributes / text. Used when
 * constructing `<a>` markup for post/user payloads. Same allowlist
 * `wp_specialchars()` covers.
 */
function escapeHtml( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' )
		.replace( /'/g, '&#039;' );
}

/**
 * Reject `javascript:` and `data:` URLs before they land in an
 * inserted anchor's href. The bridge's same-origin postMessage check
 * is the first line of defence, but defence-in-depth here is cheap.
 * Accepts http(s), absolute paths, hash + query fragments, and any
 * other scheme that isn't on the deny list.
 */
function isSafeUrl( raw: string ): boolean {
	const lower = raw.trimStart().toLowerCase();
	if ( lower.startsWith( 'javascript:' ) ) {
		return false;
	}
	if ( lower.startsWith( 'data:' ) ) {
		return false;
	}
	if ( lower.startsWith( 'vbscript:' ) ) {
		return false;
	}
	return true;
}

/**
 * Build a Gutenberg block spec for the given payload. Returns `null`
 * for empty post/user URLs (the receiver no-ops in that case rather
 * than inserting a dead `<a href="">`).
 *
 * @public
 */
export function buildBlockSpec(
	payload: DragBridgePayload,
): BlockSpec | null {
	if ( payload.kind === 'attachment' ) {
		// Attachment URLs feed `core/image[.url]` / `core/video[.src]`
		// etc. as raw attributes, never as HTML — but a hostile
		// `javascript:` URL surviving into a `core/file` href would
		// still be a click-to-XSS. Reject up front.
		if ( ! payload.url || ! isSafeUrl( payload.url ) ) {
			return null;
		}
		const mime = payload.mime || '';
		if ( mime.startsWith( 'image/' ) ) {
			return {
				name: 'core/image',
				attributes: {
					id: payload.id,
					url: payload.url,
					alt: payload.alt || '',
					caption: '',
				},
			};
		}
		if ( mime.startsWith( 'video/' ) ) {
			return {
				name: 'core/video',
				attributes: {
					id: payload.id,
					src: payload.url,
				},
			};
		}
		if ( mime.startsWith( 'audio/' ) ) {
			return {
				name: 'core/audio',
				attributes: {
					id: payload.id,
					src: payload.url,
				},
			};
		}
		return {
			name: 'core/file',
			attributes: {
				id: payload.id,
				href: payload.url,
				fileName: payload.title,
			},
		};
	}
	// `post` and `user` both render as a paragraph wrapping an
	// anchor. Skip when the bridge couldn't resolve a URL — empty
	// hrefs aren't useful and the drop should snap back instead of
	// silently inserting a dead link. Same scheme gate as
	// attachments: a `javascript:` URL would be a one-click XSS.
	if ( ! payload.url || ! isSafeUrl( payload.url ) ) {
		return null;
	}
	const safeTitle = escapeHtml( payload.title || payload.url );
	const safeHref = escapeHtml( payload.url );
	return {
		name: 'core/paragraph',
		attributes: {
			content: `<a href="${ safeHref }">${ safeTitle }</a>`,
		},
	};
}

// ---------------------------------------------------------------------
// Gutenberg integration — minimally typed shim.
// ---------------------------------------------------------------------

interface WpBlocks {
	createBlock( name: string, attributes?: Record< string, unknown > ): unknown;
}

interface WpDataDispatch {
	insertBlocks( blocks: unknown[] ): void;
}

interface WpDataSelect {
	getBlockCount(): number;
}

interface WpData {
	dispatch( store: 'core/block-editor' ): WpDataDispatch;
	select( store: 'core/block-editor' ): WpDataSelect;
}

interface WpGlobal {
	blocks?: WpBlocks;
	data?: WpData;
	domReady?: ( cb: () => void ) => void;
}

declare const window: Window & { wp?: WpGlobal };

/**
 * Resolve `wp.blocks` + `wp.data` once they're both available. Polls
 * with `requestAnimationFrame` instead of `wp.domReady` because the
 * editor stores can boot AFTER DOMContentLoaded in some flows (e.g.
 * `post-new.php?post_type=page` with a slow REST preload).
 *
 * Gives up after ~5s (300 rAF ticks at 60Hz) and rejects so the drop
 * surfaces an error in the console rather than hanging forever.
 */
async function waitForEditor(): Promise< {
	blocks: WpBlocks;
	data: WpData;
} > {
	return new Promise( ( resolve, reject ) => {
		let ticks = 0;
		const MAX_TICKS = 300;
		const tick = (): void => {
			const wp = window.wp;
			if ( wp?.blocks && wp.data ) {
				resolve( { blocks: wp.blocks, data: wp.data } );
				return;
			}
			ticks++;
			if ( ticks > MAX_TICKS ) {
				reject(
					new Error(
						'desktop-mode/gutenberg-drop-receiver: timed out waiting for wp.blocks + wp.data',
					),
				);
				return;
			}
			requestAnimationFrame( tick );
		};
		tick();
	} );
}

async function performInsert( payload: DragBridgePayload ): Promise< void > {
	const spec = buildBlockSpec( payload );
	if ( ! spec ) {
		return;
	}
	const { blocks, data } = await waitForEditor();
	const block = blocks.createBlock( spec.name, spec.attributes );
	data.dispatch( 'core/block-editor' ).insertBlocks( [ block ] );
}

/**
 * Notify the parent shell that an insert failed (timeout, throw,
 * unknown payload). The parent listens for this message and surfaces
 * a toast — without it the user would see no feedback when the
 * editor wasn't ready and silently swallow the drop.
 */
function notifyParentOfFailure( reason: string ): void {
	if ( window.parent === window ) {
		return;
	}
	try {
		window.parent.postMessage(
			{ type: 'desktop-mode-drop-failed', reason },
			window.location.origin,
		);
	} catch {
		// Cross-origin parent — nothing we can do.
	}
}

// ---------------------------------------------------------------------
// Message wiring.
// ---------------------------------------------------------------------

interface DragOverMsg {
	type: 'desktop-mode-drag-over';
	payload: DragBridgePayload;
}

interface DragLeaveMsg {
	type: 'desktop-mode-drag-leave';
}

function isDropMsg( m: unknown ): m is DropMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	const obj = m as { type?: unknown; payload?: unknown };
	if ( obj.type !== 'desktop-mode-drop' ) {
		return false;
	}
	const p = obj.payload as { kind?: unknown } | undefined;
	if ( ! p || typeof p !== 'object' ) {
		return false;
	}
	return p.kind === 'attachment' || p.kind === 'post' || p.kind === 'user';
}

function isDragOverMsg( m: unknown ): m is DragOverMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	const obj = m as { type?: unknown; payload?: unknown };
	if ( obj.type !== 'desktop-mode-drag-over' ) {
		return false;
	}
	const p = obj.payload as { kind?: unknown } | undefined;
	if ( ! p || typeof p !== 'object' ) {
		return false;
	}
	return p.kind === 'attachment' || p.kind === 'post' || p.kind === 'user';
}

function isDragLeaveMsg( m: unknown ): m is DragLeaveMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	return ( m as { type?: unknown } ).type === 'desktop-mode-drag-leave';
}

/**
 * Latest bridge payload broadcast from the parent shell while a
 * cross-frame drag is in flight. Set on `desktop-mode-drag-over`,
 * cleared on `-drag-leave` or after a successful insert. Used by
 * the native HTML5 `drop` handler below to insert the correct
 * block when Chromium strips the custom `application/x-wp-media-
 * attachment` MIME on the cross-iframe hop (so Gutenberg's own
 * drop logic doesn't recognize the payload as a media drop and
 * silently no-ops).
 */
let stashedBridgePayload: DragBridgePayload | null = null;

interface AttachedDocSentinel extends Document {
	__desktopModeDropReceiverAttached?: boolean;
}

// Diagnostic counters — surfaced via the debug helper below so we
// can immediately see at runtime which side of the pipeline is
// reaching the user and which is silent.
const _debugCounters = {
	dragOverMsgs: 0,
	dragLeaveMsgs: 0,
	nativeDrops: 0,
	nativeDropsWithStash: 0,
	docsAttached: 0,
};

function onNativeDrop( e: DragEvent ): void {
	_debugCounters.nativeDrops++;
	if ( ! stashedBridgePayload ) {
		return;
	}
	_debugCounters.nativeDropsWithStash++;
	const payload = stashedBridgePayload;
	stashedBridgePayload = null;
	e.preventDefault();
	e.stopPropagation();
	if ( typeof e.stopImmediatePropagation === 'function' ) {
		e.stopImmediatePropagation();
	}
	void performInsert( payload ).catch( ( err: unknown ) => {
		const reason = err instanceof Error ? err.message : String( err );
		// eslint-disable-next-line no-console
		console.error(
			'[desktop-mode] Gutenberg drop receiver native-drop insert failed:',
			err,
		);
		notifyParentOfFailure( reason );
	} );
}

function onNativeDragOver( e: DragEvent ): void {
	if ( ! stashedBridgePayload ) {
		return;
	}
	e.preventDefault();
	if ( e.dataTransfer ) {
		e.dataTransfer.dropEffect = 'copy';
	}
}

/**
 * Attach native HTML5 `drop` + `dragover` listeners to a Document
 * (the outer post.php iframe AND every nested same-origin iframe
 * inside it — Gutenberg's editor canvas runs in a sub-iframe so
 * drops on the canvas never reach `window` of the outer iframe
 * where this script runs).
 *
 * Idempotent — each document is marked with a sentinel so repeated
 * walks don't pile up listeners.
 */
function attachToDocument( doc: Document ): void {
	const sentinel = doc as AttachedDocSentinel;
	if ( sentinel.__desktopModeDropReceiverAttached ) {
		return;
	}
	sentinel.__desktopModeDropReceiverAttached = true;
	doc.addEventListener( 'drop', onNativeDrop, true );
	doc.addEventListener( 'dragover', onNativeDragOver, true );
	_debugCounters.docsAttached++;
}

function attachToAllFrames(): void {
	attachToDocument( document );
	document
		.querySelectorAll< HTMLIFrameElement >( 'iframe' )
		.forEach( ( iframe ) => {
			try {
				const innerDoc = iframe.contentDocument;
				if ( innerDoc ) {
					attachToDocument( innerDoc );
				}
			} catch {
				// Cross-origin sub-iframe — can't access; skip.
			}
		} );
}

function install(): void {
	const expectedOrigin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== expectedOrigin ) {
			return;
		}
		if ( isDragOverMsg( e.data ) ) {
			stashedBridgePayload = e.data.payload;
			_debugCounters.dragOverMsgs++;
			return;
		}
		if ( isDragLeaveMsg( e.data ) ) {
			stashedBridgePayload = null;
			_debugCounters.dragLeaveMsgs++;
			return;
		}
		if ( ! isDropMsg( e.data ) ) {
			return;
		}
		// Explicit `desktop-mode-drop` (DragManager-driven path —
		// shell-side tile dropped on this iframe's overlay).
		stashedBridgePayload = null;
		void performInsert( e.data.payload ).catch( ( err: unknown ) => {
			const reason = err instanceof Error ? err.message : String( err );
			// eslint-disable-next-line no-console
			console.error(
				'[desktop-mode] Gutenberg drop receiver insert failed:',
				err,
			);
			notifyParentOfFailure( reason );
		} );
	} );

	// Attach now (covers the outer post.php iframe + any sub-
	// iframes already in the DOM at script-run time). Then mount a
	// MutationObserver so any iframe Gutenberg adds later (its
	// editor-canvas iframe lands on first paint, sometimes after
	// our boot) is picked up. Also re-walk on iframe `load` since
	// reloading a nested iframe replaces its document and clears
	// our sentinel.
	attachToAllFrames();
	if ( typeof MutationObserver !== 'undefined' && document.documentElement ) {
		new MutationObserver( () => attachToAllFrames() ).observe(
			document.documentElement,
			{ childList: true, subtree: true },
		);
	}
	document.addEventListener(
		'load',
		( e: Event ) => {
			if ( e.target instanceof HTMLIFrameElement ) {
				attachToAllFrames();
			}
		},
		true,
	);

	// Diagnostic surface — paste `window.__desktopModeDropReceiverDebug()`
	// in DevTools (inside the post.php iframe) to inspect.
	type DebugWindow = Window & {
		__desktopModeDropReceiverDebug?: () => Record< string, unknown >;
	};
	( window as DebugWindow ).__desktopModeDropReceiverDebug = () => ( {
		..._debugCounters,
		hasStash: stashedBridgePayload !== null,
		stashKind: stashedBridgePayload?.kind ?? null,
		iframesNow: document.querySelectorAll( 'iframe' ).length,
	} );
}

install();
