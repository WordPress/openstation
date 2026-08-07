/**
 * Unit tests for `src/reveals/surface.ts`.
 *
 * Three behaviours here are easy to get wrong and invisible in review:
 *
 *  1. **The reveal always plays.** The `<os-spinner>` overlay has a
 *     120 ms entry delay, so fast loads never paint it. What varies is
 *     only WHEN the reveal starts — after the spinner's 250 ms fade-out
 *     if there was a spinner, immediately if there was not. Gating the
 *     reveal on the spinner instead would leave the fastest loads (the
 *     ones a user repeats most) as the only ones with no transition.
 *
 *  2. **The surface resolves its def from the id that ARMED it.** A
 *     user switching reveals mid-load must not produce a `from` from
 *     one shape and a `to` from another — that pair cannot interpolate,
 *     and the browser's fallback is a mid-animation jump.
 *
 *  3. **The edge layer runs LONGER than the surface.** That lag is the
 *     entire mechanism: being permanently a little less far along is
 *     what makes the edge peek out past the surface as a band. Run it
 *     shorter (or equal) and the edge is never visible at all. It also
 *     makes the edge the last layer to land, so teardown has to hang
 *     off it, or the surface's earlier finish would rip both layers out
 *     mid-band.
 *
 * jsdom has no Web Animations API, so the no-WAAPI fallback path is
 * exercised natively and the WAAPI path runs against an explicit stub.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';

type Surface = typeof import( '../../src/reveals/surface' );
type Engine = typeof import( '../../src/reveals/engine' );
type Registry = typeof import( '../../src/reveals/registry' );

interface Modules {
	surface: Surface;
	engine: Engine;
	registry: Registry;
}

async function load(): Promise< Modules > {
	_resetAllSharedStoresForTests();
	vi.resetModules();
	return {
		surface: await import( '../../src/reveals/surface' ),
		engine: await import( '../../src/reveals/engine' ),
		registry: await import( '../../src/reveals/registry' ),
	};
}

/** Minimal window fixture: root + body + iframe, mounted. */
function makeWindow(): HTMLElement {
	const el = document.createElement( 'div' );
	el.className = 'os-window';
	el.id = 'wp-window-test';
	const body = document.createElement( 'div' );
	body.className = 'os-window__body os-window__body--loading';
	const iframe = document.createElement( 'iframe' );
	iframe.className = 'os-window__iframe';
	body.appendChild( iframe );
	el.appendChild( body );
	document.body.appendChild( el );
	return el;
}

function bodyOf( el: HTMLElement ): HTMLElement {
	return el.querySelector< HTMLElement >( '.os-window__body' )!;
}

/**
 * Put a painted spinner in the window's body. The reveal surface reads
 * the overlay's own `--visible` class to decide whether it has a
 * fade-out to wait for, the same signal the loaded edge uses, so the
 * fixture has to carry it rather than back-date a clock.
 */
function paintSpinner( el: HTMLElement ): void {
	const overlay = document.createElement( 'div' );
	overlay.className = 'os-window__loading os-window__loading--visible';
	bodyOf( el ).appendChild( overlay );
}

/** The covering surface — the reveal layer that is NOT the edge. */
function surfaceOf( el: HTMLElement ): HTMLElement | null {
	return el.querySelector< HTMLElement >(
		'.os-window__reveal:not(.os-window__reveal--edge)',
	);
}

function edgeOf( el: HTMLElement ): HTMLElement | null {
	return el.querySelector< HTMLElement >(
		'.os-window__reveal--edge',
	);
}

function layersOf( el: HTMLElement ): HTMLElement[] {
	return Array.from(
		el.querySelectorAll< HTMLElement >( '.os-window__reveal' ),
	);
}

/** A stub Animation good enough for the paths surface.ts exercises. */
interface StubAnimation {
	cancel: ReturnType< typeof vi.fn >;
	fire: ( type: string ) => void;
}

