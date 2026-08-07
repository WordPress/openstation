/**
 * Unit tests for the built-in `svg-splines` window-link renderer
 * (`src/window-links/renderers/svg-splines.ts`):
 *
 *   - self-registration through the public registry
 *   - one keyed `<g>` + dot-terminated `<path>` per edge, REUSED
 *     across frames (only `d` updates)
 *   - direction as dot size: the large `dot` marker at the target
 *     window, the small `port` marker at the source; bidirectional
 *     reference edges get the large dot at both ends
 *   - a `null` endpoint rect (minimized / other desktop) draws nothing
 *   - stale edges are removed when structure changes
 *   - focused edges swap to the active marker + class
 *   - teardown removes the `<svg>` and unsubscribes
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { clearHooksStub, installHooksStub } from './helpers/hooks-stub';
import type {
	WindowLinkFrame,
	WindowLinkRendererContext,
	WindowLinkRendererDef,
} from '../../src/window-links/types';

async function loadDef(): Promise< WindowLinkRendererDef > {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	const registry = await import(
		'../../src/window-links/renderer-registry'
	);
	await import( '../../src/window-links/renderers/svg-splines' );
	const def = registry.getWindowLinkRenderer( 'svg-splines' );
	if ( ! def ) {
		throw new Error( 'svg-splines did not self-register' );
	}
	return def;
}

type FrameEdge = WindowLinkFrame[ 'edges' ][ number ];

const RECT_A = { x: 0, y: 0, width: 100, height: 100 };
const RECT_B = { x: 300, y: 300, width: 100, height: 100 };

function edge( overrides: Partial< FrameEdge > = {} ): FrameEdge {
	return {
		fromWindowId: 'child-win',
		toWindowId: 'root-win',
		kind: 'child-root',
		bidirectional: false,
		focused: false,
		from: RECT_B,
		to: RECT_A,
		fromZIndex: null,
		toZIndex: null,
		elevated: false,
		...overrides,
	};
}

function frameWith(
	edges: FrameEdge[],
	obstacles: WindowLinkFrame[ 'obstacles' ] = [],
): WindowLinkFrame {
	return {
		groups: [],
		edges,
		obstacles,
		container: { width: 800, height: 600 },
	};
}

interface Harness {
	container: HTMLElement;
	elevatedContainer: HTMLElement;
	emit: ( frame: WindowLinkFrame ) => void;
	teardown: () => void;
	subscriberCount: () => number;
}

async function mount( initial: WindowLinkFrame ): Promise< Harness > {
	const def = await loadDef();
	const container = document.createElement( 'div' );
	const elevatedContainer = document.createElement( 'div' );
	document.body.append( container, elevatedContainer );
	const subscribers = new Set< ( f: WindowLinkFrame ) => void >();
	let current = initial;
	const ctx: WindowLinkRendererContext = {
		container,
		elevatedContainer,
		getFrame: () => current,
		onFrame: ( cb ) => {
			subscribers.add( cb );
			return () => subscribers.delete( cb );
		},
	};
	const cleanup = ( await def.mount( ctx ) ) as () => void;
	return {
		container,
		elevatedContainer,
		emit: ( frame ) => {
			current = frame;
			for ( const cb of subscribers ) {
				cb( frame );
			}
		},
		teardown: cleanup,
		subscriberCount: () => subscribers.size,
	};
}

beforeEach( () => {
	installHooksStub();
} );
afterEach( () => {
	document.body.innerHTML = '';
	clearHooksStub();
	_resetAllSharedStoresForTests();
	vi.restoreAllMocks();
} );

describe( 'svg-splines renderer', () => {
	test( 'draws one keyed edge group per drawable edge, large dot at the target', async () => {
		const h = await mount(
			frameWith( [
				edge(),
				edge( {
					fromWindowId: 'other-child',
					from: { x: 500, y: 50, width: 100, height: 100 },
				} ),
			] ),
		);

		const svg = h.container.querySelector( 'svg' );
		expect( svg ).not.toBeNull();
		expect(
			svg!.querySelectorAll( 'g.os-window-link' ),
		).toHaveLength( 2 );
		const path = svg!.querySelector( '.os-window-link__path' )!;
		expect( path.getAttribute( 'd' ) ).toMatch( /^M .+ C .+/ );
		// Single-direction edge: large dot at the root end, small port
		// at the source end.
		expect( path.getAttribute( 'marker-end' ) ).toMatch( /-dot\)$/ );
		expect( path.getAttribute( 'marker-start' ) ).toMatch( /-port\)$/ );
		// Marker defs: dot + port, each with an active variant — all
		// circles (no orientation, so no skewed-angle artifacts).
		const markers = svg!.querySelectorAll( 'defs marker' );
		expect( markers ).toHaveLength( 4 );
		for ( const marker of Array.from( markers ) ) {
			expect( marker.querySelector( 'circle' ) ).not.toBeNull();
			expect( marker.getAttribute( 'orient' ) ).toBeNull();
		}
	} );

	test( 'bidirectional reference edges carry the large dot at both ends', async () => {
		const h = await mount(
			frameWith( [
				edge( { kind: 'reference', bidirectional: true } ),
			] ),
		);

		const path = h.container.querySelector(
			'.os-window-link__path',
		)!;
		expect( path.getAttribute( 'marker-end' ) ).toMatch( /-dot\)$/ );
		expect( path.getAttribute( 'marker-start' ) ).toBe(
			path.getAttribute( 'marker-end' ),
		);
	} );

	test( 'reuses the same elements across frames — only `d` changes', async () => {
		const h = await mount( frameWith( [ edge() ] ) );
		const svg = h.container.querySelector( 'svg' )!;
		const before = svg.querySelector( '.os-window-link__path' )!;
		const dBefore = before.getAttribute( 'd' );

		h.emit(
			frameWith( [
				edge( { from: { x: 400, y: 350, width: 100, height: 100 } } ),
			] ),
		);

		const after = svg.querySelector( '.os-window-link__path' )!;
		expect( after ).toBe( before );
		expect( after.getAttribute( 'd' ) ).not.toBe( dBefore );
	} );

	test( 'a null endpoint rect draws no edge', async () => {
		const h = await mount(
			frameWith( [
				edge( { from: null } ),
				edge( {
					fromWindowId: 'other-child',
					from: { x: 500, y: 50, width: 100, height: 100 },
				} ),
			] ),
		);

		expect(
			h.container.querySelectorAll( 'g.os-window-link' ),
		).toHaveLength( 1 );
	} );

	test( 'stale edges are removed when structure changes', async () => {
		const h = await mount(
			frameWith( [
				edge(),
				edge( {
					fromWindowId: 'other-child',
					from: { x: 500, y: 50, width: 100, height: 100 },
				} ),
			] ),
		);

		h.emit( frameWith( [ edge() ] ) );

		expect(
			h.container.querySelectorAll( 'g.os-window-link' ),
		).toHaveLength( 1 );
	} );

	test( 'focused edges use the active marker and class', async () => {
		const h = await mount( frameWith( [ edge( { focused: true } ) ] ) );

		const active = h.container.querySelector(
			'.os-window-link--active .os-window-link__path',
		)!;
		expect( active ).not.toBeNull();
		expect( active.getAttribute( 'marker-end' ) ).toMatch( /dot-active/ );
		expect( active.getAttribute( 'marker-start' ) ).toMatch(
			/port-active/,
		);

		h.emit( frameWith( [ edge( { focused: false } ) ] ) );
		expect(
			h.container.querySelector( '.os-window-link--active' ),
		).toBeNull();
		expect(
			h.container
				.querySelector( '.os-window-link__path' )!
				.getAttribute( 'marker-end' ),
		).not.toMatch( /dot-active/ );
	} );

	test( 'an occluded anchor relocates to the visible border stretch', async () => {
		// Source window at z 100; a sibling at z 101 covers the upper
		// part of its right border where the classic center-ray anchor
		// (400, 350) would land. The path must start on the remaining
		// VISIBLE stretch of that border instead.
		const from = { x: 300, y: 300, width: 100, height: 100 }; // right edge x=400, y∈[300,400]
		const to = { x: 600, y: 300, width: 100, height: 100 };
		const sibling = {
			windowId: 'sibling',
			rect: { x: 380, y: 280, width: 100, height: 90 }, // covers right edge y∈[300,370]
			zIndex: 101,
		};
		const h = await mount(
			frameWith(
				[ edge( { from, to, fromZIndex: 100, toZIndex: 102 } ) ],
				[ sibling ],
			),
		);

		const d = h.container
			.querySelector( '.os-window-link__path' )!
			.getAttribute( 'd' )!;
		// Visible right-border stretch is y∈[370,400] → midpoint 385.
		expect( d.startsWith( 'M 400 385' ) ).toBe( true );
	} );

	test( 'the shortest edge-to-edge connection wins when visible', async () => {
		// Side-by-side windows with a vertical offset: centers would
		// produce a diagonal; the shortest connector crosses the gap
		// straight at the y-overlap midpoint.
		const from = { x: 300, y: 300, width: 100, height: 100 };
		const to = { x: 600, y: 340, width: 100, height: 100 }; // y overlap [340,400] → mid 370
		const h = await mount(
			frameWith(
				[ edge( { from, to, fromZIndex: 100, toZIndex: 102 } ) ],
				[], // nothing occludes
			),
		);

		const d = h.container
			.querySelector( '.os-window-link__path' )!
			.getAttribute( 'd' )!;
		expect( d.startsWith( 'M 400 370' ) ).toBe( true );
		expect( d.endsWith( '600 370' ) ).toBe( true );
	} );

	test( 'an occluded shortest anchor falls back to the previous rules per endpoint', async () => {
		const from = { x: 300, y: 300, width: 100, height: 100 };
		const to = { x: 600, y: 300, width: 100, height: 100 }; // shortest pair: (400,350)→(600,350)
		// Occluder covering the source's shortest point (and the classic
		// ray) but leaving the lower right edge visible.
		const sibling = {
			windowId: 'sibling',
			rect: { x: 380, y: 280, width: 100, height: 90 },
			zIndex: 101,
		};
		const h = await mount(
			frameWith(
				[ edge( { from, to, fromZIndex: 100, toZIndex: 102 } ) ],
				[ sibling ],
			),
		);

		const d = h.container
			.querySelector( '.os-window-link__path' )!
			.getAttribute( 'd' )!;
		// Source: shortest (400,350) occluded → visible stretch midpoint
		// (400,385). Target: shortest (600,350) visible → kept.
		expect( d.startsWith( 'M 400 385' ) ).toBe( true );
		expect( d.endsWith( '600 350' ) ).toBe( true );
	} );

	test( 'elevated edges draw on the elevated surface and migrate back', async () => {
		const h = await mount( frameWith( [ edge( { elevated: true } ) ] ) );

		expect(
			h.elevatedContainer.querySelectorAll(
				'.os-window-link__path',
			),
		).toHaveLength( 1 );
		expect(
			h.container.querySelectorAll( '.os-window-link__path' ),
		).toHaveLength( 0 );

		// Focus moved away — the edge migrates to the base surface.
		h.emit( frameWith( [ edge( { elevated: false } ) ] ) );
		expect(
			h.elevatedContainer.querySelectorAll(
				'.os-window-link__path',
			),
		).toHaveLength( 0 );
		expect(
			h.container.querySelectorAll( '.os-window-link__path' ),
		).toHaveLength( 1 );
	} );

	test( 'teardown removes both svgs and unsubscribes', async () => {
		const h = await mount( frameWith( [] ) );
		expect( h.container.querySelector( 'svg' ) ).not.toBeNull();
		expect( h.elevatedContainer.querySelector( 'svg' ) ).not.toBeNull();
		expect( h.subscriberCount() ).toBe( 1 );

		h.teardown();

		expect( h.container.querySelector( 'svg' ) ).toBeNull();
		expect( h.elevatedContainer.querySelector( 'svg' ) ).toBeNull();
		expect( h.subscriberCount() ).toBe( 0 );
	} );
} );
