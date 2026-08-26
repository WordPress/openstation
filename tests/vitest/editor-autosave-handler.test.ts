/**
 * Tests for the iframe-side editor-autosave answerer
 * (`installEditorAutosaveHandler` in
 * `src/iframe-bridge-standalone.ts`) — the handler that answers the
 * shell's `os-editor-autosave-request` while the
 * editor-preview companion window opens in parallel.
 *
 * Strategy: install the handler in the jsdom top frame (where
 * `window.parent === window`, so responses post back onto the same
 * window and can be captured with a plain message listener), fake
 * `window.wp` per scenario, and drive it with synthetic
 * `MessageEvent`s.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installEditorAutosaveHandler } from '../../src/iframe-bridge-standalone';

interface AutosaveResponse {
	type: string;
	requestId: string;
	status: string;
	previewUrl?: string;
}

interface LiveSavedMessage {
	type: string;
	watchId: string;
	previewUrl?: string;
}

let responses: AutosaveResponse[];
let liveSaves: LiveSavedMessage[];
let collector: ( ev: MessageEvent ) => void;
let counter = 0;

function sendRequest( requestId: string ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin: window.location.origin,
			data: { type: 'os-editor-autosave-request', requestId },
		} ),
	);
}

function sendWatch( watchId: string, debounceMs = 500 ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin: window.location.origin,
			data: {
				type: 'os-editor-live-watch',
				watchId,
				debounceMs,
			},
		} ),
	);
}

function sendUnwatch( watchId: string ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin: window.location.origin,
			data: { type: 'os-editor-live-unwatch', watchId },
		} ),
	);
}

/**
 * A fake Gutenberg store rig: subscribers fire on `notify()`, block
 * and title edits are simulated by swapping the tracked references.
 * `dirty` / `autosaveable` / `saving` knobs drive the watcher's
 * feedback-loop guards.
 */
function fakeGutenberg() {
	const subscribers: Array< () => void > = [];
	let blocks: unknown = [];
	let title = 'Hello';
	const state = { dirty: true, autosaveable: true, saving: false };
	const saveForPreview = vi.fn( () =>
		Promise.resolve( `${ window.location.origin }/?p=9&preview=true` ),
	);
	( window as unknown as { wp: unknown } ).wp = {
		data: {
			select: ( store: string ) => {
				if ( store === 'core/editor' ) {
					return {
						isSavingPost: () => state.saving,
						isAutosavingPost: () => false,
						isEditedPostDirty: () => state.dirty,
						isEditedPostAutosaveable: () => state.autosaveable,
						getEditedPostAttribute: ( attr: string ) =>
							attr === 'title' ? title : undefined,
					};
				}
				if ( store === 'core/block-editor' ) {
					return { getBlocks: () => blocks };
				}
				return undefined;
			},
			dispatch: ( store: string ) =>
				store === 'core/editor'
					? { __unstableSaveForPreview: saveForPreview }
					: undefined,
			subscribe: ( cb: () => void ) => {
				subscribers.push( cb );
				return () => {
					const i = subscribers.indexOf( cb );
					if ( i >= 0 ) {
						subscribers.splice( i, 1 );
					}
				};
			},
		},
	};
	return {
		saveForPreview,
		state,
		notify: () => subscribers.forEach( ( cb ) => cb() ),
		editBlocks: () => {
			blocks = [ { fresh: Math.random() } ];
		},
		editTitle: ( next: string ) => {
			title = next;
		},
	};
}

/** Wait until a response for the given request id was captured. */
async function responseFor( requestId: string ): Promise< AutosaveResponse > {
	await vi.waitFor( () => {
		if ( ! responses.some( ( r ) => r.requestId === requestId ) ) {
			throw new Error( 'no response yet' );
		}
	} );
	return responses.find( ( r ) => r.requestId === requestId )!;
}

beforeEach( () => {
	counter += 1;
	responses = [];
	liveSaves = [];
	collector = ( ev: MessageEvent ) => {
		const data = ev?.data as
			| ( AutosaveResponse & LiveSavedMessage )
			| null;
		if ( data?.type === 'os-editor-autosave-response' ) {
			responses.push( data );
		}
		if ( data?.type === 'os-editor-live-saved' ) {
			liveSaves.push( data );
		}
	};
	window.addEventListener( 'message', collector );
	installEditorAutosaveHandler();
} );