function installAnimateStub(): {
	calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[];
	animations: StubAnimation[];
} {
	const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] =
		[];
	const animations: StubAnimation[] = [];
	( Element.prototype as unknown as { animate: unknown } ).animate = function (
		keyframes: Keyframe[],
		options: KeyframeAnimationOptions,
	) {
		calls.push( { keyframes, options } );
		const handlers: Record< string, ( () => void )[] > = {};
		const anim: StubAnimation = {
			cancel: vi.fn(),
			fire: ( type ) => ( handlers[ type ] ?? [] ).forEach( ( h ) => h() ),
		};
		animations.push( anim );
		return {
			cancel: anim.cancel,
			addEventListener: ( type: string, handler: () => void ) => {
				( handlers[ type ] ??= [] ).push( handler );
			},
		};
	};
	return { calls, animations };
}

function removeAnimateStub(): void {
	delete ( Element.prototype as unknown as { animate?: unknown } ).animate;
}

/**
 * Stub `getComputedStyle` for the reveal tokens and each layer's paint.
 *
 * jsdom loads no stylesheet, so every computed background is
 * transparent — under which the shell correctly drops both layers.
 * Installed in `beforeEach` with the SHIPPED defaults (surface painted
 * white, edge transparent) so tests exercise the real configuration;
 * tests about the edge opt in with `edge: true`, and tests about the
 * skip path opt out with `surface: false`.
 */
function stubStyles(
	opts: {
		duration?: string;
		thickness?: string;
		edge?: boolean;
		surface?: boolean;
	} = {},
): void {
	const edgeVisible = opts.edge === true;
	const surfaceVisible = opts.surface !== false;
	vi.stubGlobal(
		'getComputedStyle',
		vi.fn( ( el: Element ) => {
			const isEdge = el.classList?.contains(
				'os-window__reveal--edge',
			);
			const visible = isEdge ? edgeVisible : surfaceVisible;
			return {
				getPropertyValue: ( prop: string ) => {
					if ( prop === '--os-window-reveal-duration' ) {
						return opts.duration ?? '';
					}
					if ( prop === '--os-window-reveal-edge-thickness' ) {
						return opts.thickness ?? '';
					}
					return '';
				},
				backgroundImage: 'none',
				backgroundColor: visible
					? 'rgb(255, 255, 255)'
					: 'rgba(0, 0, 0, 0)',
			};
		} ),
	);
}

beforeEach( () => {
	installHooksStub();
	document.body.innerHTML = '';
	// Shipped defaults: an opaque surface, no edge.
	stubStyles();
} );

afterEach( () => {
	clearHooksStub();
	removeAnimateStub();
	vi.unstubAllGlobals();
	vi.useRealTimers();
} );

describe( 'reveals/surface.ts — createRevealLayers', () => {
	test( 'returns nothing when the active reveal is `none`', async () => {
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( registry.WINDOW_REVEAL_NONE );
		expect( surface.createRevealLayers() ).toEqual( [] );
	} );

	test( 'returns nothing when the selected id is not registered', async () => {
		const { surface, engine } = await load();
		// A reveal whose plugin is deactivated: the id survives in user
		// meta, but degrading to a DIFFERENT animation would be stranger
		// than degrading to none.
		engine.setActiveWindowRevealId( 'ghost/plugin-gone' );
		expect( surface.createRevealLayers() ).toEqual( [] );
	} );

	test( 'builds edge-then-surface, both clipped to the reveal’s `from`', async () => {
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( 'iris' );
		const layers = surface.createRevealLayers();
		const from = registry.getWindowReveal( 'iris' )!.from;

		expect( layers ).toHaveLength( 2 );
		// Edge first in DOM order so it paints behind the surface even
		// before the stylesheet's z-index has a say.
		expect( layers[ 0 ].classList.contains( surface.REVEAL_EDGE_CLASS ) ).toBe(
			true,
		);
		expect( layers[ 1 ].classList.contains( surface.REVEAL_EDGE_CLASS ) ).toBe(
			false,
		);
		for ( const layer of layers ) {
			expect( layer.classList.contains( surface.REVEAL_SURFACE_CLASS ) ).toBe(
				true,
			);
			expect( layer.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
			expect( layer.getAttribute( 'data-os-reveal' ) ).toBe( 'iris' );
			expect( layer.style.clipPath ).toBe( from );
		}
	} );

	test( 'omits the edge layer when the def sets edgeLag to 0', async () => {
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/edgeless',
			label: 'Edgeless',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			edgeLag: 0,
		} );
		engine.setActiveWindowRevealId( 'acme/edgeless' );
		const layers = surface.createRevealLayers();
		expect( layers ).toHaveLength( 1 );
		expect( layers[ 0 ].classList.contains( surface.REVEAL_EDGE_CLASS ) ).toBe(
			false,
		);
	} );

} );

