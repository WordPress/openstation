/**
 * Unit tests for the built-in `svg-splines` window-link renderer
 * (`src/window-links/renderers/svg-splines.ts`):
 *
 *   - self-registration through the public registry
 *   - one keyed `<g>` + arrowed `<path>` per edge, REUSED across
 *     frames (only `d` updates)
 *   - direction: `marker-end` always (arrow at the target window);
 *     `marker-start` only on bidirectional reference edges
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
		...overrides,
	};
}

function frameWith( edges: FrameEdge[] ): WindowLinkFrame {
	return { groups: [], edges, container: { width: 800, height: 600 } };
}

interface Harness {
	container: HTMLElement;
	emit: ( frame: WindowLinkFrame ) => void;
	teardown: () => void;
	subscriberCount: () => number;
}

async function mount( initial: WindowLinkFrame ): Promise< Harness > {
	const def = await loadDef();
	const container = document.createElement( 'div' );
	document.body.appendChild( container );
	const subscribers = new Set< ( f: WindowLinkFrame ) => void >();
	let current = initial;
	const ctx: WindowLinkRendererContext = {
		container,
		getFrame: () => current,
		onFrame: ( cb ) => {
			subscribers.add( cb );
			return () => subscribers.delete( cb );
		},
	};
	const cleanup = ( await def.mount( ctx ) ) as () => void;
	return {
		container,
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
	test( 'draws one keyed edge group per drawable edge, arrow at the target', async () => {
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
			svg!.querySelectorAll( 'g.desktop-mode-window-link' ),
		).toHaveLength( 2 );
		const path = svg!.querySelector( '.desktop-mode-window-link__path' )!;
		expect( path.getAttribute( 'd' ) ).toMatch( /^M .+ C .+/ );
		// Single-direction edge: arrowhead at the root end only.
		expect( path.getAttribute( 'marker-end' ) ).toMatch( /^url\(#/ );
		expect( path.getAttribute( 'marker-start' ) ).toBeNull();
		// Marker defs exist.
		expect( svg!.querySelectorAll( 'defs marker' ) ).toHaveLength( 2 );
	} );

	test( 'bidirectional reference edges carry arrowheads at both ends', async () => {
		const h = await mount(
			frameWith( [
				edge( { kind: 'reference', bidirectional: true } ),
			] ),
		);

		const path = h.container.querySelector(
			'.desktop-mode-window-link__path',
		)!;
		expect( path.getAttribute( 'marker-end' ) ).toMatch( /^url\(#/ );
		expect( path.getAttribute( 'marker-start' ) ).toBe(
			path.getAttribute( 'marker-end' ),
		);
	} );

	test( 'reuses the same elements across frames — only `d` changes', async () => {
		const h = await mount( frameWith( [ edge() ] ) );
		const svg = h.container.querySelector( 'svg' )!;
		const before = svg.querySelector( '.desktop-mode-window-link__path' )!;
		const dBefore = before.getAttribute( 'd' );

		h.emit(
			frameWith( [
				edge( { from: { x: 400, y: 350, width: 100, height: 100 } } ),
			] ),
		);

		const after = svg.querySelector( '.desktop-mode-window-link__path' )!;
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
			h.container.querySelectorAll( 'g.desktop-mode-window-link' ),
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
			h.container.querySelectorAll( 'g.desktop-mode-window-link' ),
		).toHaveLength( 1 );
	} );

	test( 'focused edges use the active marker and class', async () => {
		const h = await mount( frameWith( [ edge( { focused: true } ) ] ) );

		const active = h.container.querySelector(
			'.desktop-mode-window-link--active .desktop-mode-window-link__path',
		)!;
		expect( active ).not.toBeNull();
		expect( active.getAttribute( 'marker-end' ) ).toMatch( /arrow-active/ );

		h.emit( frameWith( [ edge( { focused: false } ) ] ) );
		expect(
			h.container.querySelector( '.desktop-mode-window-link--active' ),
		).toBeNull();
		expect(
			h.container
				.querySelector( '.desktop-mode-window-link__path' )!
				.getAttribute( 'marker-end' ),
		).not.toMatch( /arrow-active/ );
	} );

	test( 'teardown removes the svg and unsubscribes', async () => {
		const h = await mount( frameWith( [] ) );
		expect( h.container.querySelector( 'svg' ) ).not.toBeNull();
		expect( h.subscriberCount() ).toBe( 1 );

		h.teardown();

		expect( h.container.querySelector( 'svg' ) ).toBeNull();
		expect( h.subscriberCount() ).toBe( 0 );
	} );
} );
