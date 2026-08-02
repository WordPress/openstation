/**
 * Mio's "Make it yours" panel — the right-click menu, the live
 * binding between each control and `setStyle`, and Restore.
 *
 * The contract worth defending is the *scope*: the panel may only
 * touch appearance, and only the parts of appearance that are a look
 * rather than a size. Physics belongs to the site, and `radius` is a
 * layout decision — a slider that quietly changed either would be a
 * bug nobody notices until a mascot is unstable or covering a window.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MioAppearance, MioConfig } from '../../src/mio/types';
import { MIO_DEFAULTS } from '../../src/mio/config';

type PanelModule = typeof import( '../../src/mio/style-panel' );

async function load(): Promise< PanelModule > {
	return await import( '../../src/mio/style-panel' );
}

/** A stub `wp.desktop.mio` recording every style write. */
function stubApi(): {
	writes: Partial< MioAppearance >[];
	resets: number;
	config: MioConfig;
} {
	const state = {
		writes: [] as Partial< MioAppearance >[],
		resets: 0,
		config: {
			appearance: { ...MIO_DEFAULTS.appearance },
			physics: { ...MIO_DEFAULTS.physics },
		} as MioConfig,
	};
	( window as unknown as { wp: Record< string, unknown > } ).wp = {
		desktop: {
			mio: {
				getConfig: () => state.config,
				setStyle: ( partial: Partial< MioAppearance > ) => {
					state.writes.push( partial );
					state.config = {
						...state.config,
						appearance: { ...state.config.appearance, ...partial },
					};
				},
				resetStyle: () => {
					state.resets++;
					state.config = {
						...state.config,
						appearance: { ...MIO_DEFAULTS.appearance },
					};
				},
			},
		},
	};
	return state;
}

function panel(): HTMLElement | null {
	return document.querySelector( '.desktop-mode-mio-panel' );
}

function controls(): HTMLElement[] {
	return Array.from(
		panel()?.querySelectorAll(
			'wpd-range-field, wpd-color-field, wpd-checkbox',
		) ?? [],
	);
}