describe( 'reveals/surface.ts — armWindowReveal', () => {
	test( 'appends exactly one surface and one edge', async () => {
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		surface.armWindowReveal( win );
		expect( layersOf( win ) ).toHaveLength( 2 );
		expect( surfaceOf( win ) ).not.toBeNull();
		expect( edgeOf( win ) ).not.toBeNull();
	} );

	test( 're-arming replaces rather than stacks', async () => {
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		surface.armWindowReveal( win );
		surface.armWindowReveal( win );
		surface.armWindowReveal( win );
		expect( layersOf( win ) ).toHaveLength( 2 );
	} );

	test( 're-arming cancels BOTH animations it replaces', async () => {
		const { animations } = installAnimateStub();
		vi.useFakeTimers();
		stubStyles( { edge: true } );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );
		expect( animations ).toHaveLength( 2 );

		// A reload lands while the previous reveal is still playing.
		surface.armWindowReveal( win );
		expect( animations[ 0 ].cancel ).toHaveBeenCalled();
		expect( animations[ 1 ].cancel ).toHaveBeenCalled();
	} );

	test( 'clears a stale revealing modifier', async () => {
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		bodyOf( win ).classList.add( surface.REVEALING_BODY_CLASS );
		surface.armWindowReveal( win );
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
	} );

	test( 'adds nothing when the reveal is `none`', async () => {
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( registry.WINDOW_REVEAL_NONE );
		const win = makeWindow();
		surface.armWindowReveal( win );
		expect( layersOf( win ) ).toHaveLength( 0 );
	} );
} );

describe( 'reveals/surface.ts — playWindowReveal timing', () => {
	test( 'plays with no delay when the load beat the spinner’s entry delay', async () => {
		const { calls } = installAnimateStub();
		vi.useFakeTimers();
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		vi.advanceTimersByTime( 40 ); // under the 120 ms spinner delay
		// No overlay ever reached `--visible`, so there is nothing to
		// wait for even though time has passed.
		surface.playWindowReveal( win );

		expect( calls.every( ( c ) => c.options.delay === 0 ) ).toBe( true );
	} );

	test( 'waits for the spinner fade-out when the spinner did appear', async () => {
		const { calls } = installAnimateStub();
		vi.useFakeTimers();
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		vi.advanceTimersByTime( 900 ); // a genuinely slow load
		paintSpinner( win );
		surface.playWindowReveal( win );

		// Both layers wait together, so the edge does not start peeking
		// out from under a surface that has not begun moving.
		expect( calls.every( ( c ) => c.options.delay === 250 ) ).toBe( true );
	} );

	test( 'plays on a fast load too — the reveal is never skipped', async () => {
		const { calls } = installAnimateStub();
		vi.useFakeTimers();
		stubStyles( { edge: true } );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'iris' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		// Same tick: the spinner never painted at all.
		surface.playWindowReveal( win );

		expect( calls ).toHaveLength( 2 );
	} );

	test( 'animates between the def’s matched pair, with a clamped duration', async () => {
		const { calls } = installAnimateStub();
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/slow',
			label: 'Slow',
			from: 'inset( 0% 0% 0% 0% )',
			to: 'inset( 0% 0% 0% 100% )',
			duration: 999_999,
			easing: 'linear',
			edgeLag: 0,
		} );
		engine.setActiveWindowRevealId( 'acme/slow' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		expect( calls[ 0 ].keyframes ).toEqual( [
			{ clipPath: 'inset( 0% 0% 0% 0% )' },
			{ clipPath: 'inset( 0% 0% 0% 100% )' },
		] );
		expect( calls[ 0 ].options.duration ).toBe(
			registry.MAX_REVEAL_DURATION_MS,
		);
		expect( calls[ 0 ].options.easing ).toBe( 'linear' );
		// `fill: both` holds the covering shape through the delay.
		expect( calls[ 0 ].options.fill ).toBe( 'both' );
	} );

	test( 'uses the reveal that armed the surface, not the one selected now', async () => {
		const { calls } = installAnimateStub();
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		surface.armWindowReveal( win );

		// The user switches reveals while the window is still loading.
		engine.setActiveWindowRevealId( 'iris' );
		surface.playWindowReveal( win );

		const sweep = registry.getWindowReveal( 'sweep' )!;
		for ( const call of calls ) {
			expect( call.keyframes ).toEqual( [
				{ clipPath: sweep.from },
				{ clipPath: sweep.to },
			] );
		}
	} );
} );

