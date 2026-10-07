import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as paletteAssets from '../../src/commands/palette-assets';
import * as deferredStyles from '../../src/deferred-styles';
import { AiAssistantStub } from '../../src/ai-assistant/stub';

declare global {

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

		expect( real.setBaselineLoading ).toHaveBeenLastCalledWith( false );
		stub.open();

		expect( spy ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'retries the panel bundle after a failed load', async () => {
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const append = vi.mocked( document.head.appendChild );

		const scripts = (): HTMLScriptElement[] =>
			append.mock.calls
				.map( ( [ node ] ) => node )
				.filter( ( node ): node is HTMLScriptElement => node instanceof HTMLScriptElement );
		const stub = makeStub();

		stub.open();
		expect( scripts() ).toHaveLength( 1 );
		scripts()[ 0 ].dispatchEvent( new Event( 'error' ) );
		await settle();

		expect( stub.isOpen ).toBe( false );
		stub.open();

		expect( scripts() ).toHaveLength( 2 );
	} );

	it( 'drops a bundle that loaded without registering, so a retry fetches again', async () => {
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		vi.mocked( document.head.appendChild ).mockRestore();
		const tag = (): Element | null =>
			document.querySelector( 'script[data-os-ai="1"]' );
		const stub = makeStub();

		stub.open();

		tag()?.dispatchEvent( new Event( 'load' ) );
		await settle();

		expect( tag() ).toBeNull();
	} );
} );
