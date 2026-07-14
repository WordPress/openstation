/**
 * Integration test for the window-link render host
 * (`src/window-links/render-host.ts`) — the full chain the feature
 * rides in production, minus the iframe bridge:
 *
 *   relations.set → engine notify → host recompute → layer mounted in
 *   #desktop-mode-area → built-in svg-splines mounted → paths drawn
 *   with live rects → visibility class per policy → chrome highlight.
 *
 * jsdom can't lay out, so window elements get their offset* metrics
 * stubbed via defineProperty.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { _resetAllSharedStoresForTests } from '../../src/shared-store';
import { HOOKS } from '../../src/hooks';
import {
	clearHooksStub,
	installHooksStub,
	type FakeWpHooks,
} from './helpers/hooks-stub';

type EngineModule = typeof import( '../../src/window-links/engine' );
type HostModule = typeof import( '../../src/window-links/render-host' );

interface FakeWin {
	id: string;
	state: string;
	element: HTMLElement;
	isFocused: () => boolean;
	config: Record< string, unknown >;
}

function makeWin(
	id: string,
	rect: { x: number; y: number; width: number; height: number },
	focused = false,
): FakeWin {
	const element = document.createElement( 'div' );
	document.getElementById( 'desktop-mode-area' )!.appendChild( element );
	Object.defineProperty( element, 'offsetParent', {
		get: () => document.getElementById( 'desktop-mode-area' ),
	} );
	Object.defineProperty( element, 'offsetLeft', { get: () => rect.x } );
	Object.defineProperty( element, 'offsetTop', { get: () => rect.y } );
	Object.defineProperty( element, 'offsetWidth', {
		get: () => rect.width,
	} );
	Object.defineProperty( element, 'offsetHeight', {
		get: () => rect.height,
	} );
	return {
		id,
		state: 'normal',
		element,
		isFocused: () => focused,
		config: {},
	};
}

function makeManager( wins: FakeWin[] ) {
	return {
		getById: ( id: string ) => wins.find( ( w ) => w.id === id ) ?? null,
		getAll: () => wins,
		getFocused: () => wins.find( ( w ) => w.isFocused() ) ?? null,
		raise: vi.fn(),
	};
}

function makeOsSettings(
	overrides: Partial< {
		windowLinkRenderer: string;
		windowLinkVisibility: string;
		windowLinksEnabled: boolean;
		windowLinkRaiseOnFocus: boolean;
		windowLinkHighlight: boolean;
	} > = {},
) {
	const snapshot = {
		windowLinkRenderer: 'svg-splines',
		windowLinkVisibility: 'focus',
		windowLinksEnabled: true,
		windowLinkRaiseOnFocus: true,
		windowLinkHighlight: true,
		...overrides,
	};
	const listeners = new Set< ( s: unknown ) => void >();
	return {
		getOsSettingsSnapshot: () => ( { ...snapshot } ),
		subscribeOsSettings: ( cb: ( s: unknown ) => void ) => {
			listeners.add( cb );
			return () => listeners.delete( cb );
		},
		_update( patch: Record< string, unknown > ) {
			Object.assign( snapshot, patch );
			for ( const cb of listeners ) {
				cb( { ...snapshot } );
			}
		},
	};
}

async function loadModules(): Promise< {
	engine: EngineModule;
	host: HostModule;
} > {
	vi.resetModules();
	_resetAllSharedStoresForTests();
	const engine = await import( '../../src/window-links/engine' );
	const host = await import( '../../src/window-links/render-host' );
	return { engine, host };
}

let hooks: FakeWpHooks;
let rafQueue: FrameRequestCallback[];

/** Run every queued rAF callback (and any it queues, once more). */
function flushRaf(): void {
	for ( let i = 0; i < 5 && rafQueue.length > 0; i++ ) {
		const batch = rafQueue.splice( 0 );
		for ( const cb of batch ) {
			cb( performance.now() );
		}
	}
}

beforeEach( () => {
	hooks = installHooksStub();
	rafQueue = [];
	vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) => {
		rafQueue.push( cb );
		return rafQueue.length;
	} );
	document.body.innerHTML =
		'<div id="desktop-mode-shell">' +
		'<div id="desktop-mode-area">' +
		'<aside id="desktop-mode-widgets"></aside>' +
		'</div></div>';
} );
afterEach( () => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	clearHooksStub();
	_resetAllSharedStoresForTests();
	vi.restoreAllMocks();
} );

const BOTH_LAYERS_PATH =
	'#desktop-mode-window-links .desktop-mode-window-link__path, ' +
	'#desktop-mode-window-links-elevated .desktop-mode-window-link__path';
const BOTH_LAYERS_SVG =
	'#desktop-mode-window-links svg, #desktop-mode-window-links-elevated svg';