afterEach( () => {
	window.removeEventListener( 'message', collector );
	delete ( window as unknown as { wp?: unknown } ).wp;
	// The handler's listener stays installed (its dedupe flag persists
	// across tests by design — same as a real page) — that's fine, the
	// per-test request ids keep responses distinguishable.
	vi.restoreAllMocks();
	vi.useRealTimers();
} );

describe( 'installEditorAutosaveHandler', () => {
	test( 'answers no-editor immediately when no editor is present', async () => {
		const id = `req-${ counter }-a`;
		sendRequest( id );

		expect( ( await responseFor( id ) ).status ).toBe( 'no-editor' );
	} );

	test( 'Gutenberg: __unstableSaveForPreview resolves to saved + its link', async () => {
		const link = `${ window.location.origin }/?p=1&preview=true`;
		( window as unknown as { wp: unknown } ).wp = {
			data: {
				select: ( store: string ) =>
					store === 'core/editor' ? {} : undefined,
				dispatch: ( store: string ) =>
					store === 'core/editor'
						? {
								__unstableSaveForPreview: () =>
									Promise.resolve( link ),
						  }
						: undefined,
			},
		};

		const id = `req-${ counter }-b`;
		sendRequest( id );
		const response = await responseFor( id );

		expect( response.status ).toBe( 'saved' );
		expect( response.previewUrl ).toBe( link );
	} );

	test( 'Gutenberg: a rejected save-for-preview answers error', async () => {
		( window as unknown as { wp: unknown } ).wp = {
			data: {
				select: () => ( {} ),
				dispatch: () => ( {
					__unstableSaveForPreview: () =>
						Promise.reject( new Error( 'nope' ) ),
				} ),
			},
		};

		const id = `req-${ counter }-c`;
		sendRequest( id );

		expect( ( await responseFor( id ) ).status ).toBe( 'error' );
	} );

	test( 'Gutenberg fallback: not autosaveable answers not-dirty', async () => {
		( window as unknown as { wp: unknown } ).wp = {
			data: {
				select: () => ( {
					isEditedPostAutosaveable: () => false,
				} ),
				dispatch: () => ( {} ),
				subscribe: () => () => undefined,
			},
		};

		const id = `req-${ counter }-d`;
		sendRequest( id );

		expect( ( await responseFor( id ) ).status ).toBe( 'not-dirty' );
	} );

	test( 'Gutenberg fallback: autosave() watched to completion answers saved', async () => {
		let autosaving = false;
		let notify: () => void = () => undefined;
		( window as unknown as { wp: unknown } ).wp = {
			data: {
				select: () => ( {
					isEditedPostAutosaveable: () => true,
					isAutosavingPost: () => autosaving,
				} ),
				dispatch: () => ( {
					autosave: () => {
						autosaving = true;
						notify();
						autosaving = false;
						notify();
					},
				} ),
				subscribe: ( cb: () => void ) => {
					notify = cb;
					return () => {
						notify = () => undefined;
					};
				},
			},
		};

		const id = `req-${ counter }-e`;
		sendRequest( id );

		expect( ( await responseFor( id ) ).status ).toBe( 'saved' );
	} );

	test( 'classic editor: triggerSave + after-autosave answers saved', async () => {
		const triggerSave = vi.fn();
		let afterAutosave: ( () => void ) | null = null;
		( window as unknown as { wp: unknown } ).wp = {
			autosave: { server: { triggerSave } },
		};
		( window as unknown as { jQuery: unknown } ).jQuery = () => ( {
			one: ( _evt: string, cb: () => void ) => {
				afterAutosave = cb;
			},
		} );

		const id = `req-${ counter }-f`;
		sendRequest( id );
		expect( triggerSave ).toHaveBeenCalledTimes( 1 );
		expect(
			responses.some( ( r ) => r.requestId === id ),
		).toBe( false );

		afterAutosave!();
		const response = await responseFor( id );
		expect( response.status ).toBe( 'saved' );

		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	test( 'classic editor: a silent core bail answers not-dirty, not saved', async () => {
		// Regression, confirmed in a real browser against a real
		// WooCommerce product: core's `save()` returns early when
		// `compareString === lastCompareString`, so no request goes out
		// and `after-autosave` never fires. The 5 s backstop used to
		// answer 'saved' anyway, and the shell refreshed the preview
		// companion ~5.4 s after the eye click — late enough to look
		// like it was caused by whatever the user clicked next, which
		// is exactly how it was reported.
		vi.useFakeTimers();
		const triggerSave = vi.fn();
		( window as unknown as { wp: unknown } ).wp = {
			autosave: { server: { triggerSave } },
		};
		( window as unknown as { jQuery: unknown } ).jQuery = () => ( {
			// Core never fires it — the handler is registered and
			// simply never invoked.
			one: () => undefined,
		} );

		const id = `req-${ counter }-bail`;
		sendRequest( id );
		expect( triggerSave ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( 5000 );
		const response = await responseFor( id );
		expect( response.status ).toBe( 'not-dirty' );

		delete ( window as unknown as { jQuery?: unknown } ).jQuery;
	} );

	test( 'classic editor: without jQuery the backstop still answers saved', async () => {
		// Nothing can observe the round-trip there, so assuming a write
		// happened is the safe default. (Classic wp-admin always ships
		// jQuery — `autosave.js` depends on it — so this is a
		// formality, but the two branches must not be conflated.)
		vi.useFakeTimers();
		const triggerSave = vi.fn();
		( window as unknown as { wp: unknown } ).wp = {
			autosave: { server: { triggerSave } },
		};
		delete ( window as unknown as { jQuery?: unknown } ).jQuery;

		const id = `req-${ counter }-nojq`;
		sendRequest( id );
		vi.advanceTimersByTime( 5000 );
		expect( ( await responseFor( id ) ).status ).toBe( 'saved' );
	} );

	test( 'a cross-origin previewUrl is dropped from the response', async () => {
		( window as unknown as { wp: unknown } ).wp = {
			data: {
				select: () => ( {} ),
				dispatch: () => ( {
					__unstableSaveForPreview: () =>
						Promise.resolve( 'https://evil.example/?p=1' ),
				} ),
			},
		};

		const id = `req-${ counter }-g`;
		sendRequest( id );
		const response = await responseFor( id );

		expect( response.status ).toBe( 'saved' );
		expect( response.previewUrl ).toBeUndefined();
	} );

	test( 'ignores messages from a foreign origin', async () => {
		const id = `req-${ counter }-h`;
		window.dispatchEvent(
			new MessageEvent( 'message', {
				origin: 'https://evil.example',
				data: {
					type: 'os-editor-autosave-request',
					requestId: id,
				},
			} ),
		);

		await new Promise( ( r ) => setTimeout( r, 20 ) );
		expect( responses.some( ( r ) => r.requestId === id ) ).toBe( false );
	} );
} );

describe( 'live-preview watch', () => {
	/**
	 * Flush the microtask chain after advancing fake timers, then run
	 * zero-delay timers once more — jsdom delivers `postMessage` via a
	 * queued zero-delay task, which fake timers would otherwise hold.
	 */
	async function flush() {
		for ( let i = 0; i < 4; i++ ) {
			await Promise.resolve();
		}
		vi.advanceTimersByTime( 0 );
		for ( let i = 0; i < 2; i++ ) {
			await Promise.resolve();
		}
	}

	test( 'a block edit triggers a debounced autosave + live-saved', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-a`;
		sendWatch( watchId, 500 );

		gutenberg.editBlocks();
		gutenberg.notify();

		expect( liveSaves ).toHaveLength( 0 );
		vi.advanceTimersByTime( 500 );
		await flush();

		expect( gutenberg.saveForPreview ).toHaveBeenCalledTimes( 1 );
		expect( liveSaves ).toHaveLength( 1 );
		expect( liveSaves[ 0 ].watchId ).toBe( watchId );
		expect( liveSaves[ 0 ].previewUrl ).toContain( 'preview=true' );

		sendUnwatch( watchId );
	} );

	test( 'its own autosave never reads as a fresh edit (no loop)', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-b`;
		sendWatch( watchId, 500 );

		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 500 );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );

		// Store settles after the autosave — subscribers fire, but the
		// block/title references are unchanged.
		gutenberg.notify();
		gutenberg.notify();
		vi.advanceTimersByTime( 5000 );
		await flush();

		expect( liveSaves ).toHaveLength( 1 );
		sendUnwatch( watchId );
	} );

	test( 'continuous typing pushes the settle window out', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c`;
		sendWatch( watchId, 500 );

		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 300 );
		gutenberg.editTitle( 'Hello w' );
		gutenberg.notify();
		vi.advanceTimersByTime( 300 );
		await flush();
		expect( liveSaves ).toHaveLength( 0 );

		vi.advanceTimersByTime( 200 );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );
		sendUnwatch( watchId );
	} );

	test( 'unwatch cancels a pending settle', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-d`;
		sendWatch( watchId, 500 );

		gutenberg.editBlocks();
		gutenberg.notify();
		sendUnwatch( watchId );
		vi.advanceTimersByTime( 5000 );
		await flush();

		expect( gutenberg.saveForPreview ).not.toHaveBeenCalled();
		expect( liveSaves ).toHaveLength( 0 );
	} );

	test( 'save-driven churn is absorbed — no schedule while saving or on the settle tick', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-e2`;
		sendWatch( watchId, 500 );

		// A save round-trip resyncs the entity: refs churn while
		// `isSavingPost()` is true, and once more on the settle tick.
		gutenberg.state.saving = true;
		gutenberg.editBlocks();
		gutenberg.notify();
		gutenberg.state.saving = false;
		gutenberg.editBlocks();
		gutenberg.notify(); // Settle tick — churn absorbed.
		vi.advanceTimersByTime( 5000 );
		await flush();

		expect( gutenberg.saveForPreview ).not.toHaveBeenCalled();
		expect( liveSaves ).toHaveLength( 0 );
		sendUnwatch( watchId );
	} );

	test( 'ref churn on a clean (not dirty) post never schedules', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-f2`;
		sendWatch( watchId, 500 );

		// A draft's completed in-place autosave: post is clean, but
		// normalization churned the refs.
		gutenberg.state.dirty = false;
		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 5000 );
		await flush();

		expect( gutenberg.saveForPreview ).not.toHaveBeenCalled();
		expect( liveSaves ).toHaveLength( 0 );
		sendUnwatch( watchId );
	} );

	test( 'a settle with nothing to autosave saves nothing and posts no refresh', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-g2`;
		sendWatch( watchId, 500 );

		// Published post right after an autosave revision: dirty
		// relative to published content, but nothing new to autosave.
		gutenberg.state.autosaveable = false;
		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 5000 );
		await flush();

		expect( gutenberg.saveForPreview ).not.toHaveBeenCalled();
		expect( liveSaves ).toHaveLength( 0 );
		sendUnwatch( watchId );
	} );

	test( 'a second edit after a completed save fires a second live save', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-i2`;
		sendWatch( watchId, 500 );

		// Edit #1 → settle → save #1.
		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 500 );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );

		// Save round-trip churn: refs churn while saving, once more
		// on the settle tick. (Published post: dirty stays true.)
		gutenberg.state.saving = true;
		gutenberg.editBlocks();
		gutenberg.notify();
		gutenberg.state.saving = false;
		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 5000 );
		await flush();
		expect( gutenberg.saveForPreview ).toHaveBeenCalledTimes( 1 );

		// Edit #2 → settle → save #2. This is the user-visible
		// contract: the preview keeps tracking the typing for the
		// whole life of the pairing, not just the first pause.
		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 500 );
		await flush();
		expect( gutenberg.saveForPreview ).toHaveBeenCalledTimes( 2 );
		expect( liveSaves ).toHaveLength( 2 );

		sendUnwatch( watchId );
	} );

	test( 'a real edit still saves exactly once after the loop guards', async () => {
		const gutenberg = fakeGutenberg();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-h2`;
		sendWatch( watchId, 500 );

		gutenberg.editBlocks();
		gutenberg.notify();
		vi.advanceTimersByTime( 500 );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );

		// The completed save churns refs while saving + on settle;
		// then the store goes quiet. No second save may fire.
		gutenberg.state.saving = true;
		gutenberg.editBlocks();
		gutenberg.notify();
		gutenberg.state.saving = false;
		gutenberg.state.dirty = false;
		gutenberg.editBlocks();
		gutenberg.notify();
		gutenberg.notify();
		vi.advanceTimersByTime( 10000 );
		await flush();

		expect( gutenberg.saveForPreview ).toHaveBeenCalledTimes( 1 );
		expect( liveSaves ).toHaveLength( 1 );
		sendUnwatch( watchId );
	} );
} );

describe( 'live-preview watch — classic editor', () => {
	interface TinyStubEditor {
		on: ReturnType< typeof vi.fn >;
		off: ReturnType< typeof vi.fn >;
		getContent: () => string;
		isHidden: () => boolean;
		fireEdit: () => void;
		/** Change what the editor serializes — a real user edit. */
		setBody: ( body: string ) => void;
	}

	function tinyStubEditor(): TinyStubEditor {
		let cb: ( () => void ) | null = null;
		let body = 'v1';
		return {
			on: vi.fn( ( _evts: string, handler: () => void ) => {
				cb = handler;
			} ),
			off: vi.fn(),
			getContent: () => body,
			isHidden: () => false,
			fireEdit: () => cb?.(),
			setBody: ( next: string ) => {
				body = next;
			},
		};
	}

	/**
	 * A fake classic-editor page: `wp.autosave.server.triggerSave`
	 * spy, a namespace-aware-enough jQuery stub for the
	 * before/after-autosave events, the #title and #content fields,
	 * and an optional TinyMCE rig.
	 */
	function fakeClassic( { tinymce }: { tinymce?: boolean } = {} ) {
		const triggerSave = vi.fn();
		const handlers = new Map< string, Array< () => void > >();
		( window as unknown as { wp: unknown } ).wp = {
			autosave: { server: { triggerSave } },
		};
		( window as unknown as { jQuery: unknown } ).jQuery = () => ( {
			on: ( evt: string, cb: () => void ) => {
				handlers.set( evt, [ ...( handlers.get( evt ) ?? [] ), cb ] );
			},
			off: ( evt: string ) => {
				handlers.delete( evt );
			},
		} );

		const title = document.createElement( 'input' );
		title.id = 'title';
		const content = document.createElement( 'textarea' );
		content.id = 'content';
		document.body.append( title, content );

		let tiny: {
			editors: TinyStubEditor[];
			get: ( id: string ) => TinyStubEditor | null;
			on: ReturnType< typeof vi.fn >;
			off: ReturnType< typeof vi.fn >;
		} | null = null;
		let editor: TinyStubEditor | null = null;
		if ( tinymce ) {
			editor = tinyStubEditor();
			const byId = editor;
			tiny = {
				editors: [ editor ],
				get: ( id: string ) => ( id === 'content' ? byId : null ),
				on: vi.fn(),
				off: vi.fn(),
			};
			( window as unknown as { tinymce: unknown } ).tinymce = tiny;
		}

		return {
			triggerSave,
			handlers,
			title,
			content,
			editor,
			tiny,
			/**
			 * A real user edit — what the editor serializes changes.
			 * Without TinyMCE the raw textarea is authoritative.
			 */
			edit( body: string ) {
				if ( editor ) {
					editor.setBody( body );
				} else {
					content.value = body;
				}
			},
			/** Fire a jQuery event by base name across namespaces. */
			fire( evt: string ) {
				for ( const [ name, cbs ] of handlers ) {
					if ( name === evt || name.startsWith( `${ evt }.` ) ) {
						cbs.forEach( ( cb ) => cb() );
					}
				}
			},
			cleanup() {
				title.remove();
				content.remove();
				delete ( window as unknown as { jQuery?: unknown } ).jQuery;
				delete ( window as unknown as { tinymce?: unknown } )
					.tinymce;
			},
		};
	}

	async function flush() {
		for ( let i = 0; i < 4; i++ ) {
			await Promise.resolve();
		}
		vi.advanceTimersByTime( 0 );
		for ( let i = 0; i < 2; i++ ) {
			await Promise.resolve();
		}
	}

	test( 'typing in a field debounces into a forced autosave + live-saved', async () => {
		const classic = fakeClassic();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c1`;
		sendWatch( watchId, 500 );
		await flush();

		classic.title.value = 'Typed';
		classic.title.dispatchEvent(
			new Event( 'input', { bubbles: true } ),
		);
		expect( classic.triggerSave ).not.toHaveBeenCalled();
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).toHaveBeenCalledTimes( 1 );

		// The autosave round-trip lands — the watch announces it.
		classic.fire( 'before-autosave' );
		classic.fire( 'after-autosave' );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );
		expect( liveSaves[ 0 ].watchId ).toBe( watchId );

		sendUnwatch( watchId );
		classic.cleanup();
	} );

	test( 'a settle during an in-flight autosave retries instead of dropping', async () => {
		const classic = fakeClassic();
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c2`;
		sendWatch( watchId, 500 );
		await flush();

		// Core starts its own autosave; typing settles mid-flight —
		// core would silently drop a triggerSave here (_blockSave).
		classic.fire( 'before-autosave' );
		classic.content.value = 'typed mid-flight';
		classic.content.dispatchEvent(
			new Event( 'input', { bubbles: true } ),
		);
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).not.toHaveBeenCalled();

		// Still in flight after the retry window — keeps waiting.
		vi.advanceTimersByTime( 1000 );
		expect( classic.triggerSave ).not.toHaveBeenCalled();

		// The in-flight save lands, then the retry forces ours.
		classic.fire( 'after-autosave' );
		vi.advanceTimersByTime( 1000 );
		expect( classic.triggerSave ).toHaveBeenCalledTimes( 1 );

		sendUnwatch( watchId );
		classic.cleanup();
	} );

	test( 'TinyMCE edits schedule, including editors added later', async () => {
		const classic = fakeClassic( { tinymce: true } );
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c3`;
		sendWatch( watchId, 500 );
		await flush();

		classic.edit( 'v2' );
		classic.editor!.fireEdit();
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).toHaveBeenCalledTimes( 1 );

		// A visual↔text switch re-initializes the editor — the
		// AddEditor hook binds the newcomer.
		const addEditor = classic.tiny!.on.mock.calls.find(
			( c ) => c[ 0 ] === 'AddEditor',
		)![ 1 ] as ( e: { editor?: TinyStubEditor } ) => void;
		const late = tinyStubEditor();
		addEditor( { editor: late } );
		classic.edit( 'v3' );
		late.fireEdit();
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).toHaveBeenCalledTimes( 2 );

		sendUnwatch( watchId );
		classic.cleanup();
	} );

	test( 'a settle with unchanged content never reaches the server', async () => {
		// Regression: TinyMCE fires `change` when it adds an undo
		// level on BLUR, so merely clicking from the product editor
		// into the preview window scheduled a settle — which forced an
		// autosave, which announced, which swapped the companion's
		// frame out from under the user.
		const classic = fakeClassic( { tinymce: true } );
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c5`;
		sendWatch( watchId, 500 );
		await flush();

		classic.editor!.fireEdit(); // Blur-driven, content untouched.
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).not.toHaveBeenCalled();

		// A real edit still gets through.
		classic.edit( 'v2' );
		classic.editor!.fireEdit();
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).toHaveBeenCalledTimes( 1 );

		sendUnwatch( watchId );
		classic.cleanup();
	} );

	test( "core's own autosave of unchanged content is not announced", async () => {
		// The one that actually bit: clicking back into the editor
		// wakes core's heartbeat, whose `getPostData()` calls
		// `editor.save()` and re-serializes TinyMCE into `#content`.
		// On markup core didn't write that string differs from the
		// stored one, so core's own compare-string gate passes and the
		// autosave goes out — for a post the user never touched. The
		// fingerprint reads `getContent()` instead, which that
		// re-serialization does not move.
		const classic = fakeClassic( { tinymce: true } );
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c6`;
		sendWatch( watchId, 500 );
		await flush();

		// Core writes `#content` on its way out — the fingerprint must
		// not follow it.
		classic.content.value = '<p>re-serialized by editor.save()</p>';
		classic.fire( 'before-autosave' );
		classic.fire( 'after-autosave' );
		await flush();
		expect( liveSaves ).toHaveLength( 0 );

		// The same round-trip carrying NEW content the user actually
		// typed does announce.
		classic.edit( 'v2' );
		classic.editor!.fireEdit();
		classic.fire( 'before-autosave' );
		classic.fire( 'after-autosave' );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );
		expect( liveSaves[ 0 ].watchId ).toBe( watchId );

		sendUnwatch( watchId );
		classic.cleanup();
	} );

	test( 'the FIRST refocus autosave of a session is not announced', async () => {
		// Regression: eye → click into the preview → click back into
		// the editor reloaded the preview exactly once, then behaved
		// forever after. The baseline is seeded when the watch starts,
		// before core has ever called `getPostData()` on the page —
		// and that call's `editor.save()` fires TinyMCE's SaveContent,
		// which WordPress's own handlers use to rewrite the DOM. So
		// the first round-trip serialized differently from the seed
		// through no user action, announced, and re-baselined.
		const classic = fakeClassic( { tinymce: true } );
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c8`;
		sendWatch( watchId, 500 );
		await flush();

		// Core's refocus tick re-serializes the DOM on its way out,
		// with no edit event behind it.
		classic.edit( '<p>v1</p>' );
		classic.fire( 'before-autosave' );
		classic.fire( 'after-autosave' );
		await flush();
		expect( liveSaves ).toHaveLength( 0 );

		// And a genuine edit after that still announces.
		classic.edit( '<p>v1 plus typing</p>' );
		classic.editor!.fireEdit();
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).toHaveBeenCalledTimes( 1 );
		classic.fire( 'before-autosave' );
		classic.fire( 'after-autosave' );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );

		sendUnwatch( watchId );
		classic.cleanup();
	} );

	test( 'an edit typed mid-round-trip still gets its own save', async () => {
		// `announced` tracks the fingerprint captured at SEND time. If
		// it adopted the on-arrival content instead, a keystroke that
		// landed during the round-trip would be folded into the
		// baseline and its settle would go silent — the preview would
		// permanently lag the editor by one edit.
		const classic = fakeClassic( { tinymce: true } );
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c7`;
		sendWatch( watchId, 500 );
		await flush();

		classic.edit( 'v2' );
		classic.editor!.fireEdit();
		classic.fire( 'before-autosave' );
		classic.edit( 'v3' ); // Typed while v2 was on the wire.
		classic.editor!.fireEdit();
		classic.fire( 'after-autosave' );
		await flush();
		expect( liveSaves ).toHaveLength( 1 );

		// v3 is still unannounced, so its settle must reach the server
		// rather than finding the baseline already equal to it.
		vi.advanceTimersByTime( 500 );
		expect( classic.triggerSave ).toHaveBeenCalledTimes( 1 );

		sendUnwatch( watchId );
		classic.cleanup();
	} );

	test( 'unwatch cancels the settle and detaches every listener', async () => {
		const classic = fakeClassic( { tinymce: true } );
		vi.useFakeTimers();
		const watchId = `watch-${ counter }-c4`;
		sendWatch( watchId, 500 );
		await flush();

		classic.title.dispatchEvent(
			new Event( 'input', { bubbles: true } ),
		);
		sendUnwatch( watchId );
		vi.advanceTimersByTime( 5000 );
		expect( classic.triggerSave ).not.toHaveBeenCalled();

		// jQuery handlers gone; typing after unwatch never schedules.
		expect( classic.handlers.size ).toBe( 0 );
		classic.title.dispatchEvent(
			new Event( 'input', { bubbles: true } ),
		);
		vi.advanceTimersByTime( 5000 );
		expect( classic.triggerSave ).not.toHaveBeenCalled();
		expect( classic.editor!.off ).toHaveBeenCalled();
		expect( classic.tiny!.off ).toHaveBeenCalledWith(
			'AddEditor',
			expect.any( Function ),
		);

		classic.cleanup();
	} );
} );
