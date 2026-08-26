/**
 * OpenStation — Gutenberg drop receiver (iframe-side bundle).
 *
 * Loaded only inside `post.php` / `post-new.php` chromeless iframes
 * (PHP enqueue keyed on `current_screen()->base`). Listens for
 * `os-drop` postMessages from the parent shell —
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
	type: 'os-drop';
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
			{ type: 'os-drop-failed', reason },
			window.location.origin,
		);
	} catch {
		// Cross-origin parent — nothing we can do.
	}
}

// ---------------------------------------------------------------------
// Message wiring.
// ---------------------------------------------------------------------

function isDropMsg( m: unknown ): m is DropMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	const obj = m as { type?: unknown; payload?: unknown };
	if ( obj.type !== 'os-drop' ) {
		return false;
	}
	const p = obj.payload as { kind?: unknown } | undefined;
	if ( ! p || typeof p !== 'object' ) {
		return false;
	}
	return p.kind === 'attachment' || p.kind === 'post' || p.kind === 'user';
}

/**
 * Latest bridge payload broadcast from the parent shell while a
 * cross-frame drag is in flight. Set on `os-drag-over`,
 * cleared on `-drag-leave` or after a successful insert.
 *
 * The native HTML5 backstop below uses it to insert the right block
 * when Chromium strips the custom `application/x-wp-media-attachment`
 * MIME at the iframe boundary (so Gutenberg's own drop logic doesn't
 * recognise the payload). Pure postMessage handling isn't enough in
 * practice — when the parent's pointer-events suppression doesn't
 * take effect mid-drag, the drop fires INSIDE the canvas iframe and
 * never reaches the parent's `onBridgeDrop`. This stash + native
 * handler is the iframe-side catch.
 */
let stashedBridgePayload: DragBridgePayload | null = null;

/** Sentinel on `Document` so `attachToDocument` is idempotent. */
interface AttachedDocSentinel extends Document {
	__openStationDropReceiverAttached?: boolean;
}

/**
 * Whether the drag carries OS files. The Media Library legacy patch
 * uses `application/x-wp-media-attachment`, NOT `Files`; an OS file
 * drag from Finder / Explorer / Linux DEs always carries `Files`.
 * The guard lets the native handler ignore OS drops so Gutenberg's
 * own canvas dropzone handles them natively (upload + insert).
 */
function dragCarriesOsFiles( e: DragEvent ): boolean {
	const types = e.dataTransfer?.types;
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

interface DragOverMsg {
	type: 'os-drag-over';
	payload: DragBridgePayload;
}

interface DragLeaveMsg {
	type: 'os-drag-leave';
}

function isDragOverMsg( m: unknown ): m is DragOverMsg {
	if ( ! m || typeof m !== 'object' ) {
		return false;
	}
	const obj = m as { type?: unknown; payload?: unknown };
	if ( obj.type !== 'os-drag-over' ) {
		return false;
	}
	const p = obj.payload as { kind?: unknown } | undefined;
	if ( ! p || typeof p !== 'object' ) {
		return false;
	}
	return p.kind === 'attachment' || p.kind === 'post' || p.kind === 'user';
}

function isDragLeaveMsg( m: unknown ): m is DragLeaveMsg {
	return (
		!! m &&
		typeof m === 'object' &&
		( m as { type?: unknown } ).type === 'os-drag-leave'
	);
}

function onNativeDragOver( e: DragEvent ): void {
	if ( ! stashedBridgePayload ) {
		return;
	}
	if ( dragCarriesOsFiles( e ) ) {
		// OS file drop — Gutenberg's own dropzone handles upload +
		// insert natively. Don't claim the dragover; let the bubble-
		// phase handler do its thing.
		return;
	}
	e.preventDefault();
	if ( e.dataTransfer ) {
		e.dataTransfer.dropEffect = 'copy';
	}
}

function onNativeDrop( e: DragEvent ): void {
	if ( ! stashedBridgePayload ) {
		return;
	}
	if ( dragCarriesOsFiles( e ) ) {
		// OS file drop. Discard any stale stash (a previous bridge
		// drag whose `drag-leave` never landed) so the next real
		// bridge drop doesn't see ghost state, then yield to
		// Gutenberg's native handler.
		stashedBridgePayload = null;
		return;
	}
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
			'[openstation] Gutenberg drop receiver native-drop insert failed:',
			err,
		);
		notifyParentOfFailure( reason );
	} );
}