describe( 'reveals/surface.ts — the leading edge', () => {
	test( 'runs the identical keyframes to the surface', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { edge: true } );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'blinds' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		// The edge has no shape of its own — that is what lets it follow
		// any geometry, including a plugin's.
		expect( calls[ 1 ].keyframes ).toEqual( calls[ 0 ].keyframes );
	} );

	test( 'runs LONGER than the surface, by exactly the def’s lag', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { edge: true } );
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/lagged',
			label: 'Lagged',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			duration: 400,
			edgeLag: 120,
		} );
		engine.setActiveWindowRevealId( 'acme/lagged' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		expect( calls[ 0 ].options.duration ).toBe( 400 );
		expect( calls[ 1 ].options.duration ).toBe( 520 );
	} );

	test( 'defaults the lag when the def does not set one', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { edge: true } );
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/plain',
			label: 'Plain',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			duration: 300,
		} );
		engine.setActiveWindowRevealId( 'acme/plain' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		expect( calls[ 1 ].options.duration ).toBe(
			300 + registry.DEFAULT_REVEAL_EDGE_LAG_MS,
		);
	} );

	test( 'clamps an absurd lag rather than out-running the reveal', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { edge: true } );
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/huge-lag',
			label: 'Huge lag',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			duration: 300,
			edgeLag: 99_999,
		} );
		engine.setActiveWindowRevealId( 'acme/huge-lag' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		expect( calls[ 1 ].options.duration ).toBe(
			300 + registry.MAX_REVEAL_EDGE_LAG_MS,
		);
	} );

	test( 'teardown waits for the edge, not the surface', async () => {
		const { animations } = installAnimateStub();
		stubStyles( { edge: true } );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		// The surface lands first. Tearing down here would rip the edge
		// band off screen mid-travel.
		animations[ 0 ].fire( 'finish' );
		expect( layersOf( win ) ).toHaveLength( 2 );

		animations[ 1 ].fire( 'finish' );
		expect( layersOf( win ) ).toHaveLength( 0 );
	} );

	test( 'is dropped entirely while the edge colour is transparent', async () => {
		// The shipped default: surface painted, edge transparent. An
		// opt-in feature costs nothing for every user who never opts in.
		const { calls } = installAnimateStub();
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'iris' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		expect( edgeOf( win ) ).not.toBeNull(); // created…
		surface.playWindowReveal( win );

		expect( edgeOf( win ) ).toBeNull(); // …and dropped before it ran.
		expect( calls ).toHaveLength( 1 );
	} );

	test( 'a gradient edge counts as visible even with no colour', async () => {
		// Fails OPEN: a missed skip costs one transparent animation, a
		// false positive would silently drop an edge a theme configured.
		const { calls } = installAnimateStub();
		vi.stubGlobal(
			'getComputedStyle',
			vi.fn().mockReturnValue( {
				getPropertyValue: () => '',
				backgroundImage: 'linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))',
				backgroundColor: 'rgba(0, 0, 0, 0)',
			} ),
		);
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );
		expect( calls ).toHaveLength( 2 );
	} );

	test( 'an unreadable computed style keeps the edge', async () => {
		const { calls } = installAnimateStub();
		vi.stubGlobal(
			'getComputedStyle',
			vi.fn().mockReturnValue( {
				getPropertyValue: () => '',
				backgroundImage: 'none',
				backgroundColor: 'chartreuse',
			} ),
		);
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );
		expect( calls ).toHaveLength( 2 );
	} );

	test( 'an edgeless reveal tears down on the surface instead', async () => {
		const { animations } = installAnimateStub();
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/edgeless2',
			label: 'Edgeless',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			edgeLag: 0,
		} );
		engine.setActiveWindowRevealId( 'acme/edgeless2' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );
		expect( animations ).toHaveLength( 1 );

		animations[ 0 ].fire( 'finish' );
		expect( layersOf( win ) ).toHaveLength( 0 );
	} );
} );

