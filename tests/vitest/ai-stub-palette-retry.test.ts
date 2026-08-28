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

describe( 'AiAssistantStub palette-runtime retry', () => {
	beforeEach( () => {
		vi.spyOn( deferredStyles, 'ensureDeferredStyle' ).mockImplementation(
			() => {},
		);
		// The impl bundle never resolves here; these tests are only
		// about whether the palette loader is re-entered.
		vi.spyOn(
			document.head,
			'appendChild',
		).mockImplementation( ( n ) => n as never );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete window.openStationCreateAiAssistant;
	} );

	it( 'asks for the palette runtime again on a later open', () => {
		const spy = vi
			.spyOn( paletteAssets, 'ensureCommandPaletteAssets' )
			.mockResolvedValue( true );
		const stub = makeStub();

		stub.open();
		stub.open();
		stub.toggle();

		expect( spy.mock.calls.length ).toBeGreaterThanOrEqual( 2 );
	} );

	it( 'retries after a failed load rather than giving up for the session', async () => {
		const spy = vi
			.spyOn( paletteAssets, 'ensureCommandPaletteAssets' )
			.mockRejectedValueOnce( new Error( 'offline' ) )
			.mockResolvedValue( true );
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const stub = makeStub();

		stub.open();
		await Promise.resolve();
		stub.open();

		expect( spy ).toHaveBeenCalledTimes( 2 );
	} );
} );
