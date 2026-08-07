/**
 * Note Pad widget: compose state, tear-off drag gating (empty text
 * never lifts), payload shape, commit clears the draft, and the
 * keyboard "Pin to desktop" path (POST + CustomEvent hand-off).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { WidgetContext } from '../../src/widgets/types';
import { NOTE_CREATED_EVENT, NOTE_DRAFT_PAYLOAD_TYPE } from '../../src/notes/types';
import type { StartOpts } from '../../src/drag/types';

// Import for the side effect: registers window.openStationWidgets['desktop-mode/notes'].
import '../../src/plugins/notes-widget/index';

type MountFn = (
	container: HTMLElement,
	ctx: WidgetContext,
) => ( () => void ) | Promise< () => void >;

function getMount(): MountFn {
	const w = window as unknown as {
		openStationWidgets?: Record< string, MountFn >;
	};
	const mount = w.openStationWidgets?.[ 'desktop-mode/notes' ];
	if ( ! mount ) {
		throw new Error( 'notes widget did not register its mount' );
	}
	return mount;
}

function makeCtx(): WidgetContext {
	const bag = new Map< string, unknown >();
	return {
		id: 'desktop-mode/notes',
		pluginUrl: 'https://example.test/plugin',
		storage: {
			get: < T >( key: string ) => ( bag.get( key ) as T | undefined ) ?? null,
			set: ( key: string, value: unknown ) => bag.set( key, value ),
			remove: ( key: string ) => void bag.delete( key ),
			clear: () => bag.clear(),
		},
	} as unknown as WidgetContext;
}

function pointerDown( target: HTMLElement, x = 10, y = 10 ): void {
	const ev = new Event( 'pointerdown', { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: x } );
	Object.defineProperty( ev, 'clientY', { value: y } );
	Object.defineProperty( ev, 'target', { value: target } );
	target.dispatchEvent( ev );
}

function typeInEditor( container: HTMLElement, value: string ): void {
	const editor = container.querySelector( '.dm-notes-pad__editor' ) as HTMLElement;
	editor.dispatchEvent(
		new CustomEvent( 'os-input-change', { detail: { value }, bubbles: false } ),
	);
}

describe( 'note pad widget', () => {
	let container: HTMLElement;
	let teardown: ( () => void ) | null = null;
	let dragStart: ReturnType< typeof vi.fn >;
	let fetchSpy: ReturnType< typeof vi.fn >;

	beforeEach( async () => {
		( window as unknown as { openStationConfig?: unknown } ).openStationConfig = {
			notesUrl: 'https://example.test/wp-json/desktop-mode/v1/notes',
			restNonce: 'nonce-9',
		};
		dragStart = vi.fn( () => null );
		const wp = ( window as unknown as { wp?: { os?: Record< string, unknown > } } ).wp ?? {};
		wp.os = { ...( wp.os ?? {} ), dragManager: { start: dragStart } };
		( window as unknown as { wp: typeof wp } ).wp = wp;

		fetchSpy = vi.fn( async () =>
			new Response(
				JSON.stringify( {
					id: 31,
					text: 'kb note',
					color: 'butter',
					x: 0.5,
					y: 0.2,
					z: 2,
					public: false,
					ownerId: 1,
					ownerName: 'Me',
					ownerAvatar: '',
					canEdit: true,
					updatedAtMs: 1234,
				} ),
				{ status: 200 },
			),
		);
		vi.stubGlobal( 'fetch', fetchSpy );

		container = document.createElement( 'div' );
		document.body.appendChild( container );
		teardown = await getMount()( container, makeCtx() );
	} );

	afterEach( () => {
		teardown?.();
		teardown = null;
		document.body.innerHTML = '';
		vi.unstubAllGlobals();
		delete ( window as unknown as { openStationConfig?: unknown } ).openStationConfig;
	} );

	test( 'renders the pad: sheet, peek sheets, six swatches, footer', () => {
		expect( container.querySelector( '.dm-notes-pad__sheet' ) ).not.toBeNull();
		expect( container.querySelectorAll( '.dm-notes-pad__under' ).length ).toBe( 2 );
		expect( container.querySelectorAll( '.dm-notes-pad__swatch' ).length ).toBe( 6 );
		expect( container.querySelector( '.dm-notes-pad__pin-btn' ) ).not.toBeNull();
		// Under-sheets advertise the NEXT colors in the cycle.
		const sheet = container.querySelector( '.dm-notes-pad__sheet' ) as HTMLElement;
		const under1 = container.querySelector( '.dm-notes-pad__under--1' ) as HTMLElement;
		expect( sheet.dataset.noteColor ).toBe( 'butter' );
		expect( under1.dataset.noteColor ).toBe( 'blush' );
	} );

	test( 'empty draft never lifts — the drag manager is not started', () => {
		const peel = container.querySelector( '.dm-notes-pad__peel' ) as HTMLElement;
		pointerDown( peel );
		expect( dragStart ).not.toHaveBeenCalled();
	} );

	test( 'tear-off drag carries the note-draft payload with the pin-tip offset', () => {
		typeInEditor( container, 'a brilliant idea' );
		const peel = container.querySelector( '.dm-notes-pad__peel' ) as HTMLElement;
		pointerDown( peel );
		expect( dragStart ).toHaveBeenCalledTimes( 1 );
		const opts = dragStart.mock.calls[ 0 ][ 0 ] as StartOpts;
		expect( opts.payload.type ).toBe( NOTE_DRAFT_PAYLOAD_TYPE );
		expect( opts.payload.data ).toMatchObject( {
			text: 'a brilliant idea',
			color: 'butter',
			isPublic: false,
		} );
		// Ghost held by the pin: tip = (width/2, 10).
		expect( opts.payload.ghost?.offsetX ).toBe( 104 );
		expect( opts.payload.ghost?.offsetY ).toBe( 10 );
		expect(
			opts.payload.ghost?.element?.classList.contains(
				'os-pinned-note-ghost',
			),
		).toBe( true );
	} );

	test( 'commit clears the draft; cancel keeps it', () => {
		typeInEditor( container, 'draft text' );
		const peel = container.querySelector( '.dm-notes-pad__peel' ) as HTMLElement;
		pointerDown( peel );
		const opts = dragStart.mock.calls[ 0 ][ 0 ] as StartOpts;
		// Commit → torn off → fresh sheet.
		opts.onCommit?.( { id: 'x', element: document.createElement( 'div' ), accept: () => true, onDrop: () => undefined } );
		const editor = container.querySelector( '.dm-notes-pad__editor' ) as HTMLElement;
		expect( editor.getAttribute( 'value' ) ).toBe( '' );
		// A second drag with no new text must not lift.
		pointerDown( peel );
		expect( dragStart ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'pointerdown inside the textarea does not start a drag', () => {
		typeInEditor( container, 'text' );
		const editor = container.querySelector( '.dm-notes-pad__editor' ) as HTMLElement;
		pointerDown( editor );
		expect( dragStart ).not.toHaveBeenCalled();
	} );

	test( 'corner click cycles the paper color and repaints the peeks', () => {
		const corner = container.querySelector( '.dm-notes-pad__corner' ) as HTMLElement;
		corner.click();
		const sheet = container.querySelector( '.dm-notes-pad__sheet' ) as HTMLElement;
		const under1 = container.querySelector( '.dm-notes-pad__under--1' ) as HTMLElement;
		expect( sheet.dataset.noteColor ).toBe( 'blush' );
		expect( under1.dataset.noteColor ).toBe( 'sky' );
	} );

	test( '"Pin to desktop" POSTs and hands the note to the layer via CustomEvent', async () => {
		typeInEditor( container, 'kb note' );
		const seen = vi.fn();
		document.addEventListener( NOTE_CREATED_EVENT, seen, { once: true } );
		( container.querySelector( '.dm-notes-pad__pin-btn' ) as HTMLButtonElement ).click();
		await new Promise( ( r ) => setTimeout( r, 10 ) );
		const post = fetchSpy.mock.calls.find(
			( call ) => ( call[ 1 ] as RequestInit | undefined )?.method === 'POST',
		);
		expect( post ).toBeDefined();
		expect( seen ).toHaveBeenCalledTimes( 1 );
		const detail = ( seen.mock.calls[ 0 ][ 0 ] as CustomEvent< { note: { id: number } } > ).detail;
		expect( detail.note.id ).toBe( 31 );
		// Draft cleared after a successful pin.
		const editor = container.querySelector( '.dm-notes-pad__editor' ) as HTMLElement;
		expect( editor.getAttribute( 'value' ) ).toBe( '' );
	} );
} );