describe( 'reveals/surface.ts — custom-rendered reveals', () => {
	/** A minimal renderer: one div, one animation. */
	function stubRenderer(): {
		id: string;
		label: string;
		render: () => { element: HTMLElement; play: () => Animation[] };
	} {
		return {
			id: 'acme/rendered',
			label: 'Rendered',
			render: () => {
				const element = document.createElement( 'div' );
				element.dataset.mine = 'yes';
				return {
					element,
					play: () => [
						element.animate(
							[ { opacity: '1' }, { opacity: '0' } ],
							{ duration: 10 },
						),
					],
				};
			},
		};
	}

	test( 'the host suppresses the surface token’s paint', async () => {
		// Its own DOM is the paint. Left carrying the token background,
		// the host is an opaque rectangle UNDERNEATH the renderer's
		// output — so the effect uncovers that rectangle rather than the
		// page, and the real content only appears when the layer is
		// removed. A clean animation followed by an abrupt pop.
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( stubRenderer() );
		engine.setActiveWindowRevealId( 'acme/rendered' );

		const layers = surface.createRevealLayers();
		expect( layers ).toHaveLength( 1 );
		expect( layers[ 0 ].classList.contains( surface.REVEAL_CUSTOM_CLASS ) ).toBe(
			true,
		);
		expect( layers[ 0 ].dataset.mine ).toBe( 'yes' );
	} );

	test( 'a renderer armed in one bundle still plays from another', async () => {
		// The real shape of the bug this guards. A window's first layers
		// are built by `createWindowElement` in the WINDOW-SYSTEM bundle,
		// and the SHELL bundle is what plays them. Module-level state
		// gives each bundle its own copy, so the arm writes into one map
		// and the play reads an empty other — the reveal vanished on
		// every window OPEN while reload still worked, because that path
		// arms from the shell side.
		//
		// Two module instances WITHOUT resetting the shared stores
		// between them is exactly that situation.
		installAnimateStub();
		const armSide = await load();
		armSide.registry.registerWindowReveal( stubRenderer() );
		armSide.engine.setActiveWindowRevealId( 'acme/rendered' );

		const win = makeWindow();
		armSide.surface.armWindowReveal( win );
		expect( layersOf( win ) ).toHaveLength( 1 );

		// A second, independent copy of the module — the other bundle.
		vi.resetModules();
		const playSide: Surface = await import( '../../src/reveals/surface' );
		expect( playSide ).not.toBe( armSide.surface );

		playSide.playWindowReveal( win );

		// Still on screen and animating: the play was found. Before the
		// fix the layer was dropped here and nothing ran.
		expect( layersOf( win ) ).toHaveLength( 1 );
		expect(
			bodyOf( win ).classList.contains( playSide.REVEALING_BODY_CLASS ),
		).toBe( true );
	} );

	test( 'a renderer that throws leaves the window uncovered', async () => {
		const spy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => undefined );
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/broken-render',
			label: 'Broken',
			render: () => {
				throw new Error( 'boom' );
			},
		} );
		engine.setActiveWindowRevealId( 'acme/broken-render' );
		expect( surface.createRevealLayers() ).toEqual( [] );
		expect( spy ).toHaveBeenCalled();
		spy.mockRestore();
	} );
} );

