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

function paintSpinner( el: HTMLElement ): void {
	const overlay = document.createElement( 'div' );
	overlay.className = 'os-window__loading os-window__loading--visible';
	bodyOf( el ).appendChild( overlay );
}

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

		engine.setActiveWindowRevealId( 'ghost/plugin-gone' );
		expect( surface.createRevealLayers() ).toEqual( [] );
	} );

	test( 'builds edge-then-surface, both clipped to the reveal’s `from`', async () => {
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( 'iris' );
		const layers = surface.createRevealLayers();
		const from = registry.getWindowReveal( 'iris' )!.from;

		expect( layers ).toHaveLength( 2 );

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
		vi.advanceTimersByTime( 40 );

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
		vi.advanceTimersByTime( 900 );
		paintSpinner( win );
		surface.playWindowReveal( win );

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

		expect( calls[ 0 ].options.fill ).toBe( 'both' );
	} );

	test( 'uses the reveal that armed the surface, not the one selected now', async () => {
		const { calls } = installAnimateStub();
		const { surface, engine, registry } = await load();
		engine.setActiveWindowRevealId( 'sweep' );
		const win = makeWindow();
		surface.armWindowReveal( win );

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

		animations[ 0 ].fire( 'finish' );
		expect( layersOf( win ) ).toHaveLength( 2 );

		animations[ 1 ].fire( 'finish' );
		expect( layersOf( win ) ).toHaveLength( 0 );
	} );

	test( 'is dropped entirely while the edge colour is transparent', async () => {

		const { calls } = installAnimateStub();
		const { surface, engine } = await load();
		engine.setActiveWindowRevealId( 'iris' );
		const win = makeWindow();

		surface.armWindowReveal( win );
		expect( edgeOf( win ) ).not.toBeNull();
		surface.playWindowReveal( win );

		expect( edgeOf( win ) ).toBeNull();
		expect( calls ).toHaveLength( 1 );
	} );

	test( 'a gradient edge counts as visible even with no colour', async () => {

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

		installAnimateStub();
		const armSide = await load();
		armSide.registry.registerWindowReveal( stubRenderer() );
		armSide.engine.setActiveWindowRevealId( 'acme/rendered' );

		const win = makeWindow();
		armSide.surface.armWindowReveal( win );
		expect( layersOf( win ) ).toHaveLength( 1 );

		vi.resetModules();
		const playSide: Surface = await import( '../../src/reveals/surface' );
		expect( playSide ).not.toBe( armSide.surface );

		playSide.playWindowReveal( win );

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

		expect( layers[ 1 ].style.background ).toBe( 'rgb(17, 17, 17)' );
	} );

	test( 'a transparent surface AND edge means no reveal at all', async () => {

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

		expect( calls[ 1 ].options.duration ).toBe( 1000 );
	} );
} );

describe( 'reveals/surface.ts — duration resolution', () => {

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

		registry.unregisterWindowReveal( 'sweep' );
		surface.playWindowReveal( win );

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