describe( 'window-link render host — end-to-end (jsdom)', () => {
	test( 'post + comment identities produce a mounted layer with an arrowed spline', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 60, y: 60, width: 600, height: 400 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 800, y: 300, width: 500, height: 350 },
			true, // focused — the default 'focus' policy needs it
		);
		const manager = makeManager( [ postWin, commentWin ] );
		const osSettings = makeOsSettings();

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: osSettings as never,
		} );

		// Simulate the bridge announcing identities (what
		// `desktop-mode-content-identity` does in production).
		engine.setWindowContent(
			'post-win',
			{ type: 'post', id: 1 },
			{ source: 'bridge' },
		);
		engine.setWindowContent(
			'comment-win',
			{ type: 'comment', id: 9, root: { type: 'post', id: 1 } },
			{ source: 'bridge' },
		);
		flushRaf();

		const layer = document.getElementById( 'desktop-mode-window-links' );
		expect( layer ).not.toBeNull();
		// Behind the windows, inside the desktop area, after widgets.
		expect( layer!.parentElement!.id ).toBe( 'desktop-mode-area' );
		expect( layer!.previousElementSibling!.id ).toBe(
			'desktop-mode-widgets',
		);

		// The edge touches the FOCUSED comment window → it draws on the
		// elevated sibling layer.
		const path = document.querySelector( BOTH_LAYERS_PATH );
		expect( path ).not.toBeNull();
		expect( path!.closest( '#desktop-mode-window-links-elevated' ) ).not.toBeNull();
		expect( path!.getAttribute( 'd' ) ).toMatch( /^M .+ C .+/ );
		// The large endpoint dot sits on the post (edge target).
		expect( path!.getAttribute( 'marker-end' ) ).toMatch( /^url\(#/ );

		// Focused member → layer visible under the 'focus' policy.
		expect(
			layer!.classList.contains( 'desktop-mode-window-links--visible' ),
		).toBe( true );

		// Related-window chrome cue on the OTHER member.
		expect(
			postWin.element.classList.contains( 'desktop-mode-window--linked' ),
		).toBe( true );
		expect(
			commentWin.element.classList.contains(
				'desktop-mode-window--linked',
			),
		).toBe( false );
	} );

	test( 'live drag frames update the path geometry', async () => {
		const { engine, host } = await loadModules();
		const rect = { x: 60, y: 60, width: 600, height: 400 };
		const postWin = makeWin( 'post-win', rect );
		const commentWin = makeWin(
			'comment-win',
			{ x: 800, y: 300, width: 500, height: 350 },
			true,
		);
		const manager = makeManager( [ postWin, commentWin ] );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: makeOsSettings() as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();

		const path = document.querySelector(
			BOTH_LAYERS_PATH,
		)!;
		const dBefore = path.getAttribute( 'd' );

		// Simulate a drag tick: geometry changes + bounds-changed hook.
		rect.x = 200;
		rect.y = 220;
		hooks.doAction( HOOKS.WINDOW_BOUNDS_CHANGED, {
			windowId: 'post-win',
			x: 200,
			y: 220,
			width: 600,
			height: 400,
			state: 'normal',
			phase: 'drag',
		} );
		flushRaf();

		expect( path.getAttribute( 'd' ) ).not.toBe( dBefore );
	} );

	test( "the 'off' policy never mounts; 'always' shows without focus", async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 100, height: 100 } );
		const commentWin = makeWin( 'comment-win', {
			x: 300,
			y: 300,
			width: 100,
			height: 100,
		} );
		const manager = makeManager( [ postWin, commentWin ] );
		const osSettings = makeOsSettings( { windowLinkVisibility: 'off' } );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: osSettings as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();

		expect(
			document.querySelector( BOTH_LAYERS_SVG ),
		).toBeNull();

		// Flip to 'always' (nothing focused) — mounts and shows.
		osSettings._update( { windowLinkVisibility: 'always' } );
		flushRaf();

		const layer = document.getElementById( 'desktop-mode-window-links' )!;
		expect(
			layer.querySelector( '.desktop-mode-window-link__path' ),
		).not.toBeNull();
		expect(
			layer.classList.contains( 'desktop-mode-window-links--visible' ),
		).toBe( true );
	} );

	test( 'focusing the ROOT raises every child (not itself, not minimized ones)', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin(
			'post-win',
			{ x: 0, y: 0, width: 100, height: 100 },
			true,
		);
		const commentWin = makeWin( 'comment-win', {
			x: 300,
			y: 300,
			width: 100,
			height: 100,
		} );
		const minimizedWin = makeWin( 'media-win', {
			x: 500,
			y: 100,
			width: 100,
			height: 100,
		} );
		minimizedWin.state = 'minimized';
		const manager = makeManager( [ postWin, commentWin, minimizedWin ] );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: makeOsSettings() as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		engine.setWindowContent( 'media-win', {
			type: 'media',
			id: 3,
			root: { type: 'post', id: 1 },
		} );
		manager.raise.mockClear();

		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'post-win' } );

		const raised = manager.raise.mock.calls.map( ( c ) => c[ 0 ] );
		expect( raised ).toContain( 'comment-win' );
		expect( raised ).not.toContain( 'post-win' );
		// Minimized relatives stay minimized — never raised.
		expect( raised ).not.toContain( 'media-win' );
	} );

	test( 'focusing a CHILD raises its parent but not its siblings', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 100, height: 100 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 300, y: 300, width: 100, height: 100 },
			true,
		);
		const siblingWin = makeWin( 'sibling-win', {
			x: 500,
			y: 100,
			width: 100,
			height: 100,
		} );
		const manager = makeManager( [ postWin, commentWin, siblingWin ] );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: makeOsSettings() as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		engine.setWindowContent( 'sibling-win', {
			type: 'comment',
			id: 10,
			root: { type: 'post', id: 1 },
		} );
		manager.raise.mockClear();

		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'comment-win' } );

		const raised = manager.raise.mock.calls.map( ( c ) => c[ 0 ] );
		expect( raised ).toContain( 'post-win' );
		expect( raised ).not.toContain( 'comment-win' );
		// The sibling shares the group but carries no edge to the
		// focused child — it stays where it is.
		expect( raised ).not.toContain( 'sibling-win' );
		// …while the chrome highlight still marks the whole group.
		expect(
			siblingWin.element.classList.contains(
				'desktop-mode-window--linked',
			),
		).toBe( true );
	} );

	test( 'focusing a group member lifts the layer to the group; blur to outsider resets it', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 100, height: 100 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 300, y: 300, width: 100, height: 100 },
			true,
		);
		const strangerWin = makeWin( 'stranger', {
			x: 600,
			y: 0,
			width: 100,
			height: 100,
		} );
		// Simulate the manager's stack z-assignment: stranger sits
		// BETWEEN the two group members.
		postWin.element.style.zIndex = '100';
		strangerWin.element.style.zIndex = '101';
		commentWin.element.style.zIndex = '102';
		const manager = makeManager( [ postWin, strangerWin, commentWin ] );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: makeOsSettings() as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();

		const layer = document.getElementById(
			'desktop-mode-window-links-elevated',
		)!;
		// The ELEVATED layer rides at the group's CEILING (comment at
		// z 102) so the focused window's ties draw over the stranger at
		// z 101 AND over the group's own lower members. The base layer
		// never moves; the top window still paints above the elevated
		// layer (equal z, later in the DOM).
		expect( layer.style.zIndex ).toBe( '102' );
		expect(
			document.getElementById( 'desktop-mode-window-links' )!.style
				.zIndex,
		).toBe( '' );

		// Focus moves to the unrelated window — elevation resets to the
		// stylesheet default (inline style cleared).
		commentWin.isFocused = () => false;
		strangerWin.isFocused = () => true;
		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'stranger' } );

		expect( layer.style.zIndex ).toBe( '' );
	} );

	test( 'the Features master switch gates everything; re-enabling mounts live', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 100, height: 100 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 300, y: 300, width: 100, height: 100 },
			true,
		);
		const manager = makeManager( [ postWin, commentWin ] );
		const osSettings = makeOsSettings( { windowLinksEnabled: false } );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: osSettings as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();

		// Disabled: no renderer, no raise, no highlight.
		expect(
			document.querySelector( BOTH_LAYERS_SVG ),
		).toBeNull();
		expect( manager.raise ).not.toHaveBeenCalled();
		expect(
			postWin.element.classList.contains( 'desktop-mode-window--linked' ),
		).toBe( false );

		// Flip the master switch back on — mounts without a reload.
		osSettings._update( { windowLinksEnabled: true } );
		flushRaf();
		expect(
			document.querySelector(
				BOTH_LAYERS_PATH,
			),
		).not.toBeNull();
	} );

	test( 'the raise and highlight switches gate their behaviors independently', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 100, height: 100 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 300, y: 300, width: 100, height: 100 },
			true,
		);
		const manager = makeManager( [ postWin, commentWin ] );
		const osSettings = makeOsSettings( {
			windowLinkRaiseOnFocus: false,
			windowLinkHighlight: false,
		} );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: osSettings as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();

		// The splines still draw…
		expect(
			document.querySelector(
				BOTH_LAYERS_PATH,
			),
		).not.toBeNull();

		// …but neither group behavior fires.
		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'comment-win' } );
		expect( manager.raise ).not.toHaveBeenCalled();
		expect(
			postWin.element.classList.contains( 'desktop-mode-window--linked' ),
		).toBe( false );
	} );

	test( 'closing the child window clears its edge and unmounts the renderer', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 100, height: 100 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 300, y: 300, width: 100, height: 100 },
			true,
		);
		const wins = [ postWin, commentWin ];
		const manager = makeManager( wins );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: makeOsSettings() as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();
		expect(
			document.querySelector(
				BOTH_LAYERS_PATH,
			),
		).not.toBeNull();

		// Close the comment window — the engine's WINDOW_CLOSED handler
		// clears its identity, edges drop to zero, layer empties.
		wins.splice( wins.indexOf( commentWin ), 1 );
		hooks.doAction( HOOKS.WINDOW_CLOSED, { windowId: 'comment-win' } );
		flushRaf();

		expect(
			document.querySelector(
				BOTH_LAYERS_PATH,
			),
		).toBeNull();
	} );
} );