describe( 'reveals/surface.ts — surface paint', () => {
	test( 'a def’s surfaceColor is written inline, beating the token', async () => {
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/painted',
			label: 'Painted',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			surfaceColor: '#0b0b0e',
		} );
		engine.setActiveWindowRevealId( 'acme/painted' );
		const layers = surface.createRevealLayers();
		const painted = layers.find(
			( l ) => ! l.classList.contains( surface.REVEAL_EDGE_CLASS ),
		)!;
		expect( painted.style.background ).toBe( 'rgb(11, 11, 14)' );
	} );

	test( 'surfaceColor never leaks onto the edge layer', async () => {
		// A reveal's identity colour is its surface; the edge stays the
		// theme's to decide.
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/painted2',
			label: 'Painted',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			surfaceColor: '#0b0b0e',
		} );
		engine.setActiveWindowRevealId( 'acme/painted2' );
		const edge = surface
			.createRevealLayers()
			.find( ( l ) => l.classList.contains( surface.REVEAL_EDGE_CLASS ) )!;
		expect( edge.style.background ).toBe( '' );
	} );

	test( 'a per-layer colour beats the def’s surfaceColor', async () => {
		// Overlapping parts are only visible when neighbours differ, so
		// the layer's own tone has to outrank a def-wide one.
		const { surface, engine, registry } = await load();
		registry.registerWindowReveal( {
			id: 'acme/shaded',
			label: 'Shaded',
			surfaceColor: '#111111',
			layers: [
				{ from: 'inset( 0% )', to: 'inset( 100% )', color: '#ff0000' },
				{ from: 'inset( 0% )', to: 'inset( 100% )' },
			],
			edgeLag: 0,
		} );
		engine.setActiveWindowRevealId( 'acme/shaded' );
		const layers = surface.createRevealLayers();
		expect( layers ).toHaveLength( 2 );
		expect( layers[ 0 ].style.background ).toBe( 'rgb(255, 0, 0)' );
		// The layer without its own tone falls back to the def's.
		expect( layers[ 1 ].style.background ).toBe( 'rgb(17, 17, 17)' );
	} );

	test( 'a transparent surface AND edge means no reveal at all', async () => {
		// `transparent` is a legitimate token value meaning "no covering
		// surface". With nothing to paint there is nothing to animate,
		// and — importantly — the body must NOT be pinned by
		// `--revealing`, or the content would be stuck at the opacity a
		// transition that never runs was supposed to hand it.
		const { calls } = installAnimateStub();
		stubStyles( { surface: false } );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		expect( calls ).toHaveLength( 0 );
		expect( layersOf( win ) ).toHaveLength( 0 );
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
	} );

	test( 'a transparent surface with a painted edge still plays the edge', async () => {
		// A moving band with no cover behind it is a legitimate look,
		// so the surface being off must not take the edge down with it.
		const { calls } = installAnimateStub();
		stubStyles( { surface: false, edge: true } );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		expect( calls ).toHaveLength( 1 );
		expect( surfaceOf( win ) ).toBeNull();
		expect( edgeOf( win ) ).not.toBeNull();
	} );

	test( 'teardown falls back to the surface when the edge is off', async () => {
		const { animations } = installAnimateStub();
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );
		expect( animations ).toHaveLength( 1 );

		animations[ 0 ].fire( 'finish' );
		expect( layersOf( win ) ).toHaveLength( 0 );
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
	} );
} );

describe( 'reveals/surface.ts — edge thickness token', () => {
	async function withReveal(): Promise< { mods: Modules; win: HTMLElement } > {
		const mods = await load();
		mods.registry.registerWindowReveal( {
			id: 'acme/thick',
			label: 'Thick',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			duration: 400,
			edgeLag: 40,
		} );
		mods.engine.setActiveWindowRevealId( 'acme/thick' );
		return { mods, win: makeWindow() };
	}

	test( 'a percentage is read as a fraction of the reveal’s travel', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { thickness: '25%', edge: true } );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		// 25% of a 400 ms travel ⇒ 100 ms of lag, overriding the def's 40.
		expect( calls[ 1 ].options.duration ).toBe( 500 );
	} );

	test( 'a unitless value is the same fraction', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { thickness: '0.25', edge: true } );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 1 ].options.duration ).toBe( 500 );
	} );

	test( 'a time value is read as an absolute lag', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { thickness: '120ms', edge: true } );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 1 ].options.duration ).toBe( 520 );
	} );

	test( 'the token beats the def’s own edgeLag outright', async () => {
		// Thickness is a property of the theme's look, not of any one
		// reveal — so it overrides rather than scales.
		const { calls } = installAnimateStub();
		stubStyles( { thickness: '10%', edge: true } );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 1 ].options.duration ).toBe( 440 );
	} );

	test( 'a thickness of zero drops the edge', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { thickness: '0%', edge: true } );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls ).toHaveLength( 1 );
		expect( edgeOf( win ) ).toBeNull();
	} );

	test( 'the token is clamped to the playable lag range', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { thickness: '900%', edge: true } );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 1 ].options.duration ).toBe(
			400 + mods.registry.MAX_REVEAL_EDGE_LAG_MS,
		);
	} );

	test( 'an unparseable token falls back to the def’s edgeLag', async () => {
		for ( const raw of [ 'thick', '10px', 'calc( 1% )' ] ) {
			const { calls } = installAnimateStub();
			stubStyles( { thickness: raw, edge: true } );
			const { mods, win } = await withReveal();
			mods.surface.armWindowReveal( win );
			mods.surface.playWindowReveal( win );
			expect( calls[ 1 ].options.duration, raw ).toBe( 440 );
			removeAnimateStub();
		}
	} );

	test( 'the thickness follows a duration override, not the def', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { thickness: '25%', edge: true } );
		const { mods, win } = await withReveal();
		mods.engine.setActiveWindowRevealDuration( 800 );
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		// 25% of the RESOLVED 800 ms, so the band's apparent width is
		// the same at any speed.
		expect( calls[ 1 ].options.duration ).toBe( 1000 );
	} );
} );

