/**
 * Unit tests for the view-transition layer — the registry contract,
 * the type composition the whole stylesheet keys off, and the
 * degradation ladder in the player.
 *
 * The bias here is toward the things that fail SILENTLY. A registry
 * that rejects a bad def throws where you can see it; a player that
 * quietly composes the wrong type name produces a transition that
 * simply does nothing, on one browser, for one user, and looks exactly
 * like a CSS typo. So the type strings, the id-to-type mapping, and
 * every "we couldn't animate" path are pinned by name.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';

type RegistryModule = typeof import( '../../src/view-transitions/registry' );
type PlayModule = typeof import( '../../src/view-transitions/play' );

async function load(): Promise< {
	registry: RegistryModule;
	play: PlayModule;
} > {
	vi.resetModules();
	return {
		registry: await import( '../../src/view-transitions/registry' ),
		play: await import( '../../src/view-transitions/play' ),
	};
}

/** A `ViewTransition` stand-in that settles immediately. */
function fakeTransition(): { finished: Promise< void > } {
	return { finished: Promise.resolve() };
}

interface StartCall {
	types?: string[];
	update?: () => unknown;
}

/**
 * Install a `document.startViewTransition` stub that records what it
 * was handed and runs the update callback, the way a real engine does.
 *
 * @param opts             Which capabilities to simulate.
 * @param opts.types       Whether `:active-view-transition-type()` parses.
 * @return                 The recorded calls.
 */
function stubStartViewTransition( opts: { types: boolean } ): StartCall[] {
	const calls: StartCall[] = [];
	( document as unknown as Record< string, unknown > ).startViewTransition = (
		arg: unknown,
	) => {
		if ( typeof arg === 'function' ) {
			calls.push( { update: arg as () => unknown } );
			( arg as () => unknown )();
		} else {
			const o = arg as { update: () => unknown; types?: string[] };
			calls.push( { types: o.types, update: o.update } );
			o.update();
		}
		return fakeTransition();
	};
	vi.stubGlobal( 'CSS', {
		supports: ( q: string ) =>
			opts.types && q.includes( 'active-view-transition-type' ),
	} );
	return calls;
}

function stubReducedMotion( reduce: boolean ): void {
	vi.stubGlobal(
		'matchMedia',
		( query: string ) => ( {
			matches: reduce && query.includes( 'reduced-motion' ),
			media: query,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		} ),
	);
}

describe( 'view-transition registry', () => {
	beforeEach( () => {
		installHooksStub();
		stubReducedMotion( false );
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
		delete ( document as unknown as Record< string, unknown > )
			.startViewTransition;
		document.documentElement.removeAttribute( 'style' );
		document.documentElement.removeAttribute( 'data-os-vt' );
	} );

	test( 'ships the built-in catalogue through the public register()', async () => {
		const { registry } = await load();
		const ids = registry.listViewTransitions().map( ( d ) => d.id );
		// A representative from each family, so a whole group going
		// missing is caught rather than just a count drifting.
		expect( ids ).toEqual(
			expect.arrayContaining( [
				'crossfade',
				'slide',
				'zoom',
				'cube',
				'ripple',
				'blinds',
				'nebula',
				'glitch',
				'morph',
			] ),
		);
		expect( ids ).not.toContain( registry.VIEW_TRANSITION_NONE );
	} );

	test( 'every built-in has a label and a playable duration', async () => {
		const { registry } = await load();
		for ( const def of registry.listViewTransitions() ) {
			expect( def.label.length ).toBeGreaterThan( 0 );
			const d = registry.clampVtDuration( def.duration );
			expect( d ).toBeGreaterThanOrEqual( registry.MIN_VT_DURATION_MS );
			expect( d ).toBeLessThanOrEqual( registry.MAX_VT_DURATION_MS );
			// A def that shipped an unclamped duration would still play,
			// just not at the duration its author wrote — so pin that the
			// declared value is already in range rather than only that
			// the clamp works.
			expect( d ).toBe( def.duration ?? d );
		}
	} );

	test( 'id → type mapping flattens the vendor namespace', async () => {
		const { registry } = await load();
		expect( registry.viewTransitionTypeFor( 'cube' ) ).toBe( 'os-vt-cube' );
		// A slash is legal in an id and illegal in a CSS identifier; the
		// selector would silently never match if this stopped flattening.
		expect( registry.viewTransitionTypeFor( 'acme/warp' ) ).toBe(
			'os-vt-acme-warp',
		);
	} );

	test( 'rejects a reserved id, a missing label, and a non-identifier type', async () => {
		const { registry } = await load();
		expect( () =>
			registry.registerViewTransition( { id: 'none', label: 'No' } ),
		).toThrow();
		expect( () =>
			registry.registerViewTransition( {
				id: 'ok',
				label: '',
			} ),
		).toThrow();
		expect( () =>
			registry.registerViewTransition( {
				id: 'ok',
				label: 'Ok',
				types: [ 'not a selector' ],
			} ),
		).toThrow();
	} );

	test( 'unregisterByOwner removes only that plugin’s transitions', async () => {
		const { registry } = await load();
		const before = registry.listViewTransitions().length;
		registry.registerViewTransition( {
			id: 'acme/a',
			label: 'A',
			owner: 'acme',
		} );
		registry.registerViewTransition( {
			id: 'acme/b',
			label: 'B',
			owner: 'acme',
		} );
		registry.registerViewTransition( { id: 'other', label: 'Other' } );
		expect( registry.unregisterViewTransitionsByOwner( 'acme' ) ).toBe( 2 );
		expect( registry.listViewTransitions() ).toHaveLength( before + 1 );
	} );

	test( 'the duration override sentinel survives, junk collapses to it', async () => {
		const { registry } = await load();
		expect( registry.clampVtDurationOverride( 0 ) ).toBe(
			registry.VT_DURATION_AUTO,
		);
		expect( registry.clampVtDurationOverride( -5 ) ).toBe(
			registry.VT_DURATION_AUTO,
		);
		expect( registry.clampVtDurationOverride( NaN ) ).toBe(
			registry.VT_DURATION_AUTO,
		);
		expect( registry.clampVtDurationOverride( 10_000 ) ).toBe(
			registry.MAX_VT_DURATION_MS,
		);
	} );
} );