describe( 'Mio style panel', () => {
	beforeEach( () => {
		stubApi();
	} );

	afterEach( () => {
		document.body.innerHTML = '';
		delete ( window as unknown as { wp?: unknown } ).wp;
		vi.restoreAllMocks();
	} );

	test( 'right-click opens a menu with exactly one entry', async () => {
		const { openMioMenu } = await load();
		openMioMenu( { x: 120, y: 80 } );

		const menu = document.querySelector( '.desktop-mode-mio-menu' );
		expect( menu ).not.toBeNull();
		const options = menu!.querySelectorAll( 'wpd-context-menu-option' );
		expect( options ).toHaveLength( 1 );
		expect( options[ 0 ].textContent ).toBe( 'Make it yours' );
		expect( ( menu as HTMLElement ).style.left ).toBe( '120px' );
	} );

	test( 'picking the entry closes the menu and opens the panel', async () => {
		const { openMioMenu } = await load();
		openMioMenu( { x: 0, y: 0 } );

		document
			.querySelector( 'wpd-context-menu-option' )!
			.dispatchEvent(
				new CustomEvent( 'wpd-context-menu-pick', {
					bubbles: true,
					detail: { id: 'make-it-yours' },
				} ),
			);

		expect( document.querySelector( '.desktop-mode-mio-menu' ) ).toBeNull();
		expect( panel() ).not.toBeNull();
	} );

	test( 'Escape closes the menu', async () => {
		const { openMioMenu } = await load();
		openMioMenu( { x: 0, y: 0 } );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape' } ) );
		expect( document.querySelector( '.desktop-mode-mio-menu' ) ).toBeNull();
	} );

	test( 'the panel only ever touches style, never physics or radius', async () => {
		// The scope guarantee. Every control is bound to one appearance
		// key; this walks the whole panel and checks what they write.
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		for ( const el of controls() ) {
			el.dispatchEvent(
				new CustomEvent( 'wpd-range-change', {
					detail: { value: 0.5 },
				} ),
			);
			el.dispatchEvent(
				new CustomEvent( 'wpd-color-change', {
					detail: { value: '#123456' },
				} ),
			);
			el.dispatchEvent(
				new CustomEvent( 'wpd-checkbox-change', {
					detail: { checked: false },
				} ),
			);
		}

		expect( state.writes.length ).toBeGreaterThan( 0 );
		const touched = new Set( state.writes.flatMap( ( w ) => Object.keys( w ) ) );
		expect( touched.has( 'radius' ) ).toBe( false );
		for ( const key of touched ) {
			// Every key must be a real appearance key…
			expect( MIO_DEFAULTS.appearance ).toHaveProperty( key );
			// …and never a physics one.
			expect( MIO_DEFAULTS.physics ).not.toHaveProperty( key );
		}
	} );

	test( 'every styling aspect has a control', async () => {
		// The completeness guarantee, the mirror of the scope one: the
		// panel must expose every appearance key there is, so a knob
		// added to the config can't quietly stay unreachable. `radius`
		// is the one deliberate omission — it is a size, not a look.
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		for ( const el of controls() ) {
			for ( const [ type, detail ] of [
				[ 'wpd-range-change', { value: 0.5 } ],
				[ 'wpd-color-change', { value: '#123456' } ],
				[ 'wpd-checkbox-change', { checked: false } ],
			] as const ) {
				el.dispatchEvent( new CustomEvent( type, { detail } ) );
			}
		}

		const reachable = new Set(
			state.writes.flatMap( ( w ) => Object.keys( w ) ),
		);
		const expected = Object.keys( MIO_DEFAULTS.appearance ).filter(
			( k ) => k !== 'radius',
		);
		expect( [ ...expected ].sort() ).toEqual( [ ...reachable ].sort() );
	} );

	test( 'a slider writes live, on every movement', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		const glow = Array.from(
			panel()!.querySelectorAll( 'wpd-range-field' ),
		).find( ( el ) => el.getAttribute( 'label' ) === 'Glow' );
		expect( glow ).toBeDefined();

		glow!.dispatchEvent(
			new CustomEvent( 'wpd-range-change', { detail: { value: 1.25 } } ),
		);
		glow!.dispatchEvent(
			new CustomEvent( 'wpd-range-change', { detail: { value: 2.5 } } ),
		);

		expect( state.writes ).toEqual( [ { glow: 1.25 }, { glow: 2.5 } ] );
	} );

	test( 'a colour field converts hex to the packed int the config uses', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		const field = panel()!.querySelector( 'wpd-color-field' );
		field!.dispatchEvent(
			new CustomEvent( 'wpd-color-change', { detail: { value: '#ff00aa' } } ),
		);

		expect( state.writes[ 0 ] ).toEqual( { bodyColor: 0xff00aa } );
	} );

	test( 'a malformed colour is ignored rather than written as NaN', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		panel()!
			.querySelector( 'wpd-color-field' )!
			.dispatchEvent(
				new CustomEvent( 'wpd-color-change', { detail: { value: 'nope' } } ),
			);

		expect( state.writes ).toHaveLength( 0 );
	} );

	test( 'Restore Mio resets and repaints the controls', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		// Move something far from the default first.
		const glow = Array.from(
			panel()!.querySelectorAll( 'wpd-range-field' ),
		).find( ( el ) => el.getAttribute( 'label' ) === 'Glow' )!;
		glow.dispatchEvent(
			new CustomEvent( 'wpd-range-change', { detail: { value: 0 } } ),
		);

		const restore = Array.from(
			panel()!.querySelectorAll( 'wpd-button' ),
		).find( ( el ) => el.textContent === 'Restore Mio' );
		expect( restore ).toBeDefined();
		restore!.dispatchEvent( new MouseEvent( 'click' ) );

		expect( state.resets ).toBe( 1 );
		// Repainted from the restored config, not left showing 0.
		const repainted = Array.from(
			panel()!.querySelectorAll( 'wpd-range-field' ),
		).find( ( el ) => el.getAttribute( 'label' ) === 'Glow' )!;
		expect( repainted.getAttribute( 'value' ) ).toBe(
			String( MIO_DEFAULTS.appearance.glow ),
		);
	} );

	test( 'opening twice does not stack two panels', async () => {
		const { openMioStylePanel } = await load();
		openMioStylePanel();
		openMioStylePanel();
		expect(
			document.querySelectorAll( '.desktop-mode-mio-panel' ),
		).toHaveLength( 1 );
	} );

	test( 'nothing opens when the Mio API is absent', async () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
		const { openMioStylePanel } = await load();
		openMioStylePanel();
		expect( panel() ).toBeNull();
	} );
} );