describe( 'reveals/surface.ts — duration resolution', () => {
	/** Stub the reveal-duration theme token, edge enabled. */
	function stubThemeToken( value: string ): void {
		stubStyles( { duration: value, edge: true } );
	}

	async function withReveal(): Promise< {
		mods: Modules;
		win: HTMLElement;
	} > {
		const mods = await load();
		mods.registry.registerWindowReveal( {
			id: 'acme/timed',
			label: 'Timed',
			from: 'inset( 0% )',
			to: 'inset( 100% )',
			duration: 400,
			edgeLag: 100,
		} );
		mods.engine.setActiveWindowRevealId( 'acme/timed' );
		return { mods, win: makeWindow() };
	}

	test( 'uses the def’s own duration when nothing overrides it', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { edge: true } );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 0 ].options.duration ).toBe( 400 );
		expect( calls[ 1 ].options.duration ).toBe( 500 );
	} );

	test( 'the OS Settings override wins over the def', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { edge: true } );
		const { mods, win } = await withReveal();
		mods.engine.setActiveWindowRevealDuration( 800 );
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 0 ].options.duration ).toBe( 800 );
	} );

	test( 'the edge lag scales with the override, keeping the band’s width', async () => {
		const { calls } = installAnimateStub();
		stubStyles( { edge: true } );
		const { mods, win } = await withReveal();
		// Twice the duration ⇒ twice the lag, so the band still covers
		// the same FRACTION of the travel and looks the same width.
		mods.engine.setActiveWindowRevealDuration( 800 );
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 1 ].options.duration ).toBe( 1000 );
	} );

	test( 'the theme token applies when the user has no override', async () => {
		const { calls } = installAnimateStub();
		stubThemeToken( '900ms' );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 0 ].options.duration ).toBe( 900 );
	} );

	test( 'the user’s override out-ranks the theme token', async () => {
		const { calls } = installAnimateStub();
		stubThemeToken( '900ms' );
		const { mods, win } = await withReveal();
		mods.engine.setActiveWindowRevealDuration( 250 );
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 0 ].options.duration ).toBe( 250 );
	} );

	test( 'reads the theme token in seconds and unitless too', async () => {
		for ( const [ raw, expected ] of [
			[ '0.9s', 900 ],
			[ '900', 900 ],
			[ '  900ms  ', 900 ],
		] as const ) {
			const { calls } = installAnimateStub();
			stubThemeToken( raw );
			const { mods, win } = await withReveal();
			mods.surface.armWindowReveal( win );
			mods.surface.playWindowReveal( win );
			expect( calls[ 0 ].options.duration, raw ).toBe( expected );
			removeAnimateStub();
		}
	} );

	test( 'an unparseable or absent token falls through to the def', async () => {
		for ( const raw of [ '', 'fast', '10px' ] ) {
			const { calls } = installAnimateStub();
			stubThemeToken( raw );
			const { mods, win } = await withReveal();
			mods.surface.armWindowReveal( win );
			mods.surface.playWindowReveal( win );
			expect( calls[ 0 ].options.duration, raw ).toBe( 400 );
			removeAnimateStub();
		}
	} );

	test( 'a token outside the playable range is clamped, not dropped', async () => {
		const { calls } = installAnimateStub();
		stubThemeToken( '30s' );
		const { mods, win } = await withReveal();
		mods.surface.armWindowReveal( win );
		mods.surface.playWindowReveal( win );
		expect( calls[ 0 ].options.duration ).toBe(
			mods.registry.MAX_REVEAL_DURATION_MS,
		);
	} );
} );

