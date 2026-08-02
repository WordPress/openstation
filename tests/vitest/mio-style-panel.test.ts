/**
 * Mio's "Make it yours" panel — the right-click menu, the live
 * binding between each control and `setStyle`, Restore, and Surprise
 * me.
 *
 * The contract worth defending is the *scope*: the panel may touch
 * appearance and the look-physics keys (silhouette, shuffle, idle
 * wobble), and nothing else. The spring constants belong to the site —
 * they interact, and an unstable Mio is not debuggable from a slider —
 * and `radius` is a layout decision. A control that quietly changed
 * either would be a bug nobody notices until a companion is unstable
 * or covering a window.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
	MioAppearance,
	MioConfig,
	MioLookPhysics,
} from '../../src/mio/types';
import { MIO_DEFAULTS } from '../../src/mio/config';
import { LOOK_PHYSICS_KEYS, splitMioLook } from '../../src/mio/look';

type PanelModule = typeof import( '../../src/mio/style-panel' );
type LookPartial = Partial< MioAppearance & MioLookPhysics >;

async function load(): Promise< PanelModule > {
	return await import( '../../src/mio/style-panel' );
}

/**
 * A stub `wp.desktop.mio` recording every write.
 *
 * `writes` is the raw flat bag each control sent; `appearanceWrites` /
 * `physicsWrites` are the same calls split the way the real controller
 * splits them, so a test can assert on the half it cares about.
 */