describe( 'view-transition player', () => {
	beforeEach( () => {
		installHooksStub();
		stubReducedMotion( false );
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
		delete ( document as unknown as Record< string, unknown > )
			.startViewTransition;
		document.documentElement.removeAttribute( 'style' );
		document.documentElement.removeAttribute( 'data-os-vt' );
	} );

	test( 'composes the universal type, the def type, and the context types', async () => {
		const { play } = await load();
		const calls = stubStartViewTransition( { types: true } );
		const result = await play.playViewTransition(
			{
				update: () => undefined,
				types: [ 'os-vt-desktop' ],
				direction: 'backward',
			},
			'cube',
		);
		expect( result.animated ).toBe( true );
		// `os-vt-on` carries the shared setup, `os-vt-cube` the def's own
		// rules, `os-vt-3d` the perspective it shares with flip/fold,
		// `os-vt-desktop` the caller's surface, `os-vt-backward` the
		// mirror. Every one of the five has rules keyed to it.
		expect( calls[ 0 ].types ).toEqual( [
			'os-vt-on',
			'os-vt-cube',
			'os-vt-3d',
			'os-vt-desktop',
			'os-vt-backward',
		] );
	} );

	test( 'falls back to the id attribute when types are unsupported', async () => {
		const { play } = await load();
		const calls = stubStartViewTransition( { types: false } );
		let attrDuringRun: string | null = null;
		await play.playViewTransition(
			{
				update: () => {
					attrDuringRun =
						document.documentElement.getAttribute( 'data-os-vt' );
				},
			},
			'slide',
		);
		// The callback form, not the object form — an engine without
		// types would throw on the object.
		expect( calls[ 0 ].types ).toBeUndefined();
		expect( attrDuringRun ).toBe( 'slide' );
		// And it is gone again afterwards, or the next transition would
		// inherit it.
		expect(
			document.documentElement.getAttribute( 'data-os-vt' ),
		).toBeNull();
	} );

	test( 'publishes duration and easing, and clears them after', async () => {
		const { play } = await load();
		stubStartViewTransition( { types: true } );
		let seen = '';
		await play.playViewTransition(
			{
				update: () => {
					seen =
						document.documentElement.style.getPropertyValue(
							'--os-vt-duration',
						);
				},
			},
			'crossfade',
		);
		expect( seen ).toBe( '260ms' );
		expect(
			document.documentElement.style.getPropertyValue(
				'--os-vt-duration',
			),
		).toBe( '' );
	} );

	test( 'the speed override beats the def’s own duration', async () => {
		const { play } = await load();
		stubStartViewTransition( { types: true } );
		let seen = '';
		await play.playViewTransition(
			{
				update: () => {
					seen =
						document.documentElement.style.getPropertyValue(
							'--os-vt-duration',
						);
				},
			},
			'crossfade',
			700,
		);
		expect( seen ).toBe( '700ms' );
	} );

	test( 'runs the update exactly once on every non-animating path', async () => {
		const { play } = await load();

		// No support at all.
		let runs = 0;
		let result = await play.playViewTransition(
			{ update: () => runs++ },
			'slide',
		);
		expect( result ).toEqual( { animated: false, reason: 'unsupported' } );
		expect( runs ).toBe( 1 );

		// Supported, but the user asked for less motion.
		stubStartViewTransition( { types: true } );
		stubReducedMotion( true );
		runs = 0;
		result = await play.playViewTransition(
			{ update: () => runs++ },
			'slide',
		);
		expect( result ).toEqual( {
			animated: false,
			reason: 'reduced-motion',
		} );
		expect( runs ).toBe( 1 );

		// Supported, but nothing selected.
		stubReducedMotion( false );
		runs = 0;
		result = await play.playViewTransition(
			{ update: () => runs++ },
			'none',
		);
		expect( result ).toEqual( { animated: false, reason: 'none-selected' } );
		expect( runs ).toBe( 1 );

		// An id whose plugin is gone. Degrades to "no transition", NOT
		// to a built-in — silently playing a different animation than
		// the one named in user meta would be the stranger outcome.
		runs = 0;
		result = await play.playViewTransition(
			{ update: () => runs++ },
			'acme/uninstalled',
		);
		expect( result ).toEqual( { animated: false, reason: 'none-selected' } );
		expect( runs ).toBe( 1 );
	} );

	test( 'a busy transition is skipped, or dropped on request', async () => {
		const { play } = await load();
		stubStartViewTransition( { types: true } );
		let skipped = 0;
		( document as unknown as Record< string, unknown > )
			.activeViewTransition = {
			skipTransition: () => skipped++,
		};

		let result = await play.playViewTransition(
			{ update: () => undefined },
			'slide',
		);
		expect( skipped ).toBe( 1 );
		expect( result.animated ).toBe( true );

		let runs = 0;
		result = await play.playViewTransition(
			{ update: () => runs++, whenBusy: 'drop' },
			'slide',
		);
		// Dropped means no animation AND no second skip — but the state
		// change still lands, which is the whole contract.
		expect( skipped ).toBe( 1 );
		expect( result ).toEqual( { animated: false, reason: 'busy' } );
		expect( runs ).toBe( 1 );

		delete ( document as unknown as Record< string, unknown > )
			.activeViewTransition;
	} );

	test( 'morph hands one name from the source to the destination', async () => {
		const { play } = await load();
		stubStartViewTransition( { types: true } );

		const from = document.createElement( 'div' );
		const to = document.createElement( 'div' );
		document.body.append( from, to );

		let nameOnFromBefore = '';
		let namesDuringUpdate: [ string, string ] = [ '', '' ];
		const original = ( document as unknown as Record< string, unknown > )
			.startViewTransition as ( a: unknown ) => unknown;
		( document as unknown as Record< string, unknown > )
			.startViewTransition = ( arg: unknown ) => {
			// Sampled at the moment the browser would take the OLD
			// snapshot: the source must already be named.
			nameOnFromBefore =
				from.style.getPropertyValue( 'view-transition-name' );
			return original( arg );
		};

		await play.playViewTransition(
			{
				update: () => {
					namesDuringUpdate = [
						from.style.getPropertyValue( 'view-transition-name' ),
						to.style.getPropertyValue( 'view-transition-name' ),
					];
				},
				morph: { from, to: () => to },
			},
			'morph',
		);

		expect( nameOnFromBefore ).toMatch( /^os-vt-morph-\d+$/ );
		// Inside the update the handover has not happened yet — it runs
		// immediately AFTER the caller's mutation, between the two
		// snapshots.
		expect( namesDuringUpdate[ 0 ] ).toBe( nameOnFromBefore );
		expect( namesDuringUpdate[ 1 ] ).toBe( '' );

		// Both sides are clean once it settles. A stranded
		// `view-transition-name` silently breaks the NEXT transition.
		expect( from.style.getPropertyValue( 'view-transition-name' ) ).toBe( '' );
		expect( to.style.getPropertyValue( 'view-transition-name' ) ).toBe( '' );
		expect( from.style.getPropertyValue( 'view-transition-class' ) ).toBe( '' );
		expect( to.style.getPropertyValue( 'view-transition-class' ) ).toBe( '' );

		from.remove();
		to.remove();
	} );

	test( 'each morph run uses a fresh name', async () => {
		const { play } = await load();
		stubStartViewTransition( { types: true } );
		const el = document.createElement( 'div' );
		document.body.appendChild( el );

		const seen: string[] = [];
		for ( let i = 0; i < 2; i++ ) {
			await play.playViewTransition(
				{
					update: () => {
						seen.push(
							el.style.getPropertyValue( 'view-transition-name' ),
						);
					},
					morph: { from: el, to: () => el },
				},
				'morph',
			);
		}
		// Reusing one name across runs would let a transition pair with
		// a stale snapshot from the previous one.
		expect( seen[ 0 ] ).not.toBe( seen[ 1 ] );
		el.remove();
	} );

	test( 'a throwing update still clears the published properties', async () => {
		const { play } = await load();
		( document as unknown as Record< string, unknown > )
			.startViewTransition = () => ( {
			finished: Promise.reject( new Error( 'update threw' ) ),
		} );
		vi.stubGlobal( 'CSS', { supports: () => true } );

		const result = await play.playViewTransition(
			{ update: () => undefined },
			'slide',
		);
		expect( result.animated ).toBe( true );
		// The leak this guards against is cumulative: a stuck
		// `--os-vt-duration` would retime every LATER transition.
		expect(
			document.documentElement.style.getPropertyValue(
				'--os-vt-duration',
			),
		).toBe( '' );
	} );
} );