describe( 'reveals/surface.ts — playWindowReveal lifecycle', () => {
	test( 'no-ops when nothing was armed', async () => {
		installAnimateStub();
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( registry.WINDOW_REVEAL_NONE );
		const win = makeWindow();
		expect( () => surface.playWindowReveal( win ) ).not.toThrow();
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
	} );

	test( 'marks the body as revealing, then clears it on finish', async () => {
		const { animations } = installAnimateStub();
		stubStyles( { edge: true } );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'curtain' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( true );

		// The edge is the last to land.
		animations[ 1 ].fire( 'finish' );
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
		expect( layersOf( win ) ).toHaveLength( 0 );
	} );

	test( 'a cancelled reveal still clears the revealing modifier', async () => {
		const { animations } = installAnimateStub();
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'blinds' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );
		animations[ 0 ].fire( 'cancel' );

		// Content must never be left pinned by a modifier whose
		// animation is gone.
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
	} );

	test( 'removes every layer when the armed def vanished', async () => {
		installAnimateStub();
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		surface.armWindowReveal( win );

		// The plugin owning the armed reveal deactivates mid-load.
		registry.unregisterWindowReveal( 'sweep' );
		surface.playWindowReveal( win );

		// Content uncovered rather than left under layers that can no
		// longer be animated away.
		expect( layersOf( win ) ).toHaveLength( 0 );
	} );

	test( 'without the Web Animations API, uncovers after the delay', async () => {
		vi.useFakeTimers();
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		vi.advanceTimersByTime( 900 );
		surface.playWindowReveal( win );

		// Still covered while the spinner is fading — by the surface
		// alone, since the paint check runs ahead of this fallback path
		// too and the default edge is transparent.
		expect( layersOf( win ) ).toHaveLength( 1 );
		expect( surfaceOf( win ) ).not.toBeNull();
		vi.advanceTimersByTime( 250 );
		expect( layersOf( win ) ).toHaveLength( 0 );
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
	} );

	test( 'under prefers-reduced-motion, uncovers without animating', async () => {
		const { calls } = installAnimateStub();
		vi.useFakeTimers();
		const matchMedia = vi.fn().mockReturnValue( { matches: true } );
		vi.stubGlobal( 'matchMedia', matchMedia );

		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'iris' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		surface.playWindowReveal( win );

		expect( calls ).toHaveLength( 0 );
		vi.advanceTimersByTime( 1 );
		expect( layersOf( win ) ).toHaveLength( 0 );
		vi.unstubAllGlobals();
	} );
} );

describe( 'reveals/surface.ts — failure containment', () => {
	test( 'uncovers the window instead of throwing when `animate()` refuses its input', async () => {
		// Registration validates `easing`, but a def injected through
		// the `os.window-reveals` filter never went through
		// registration — `animate()` can still throw. The one
		// unacceptable outcome is a window stranded under the opaque
		// armed surface.
		( Element.prototype as unknown as { animate: unknown } ).animate =
			() => {
				throw new TypeError( 'unparsable easing' );
			};
		const errorSpy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		surface.armWindowReveal( win );

		expect( () => surface.playWindowReveal( win ) ).not.toThrow();
		expect( layersOf( win ) ).toHaveLength( 0 );
		expect(
			bodyOf( win ).classList.contains( surface.REVEALING_BODY_CLASS ),
		).toBe( false );
		expect( errorSpy ).toHaveBeenCalled();
		errorSpy.mockRestore();
	} );

	test( 'uncovers the window when the reveals filter throws at play time', async () => {
		// The play-time def lookup runs the `os.window-reveals`
		// filter; a plugin's throwing callback must degrade to "no
		// reveal", not propagate with the surface still covering the
		// window.
		const hooks = installHooksStub();
		const errorSpy = vi
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		surface.armWindowReveal( win );
		hooks.addFilter( 'os.window-reveals', 'test/boom', () => {
			throw new Error( 'boom' );
		} );

		expect( () => surface.playWindowReveal( win ) ).not.toThrow();
		expect( layersOf( win ) ).toHaveLength( 0 );
		expect( errorSpy ).toHaveBeenCalled();
		errorSpy.mockRestore();
	} );
} );
