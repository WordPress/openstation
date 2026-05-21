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
	// silently inserting a dead link.
	if ( ! payload.url ) {
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

// ---------------------------------------------------------------------
// Message wiring.
// ---------------------------------------------------------------------

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

function install(): void {
	const expectedOrigin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== expectedOrigin ) {
			return;
		}
		if ( ! isDropMsg( e.data ) ) {
			return;
		}
		void performInsert( e.data.payload ).catch( ( err ) => {
			// eslint-disable-next-line no-console
			console.error(
				'[desktop-mode] Gutenberg drop receiver insert failed:',
				err,
			);
		} );
	} );
}

install();
