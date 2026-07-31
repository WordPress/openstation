/**
 * Tests for the iframe-side editor-autosave answerer
 * (`installEditorAutosaveHandler` in
 * `src/iframe-bridge-standalone.ts`) — the handler that answers the
 * shell's `desktop-mode-editor-autosave-request` before the
 * editor-preview companion window opens.
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
			data: { type: 'desktop-mode-editor-autosave-request', requestId },
		} ),
	);
}

function sendWatch( watchId: string, debounceMs = 500 ): void {
	window.dispatchEvent(
		new MessageEvent( 'message', {
			origin: window.location.origin,
			data: {
				type: 'desktop-mode-editor-live-watch',
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
			data: { type: 'desktop-mode-editor-live-unwatch', watchId },
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
		if ( data?.type === 'desktop-mode-editor-autosave-response' ) {
			responses.push( data );
		}
		if ( data?.type === 'desktop-mode-editor-live-saved' ) {
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
					type: 'desktop-mode-editor-autosave-request',
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