function stubApi(): {
	writes: LookPartial[];
	appearanceWrites: Partial< MioAppearance >[];
	physicsWrites: Partial< MioLookPhysics >[];
	resets: number;
	commits: number;
	config: MioConfig;
} {
	const state = {
		writes: [] as LookPartial[],
		appearanceWrites: [] as Partial< MioAppearance >[],
		physicsWrites: [] as Partial< MioLookPhysics >[],
		resets: 0,
		commits: 0,
		config: {
			appearance: { ...MIO_DEFAULTS.appearance },
			physics: { ...MIO_DEFAULTS.physics },
		} as MioConfig,
	};
	( window as unknown as { wp: Record< string, unknown > } ).wp = {
		desktop: {
			mio: {
				getConfig: () => state.config,
				setStyle: ( partial: LookPartial ) => {
					state.writes.push( partial );
					const split = splitMioLook( partial );
					if ( Object.keys( split.appearance ).length ) {
						state.appearanceWrites.push( split.appearance );
					}
					if ( Object.keys( split.physics ).length ) {
						state.physicsWrites.push( split.physics );
					}
					state.config = {
						appearance: {
							...state.config.appearance,
							...split.appearance,
						},
						physics: { ...state.config.physics, ...split.physics },
					};
				},
				commitStyle: () => {
					state.commits++;
				},
				resetStyle: () => {
					state.resets++;
					state.config = {
						appearance: { ...MIO_DEFAULTS.appearance },
						physics: { ...MIO_DEFAULTS.physics },
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

	test( 'the panel only ever touches the look, never the springs', async () => {
		// The scope guarantee. Every control is bound to one appearance
		// key or one look-physics key; this walks the whole panel and
		// checks what they write.
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
		// Nothing a control sends may fall outside the two whitelists —
		// `splitMioLook` would drop it, so a control writing a key that
		// belongs to neither is a control that silently does nothing.
		for ( const write of state.writes ) {
			const split = splitMioLook( write );
			expect(
				Object.keys( split.appearance ).length +
					Object.keys( split.physics ).length,
			).toBe( Object.keys( write ).length );
		}

		const appearanceKeys = new Set(
			state.appearanceWrites.flatMap( ( w ) => Object.keys( w ) ),
		);
		// A size, not a look.
		expect( appearanceKeys.has( 'radius' ) ).toBe( false );

		// The physics half: only the look keys, never a spring constant.
		expect( state.physicsWrites.length ).toBeGreaterThan( 0 );
		const physicsKeys = new Set(
			state.physicsWrites.flatMap( ( w ) => Object.keys( w ) ),
		);
		for ( const key of physicsKeys ) {
			expect( LOOK_PHYSICS_KEYS ).toContain( key );
		}
	} );

	test( 'every styling aspect has a control', async () => {
		// The completeness guarantee, the mirror of the scope one: the
		// panel must expose every appearance key there is, so a knob
		// added to the config can't quietly stay unreachable.
		//
		// Two deliberate omissions:
		//   - `radius` is a size, not a look.
		//   - `glowBlur` stays on. The unblurred halo is a hard-edged
		//     disc of colour behind the ring — not a look anyone chooses
		//     on purpose. A site that needs the filter pass gone can
		//     still drop it through `desktop_mode_mio_config`.
		const OMITTED = [ 'radius', 'glowBlur' ];
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
			state.appearanceWrites.flatMap( ( w ) => Object.keys( w ) ),
		);
		const expected = Object.keys( MIO_DEFAULTS.appearance ).filter(
			( k ) => ! OMITTED.includes( k ),
		);
		expect( [ ...expected ].sort() ).toEqual( [ ...reachable ].sort() );
	} );

	test( 'every look-physics key has a control too', async () => {
		// Same guarantee on the other half. `shapeLobes` is reachable
		// only through the polygon, so the sweep runs twice.
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		const sweep = (): void => {
			for ( const el of controls() ) {
				for ( const [ type, detail ] of [
					[ 'wpd-range-change', { value: 0.5 } ],
					[ 'wpd-checkbox-change', { checked: false } ],
				] as const ) {
					el.dispatchEvent( new CustomEvent( type, { detail } ) );
				}
			}
		};
		sweep();
		panel()!
			.querySelector( 'wpd-select' )!
			.dispatchEvent(
				new CustomEvent( 'wpd-pick', { detail: { value: 'custom' } } ),
			);
		sweep();

		const reachable = new Set(
			state.physicsWrites.flatMap( ( w ) => Object.keys( w ) ),
		);
		expect( [ ...LOOK_PHYSICS_KEYS ].sort() ).toEqual(
			[ ...reachable ].sort(),
		);
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

	test( 'the shape picker offers every stock silhouette', async () => {
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		const options = Array.from(
			panel()!.querySelectorAll( 'wpd-select > wpd-option' ),
		).map( ( el ) => el.getAttribute( 'value' ) );

		// Every preset the sanitizer accepts must be reachable, or a
		// silhouette someone added is one nobody can pick.
		for ( const preset of [
			'circle',
			'blob',
			'ghost',
			'potato',
			'star',
			'flower',
			'heart',
			'diamond',
			'drop',
			'cloud',
			'custom',
		] ) {
			expect( options ).toContain( preset );
		}
	} );

	test( 'picking a silhouette writes it and repaints', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		panel()!
			.querySelector( 'wpd-select' )!
			.dispatchEvent(
				new CustomEvent( 'wpd-pick', { detail: { value: 'star' } } ),
			);

		expect( state.physicsWrites ).toEqual( [ { shapePreset: 'star' } ] );
		expect(
			panel()!.querySelector( 'wpd-select' )!.getAttribute( 'value' ),
		).toBe( 'star' );
	} );

	test( 'the corner slider belongs to the polygon and nothing else', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		const corners = (): Element | undefined =>
			Array.from( panel()!.querySelectorAll( 'wpd-range-field' ) ).find(
				( el ) => el.getAttribute( 'label' ) === 'Corners',
			);

		// Default preset is `blob`, which does not read `shapeLobes`.
		expect( corners() ).toBeUndefined();

		panel()!
			.querySelector( 'wpd-select' )!
			.dispatchEvent(
				new CustomEvent( 'wpd-pick', { detail: { value: 'custom' } } ),
			);
		expect( corners() ).toBeDefined();

		corners()!.dispatchEvent(
			new CustomEvent( 'wpd-range-change', { detail: { value: 5 } } ),
		);
		expect( state.physicsWrites ).toContainEqual( { shapeLobes: 5 } );
	} );

	test( 'the auto-transform checkbox switches the shuffle off and back on', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		const auto = Array.from(
			panel()!.querySelectorAll( 'wpd-checkbox' ),
		).find(
			( el ) => el.getAttribute( 'label' ) === 'Change shape on its own',
		);
		expect( auto ).toBeDefined();
		// The shipped Mio does shuffle, so it starts ticked.
		expect( auto!.hasAttribute( 'checked' ) ).toBe( true );

		auto!.dispatchEvent(
			new CustomEvent( 'wpd-checkbox-change', { detail: { checked: false } } ),
		);
		expect( state.physicsWrites ).toContainEqual( { shapeShuffle: 0 } );

		auto!.dispatchEvent(
			new CustomEvent( 'wpd-checkbox-change', { detail: { checked: true } } ),
		);
		expect( state.physicsWrites ).toContainEqual( {
			shapeShuffle: MIO_DEFAULTS.physics.shapeShuffle,
		} );
	} );

	test( 'Surprise me writes both halves of a look and repaints', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		const surprise = Array.from(
			panel()!.querySelectorAll( 'wpd-button' ),
		).find( ( el ) => el.textContent === 'Surprise me' );
		expect( surprise ).toBeDefined();
		surprise!.dispatchEvent( new MouseEvent( 'click' ) );

		// One call, carrying both halves.
		expect( state.writes ).toHaveLength( 1 );
		expect( state.appearanceWrites ).toHaveLength( 1 );
		expect( state.physicsWrites ).toHaveLength( 1 );
		// A random look never rotates the silhouette, and never leaves
		// the gradient with a seam in it.
		expect( state.physicsWrites[ 0 ].shapeAngle ).toBe( 0 );
		expect( state.appearanceWrites[ 0 ].hueLoop ).toBe( true );
		// Repainted from what was just applied.
		expect(
			panel()!.querySelector( 'wpd-select' )!.getAttribute( 'value' ),
		).toBe( state.physicsWrites[ 0 ].shapePreset );
	} );

	test( 'closing the panel commits the look to the account', async () => {
		const state = stubApi();
		const { openMioStylePanel, closeMioStylePanel } = await load();
		openMioStylePanel();

		closeMioStylePanel();
		expect( state.commits ).toBe( 1 );

		// Closing again has nothing to save. A commit costs a REST
		// round-trip, and the teardown path calls this unconditionally.
		closeMioStylePanel();
		expect( state.commits ).toBe( 1 );
	} );

	test( 'Done closes the panel, which saves', async () => {
		const state = stubApi();
		const { openMioStylePanel } = await load();
		openMioStylePanel();

		Array.from( panel()!.querySelectorAll( 'wpd-button' ) )
			.find( ( el ) => el.textContent === 'Done' )!
			.dispatchEvent( new MouseEvent( 'click' ) );

		expect( panel() ).toBeNull();
		expect( state.commits ).toBe( 1 );
	} );

	test( 'nothing opens when the Mio API is absent', async () => {
		delete ( window as unknown as { wp?: unknown } ).wp;
		const { openMioStylePanel } = await load();
		openMioStylePanel();
		expect( panel() ).toBeNull();
	} );
} );