/**
 * Attach the native HTML5 drop + dragover capture-phase listeners
 * to a Document. Idempotent — each document is marked with a
 * sentinel so repeated walks don't pile up listeners.
 *
 * We attach to the receiver's own document (post.php iframe) AND to
 * every same-origin nested iframe document — including Gutenberg's
 * editor-canvas iframe, which is where the real drop event fires
 * when the user releases over a block. The Files guard above keeps
 * these listeners inert for OS file drops so Gutenberg's own
 * canvas-iframe dropzone handles them.
 */
function attachToDocument( doc: Document ): void {
	const sentinel = doc as AttachedDocSentinel;
	if ( sentinel.__openStationDropReceiverAttached ) {
		return;
	}
	sentinel.__openStationDropReceiverAttached = true;
	doc.addEventListener( 'drop', onNativeDrop, true );
	doc.addEventListener( 'dragover', onNativeDragOver, true );
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
		// Bridge `drag-over` — stash the payload for the native
		// backstop below. The parent shell broadcasts this on
		// `onBridgeDragOver` while a bridge session is live.
		if ( isDragOverMsg( e.data ) ) {
			stashedBridgePayload = e.data.payload;
			return;
		}
		if ( isDragLeaveMsg( e.data ) ) {
			stashedBridgePayload = null;
			return;
		}
		if ( ! isDropMsg( e.data ) ) {
			return;
		}
		// Explicit `os-drop` (parent's `onBridgeDrop`
		// succeeded — pointer-events suppression routed the drop to
		// the parent doc). Clear any stash so the native backstop
		// doesn't double-fire on the same drop.
		stashedBridgePayload = null;
		void performInsert( e.data.payload ).catch( ( err: unknown ) => {
			const reason = err instanceof Error ? err.message : String( err );
			// eslint-disable-next-line no-console
			console.error(
				'[openstation] Gutenberg drop receiver insert failed:',
				err,
			);
			notifyParentOfFailure( reason );
		} );
	} );

	// Native HTML5 backstop. Catches the in-iframe drop when the
	// parent's pointer-events suppression didn't take effect mid-
	// drag — Chromium strips the custom MIME at the iframe boundary
	// so Gutenberg's own dropzone can't read the attachment, and
	// without this handler the drop is silently lost.
	attachToAllFrames();
	if ( typeof MutationObserver !== 'undefined' && document.documentElement ) {
		new MutationObserver( ( records ) => {
			// Cheap mutation filter — only re-walk if an `iframe`
			// was actually added. Gutenberg mutates the DOM heavily
			// during editing; an unconditional re-walk per mutation
			// would walk every iframe on every keystroke.
			for ( const r of records ) {
				for ( const node of Array.from( r.addedNodes ) ) {
					if (
						node instanceof HTMLIFrameElement ||
						( node instanceof Element &&
							node.querySelector?.( 'iframe' ) )
					) {
						attachToAllFrames();
						return;
					}
				}
			}
		} ).observe( document.documentElement, {
			childList: true,
			subtree: true,
		} );
	}
	// Re-walk on iframe `load` — a srcdoc reload replaces the
	// iframe's document and clears the sentinel.
	document.addEventListener(
		'load',
		( e: Event ) => {
			if ( e.target instanceof HTMLIFrameElement ) {
				attachToAllFrames();
			}
		},
		true,
	);
}

install();
