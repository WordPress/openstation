/**
 * The palette runtime must be retried on a later ⌘K.
 *
 * `ensureCommandPaletteAssets()` clears its memo when a load fails, so
 * that the next open can retry a flaky connection. That retry never
 * happened: its only caller sat inside `AiAssistantStub._ensure()`,
 * behind a `_loadPromise` guard that is set once and never cleared. One
 * 404 among the ~50 replayed scripts and the palette showed shell
 * commands only — no WP baseline, no hoisted plugin contributors — for
 * the rest of the session, with a single console.warn to show for it.
 *
 * And it must wait for the panel. Started alongside the impl bundle,
 * the ~50 preloaded runtime scripts took the whole connection, and on
 * a slow link the placeholder stayed up for as long as all of them took
 * to download.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as paletteAssets from '../../src/commands/palette-assets';
import * as deferredStyles from '../../src/deferred-styles';
import { AiAssistantStub } from '../../src/ai-assistant/stub';

declare global {
	// eslint-disable-next-line @typescript-eslint/no-shadow
	interface Window {
		openStationCreateAiAssistant?: unknown;
	}
}

function makeStub(): AiAssistantStub {
	return new AiAssistantStub(
		{} as never,
		'https://example.test/ai-assistant.js',
	);
}

/** Publish an impl, as the bundle would once loaded. */
function implLoaded(): { setBaselineLoading: ReturnType< typeof vi.fn > } {
	const real = {
		open: vi.fn(),
		close: vi.fn(),
		toggle: vi.fn(),
		isOpen: false,
		ask: vi.fn(),
		attachAsk: vi.fn(),
		setBaselineLoading: vi.fn(),
	};
	window.openStationCreateAiAssistant = () => real;
	return real;
}

const settle = (): Promise< void > =>
	new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

describe( 'AiAssistantStub palette-runtime retry', () => {
	beforeEach( () => {
		vi.spyOn( deferredStyles, 'ensureDeferredStyle' ).mockImplementation(
			() => {},
		);
		// Without `implLoaded()` the impl bundle never resolves: the
		// script tag is swallowed here.
		vi.spyOn(
			document.head,
			'appendChild',
		).mockImplementation( ( n ) => n as never );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete window.openStationCreateAiAssistant;
		document.body.innerHTML = '';
	} );

	it( 'waits for the panel before asking for the palette runtime', () => {
		const spy = vi
			.spyOn( paletteAssets, 'ensureCommandPaletteAssets' )
			.mockResolvedValue( true );
		const stub = makeStub();

		stub.open();
		stub.open();

		expect( spy ).not.toHaveBeenCalled();
	} );

	it( 'raises the loading row for a running load only, not on every open', async () => {
		const real = implLoaded();
		vi.spyOn( paletteAssets, 'ensureCommandPaletteAssets' ).mockResolvedValue(
			true,
		);
		const stub = makeStub();

		stub.open();
		await settle();
		stub.close();
		stub.open();
		await settle();

		// Raised again on a later open, the row was painted and taken
		// straight back down, and a command still running lost its
		// "Running…" state to the repaint.
		expect( real.setBaselineLoading.mock.calls ).toEqual( [
			[ true ],
			[ false ],
		] );
	} );

	it( 'retries after a failed load rather than giving up for the session', async () => {
		const real = implLoaded();
		const spy = vi
			.spyOn( paletteAssets, 'ensureCommandPaletteAssets' )
			.mockRejectedValueOnce( new Error( 'offline' ) )
			.mockResolvedValue( true );
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const stub = makeStub();

		stub.open();
		await settle();
		// A failed load must not leave "Loading WordPress commands…"
		// in the panel for the rest of the session.
		expect( real.setBaselineLoading ).toHaveBeenLastCalledWith( false );
		stub.open();

		expect( spy ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'retries the panel bundle after a failed load', async () => {
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const append = vi.mocked( document.head.appendChild );
		// The placeholder's spinner puts a `<style>` in the head too,
		// so pick the bundle's tags out by type.
		const scripts = (): HTMLScriptElement[] =>
			append.mock.calls
				.map( ( [ node ] ) => node )
				.filter( ( node ): node is HTMLScriptElement => node instanceof HTMLScriptElement );
		const stub = makeStub();

		stub.open();
		expect( scripts() ).toHaveLength( 1 );
		scripts()[ 0 ].dispatchEvent( new Event( 'error' ) );
		await settle();

		// Still "open" after the failure, the next ⌘K went to close()
		// through the palette cycle and did nothing.
		expect( stub.isOpen ).toBe( false );
		stub.open();

		// One dropped request used to leave ⌘K dead until a reload.
		expect( scripts() ).toHaveLength( 2 );
	} );

	it( 'drops a bundle that loaded without registering, so a retry fetches again', async () => {
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		// For real this time: the tag has to be in the document to be
		// the one a retry would find there.
		vi.mocked( document.head.appendChild ).mockRestore();
		const tag = (): Element | null =>
			document.querySelector( 'script[data-os-ai="1"]' );
		const stub = makeStub();

		stub.open();
		// Executed, threw at the top level, registered nothing.
		tag()?.dispatchEvent( new Event( 'load' ) );
		await settle();

		// Left in place, the next ⌘K hooked the `load` of a script that
		// had already run, and the placeholder kept spinning for good.
		expect( tag() ).toBeNull();
	} );
} );
