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
	document.getElementById( 'os-area' )!.appendChild( element );
	Object.defineProperty( element, 'offsetParent', {
		get: () => document.getElementById( 'os-area' ),
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
		'<div id="os-shell">' +
		'<div id="os-area">' +
		'<aside id="os-widgets"></aside>' +
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
	'#os-window-links .os-window-link__path, ' +
	'#os-window-links-elevated .os-window-link__path';
const BOTH_LAYERS_SVG =
	'#os-window-links svg, #os-window-links-elevated svg';

describe( 'window-link render host — end-to-end (jsdom)', () => {
	test( 'post + comment identities produce a mounted layer with an arrowed spline', async () => {
		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 60, y: 60, width: 600, height: 400 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 800, y: 300, width: 500, height: 350 },
			true,
		);
		const manager = makeManager( [ postWin, commentWin ] );
		const osSettings = makeOsSettings();

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: osSettings as never,
		} );

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

		const layer = document.getElementById( 'os-window-links' );
		expect( layer ).not.toBeNull();

		expect( layer!.parentElement!.id ).toBe( 'os-area' );
		expect( layer!.previousElementSibling!.id ).toBe( 'os-widgets' );

		const path = document.querySelector( BOTH_LAYERS_PATH );
		expect( path ).not.toBeNull();
		expect( path!.closest( '#os-window-links-elevated' ) ).not.toBeNull();
		expect( path!.getAttribute( 'd' ) ).toMatch( /^M .+ C .+/ );

		expect( path!.getAttribute( 'marker-end' ) ).toMatch( /^url\(#/ );

		expect(
			layer!.classList.contains( 'os-window-links--visible' ),
		).toBe( true );

		expect(
			postWin.element.classList.contains( 'os-window--linked' ),
		).toBe( true );
		expect(
			commentWin.element.classList.contains(
				'os-window--linked',
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

		osSettings._update( { windowLinkVisibility: 'always' } );
		flushRaf();

		const layer = document.getElementById( 'os-window-links' )!;
		expect(
			layer.querySelector( '.os-window-link__path' ),
		).not.toBeNull();
		expect(
			layer.classList.contains( 'os-window-links--visible' ),
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

		expect( raised ).not.toContain( 'sibling-win' );

		expect(
			siblingWin.element.classList.contains(
				'os-window--linked',
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
			'os-window-links-elevated',
		)!;

		expect( layer.style.zIndex ).toBe( '102' );
		expect(
			document.getElementById( 'os-window-links' )!.style
				.zIndex,
		).toBe( '' );

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

		expect(
			document.querySelector( BOTH_LAYERS_SVG ),
		).toBeNull();
		expect( manager.raise ).not.toHaveBeenCalled();
		expect(
			postWin.element.classList.contains( 'os-window--linked' ),
		).toBe( false );

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

		expect(
			document.querySelector(
				BOTH_LAYERS_PATH,
			),
		).not.toBeNull();

		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'comment-win' } );
		expect( manager.raise ).not.toHaveBeenCalled();
		expect(
			postWin.element.classList.contains( 'os-window--linked' ),
		).toBe( false );
	} );

	test( 'split view hides the ties: snapped windows draw no edges until dragged back out', async () => {

		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 700, height: 900 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 700, y: 0, width: 700, height: 900 },
			true,
		);
		const manager = makeManager( [ postWin, commentWin ] );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: makeOsSettings( {
				windowLinkVisibility: 'always',
			} ) as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();
		expect( document.querySelector( BOTH_LAYERS_PATH ) ).not.toBeNull();

		postWin.state = 'snapped-left';
		hooks.doAction( HOOKS.SNAP_ZONE_COMMITTED, {
			windowId: 'post-win',
			zone: 'left',
		} );
		commentWin.state = 'snapped-right';
		hooks.doAction( HOOKS.SNAP_SPLIT_FILLED, {
			windowId: 'comment-win',
			zone: 'right',
		} );
		flushRaf();
		expect( document.querySelector( BOTH_LAYERS_PATH ) ).toBeNull();

		postWin.state = 'normal';
		hooks.doAction( HOOKS.WINDOW_MOVED, { windowId: 'post-win', x: 100, y: 100 } );
		flushRaf();
		expect( document.querySelector( BOTH_LAYERS_PATH ) ).toBeNull();

		commentWin.state = 'normal';
		hooks.doAction( HOOKS.WINDOW_MOVED, { windowId: 'comment-win', x: 400, y: 200 } );
		flushRaf();
		expect( document.querySelector( BOTH_LAYERS_PATH ) ).not.toBeNull();
	} );

	test( 'overview hides the layers while it runs; exit re-shows them', async () => {

		const { engine, host } = await loadModules();
		const postWin = makeWin( 'post-win', { x: 0, y: 0, width: 100, height: 100 } );
		const commentWin = makeWin(
			'comment-win',
			{ x: 300, y: 300, width: 100, height: 100 },
			true,
		);
		const manager = makeManager( [ postWin, commentWin ] );

		engine.startWindowLinksEngine( { manager } );
		host.startWindowLinkRenderHost( {
			manager: manager as never,
			osSettings: makeOsSettings( {
				windowLinkVisibility: 'always',
			} ) as never,
		} );
		engine.setWindowContent( 'post-win', { type: 'post', id: 1 } );
		engine.setWindowContent( 'comment-win', {
			type: 'comment',
			id: 9,
			root: { type: 'post', id: 1 },
		} );
		flushRaf();

		const layer = document.getElementById( 'os-window-links' )!;
		const elevated = document.getElementById(
			'os-window-links-elevated',
		)!;
		const VISIBLE = 'os-window-links--visible';
		expect( layer.classList.contains( VISIBLE ) ).toBe( true );
		expect( elevated.classList.contains( VISIBLE ) ).toBe( true );

		hooks.doAction( HOOKS.OVERVIEW_ENTERING, {} );
		expect( layer.classList.contains( VISIBLE ) ).toBe( false );
		expect( elevated.classList.contains( VISIBLE ) ).toBe( false );

		hooks.doAction( HOOKS.WINDOW_FOCUSED, { windowId: 'comment-win' } );
		expect( layer.classList.contains( VISIBLE ) ).toBe( false );

		hooks.doAction( HOOKS.OVERVIEW_EXITED, {} );
		flushRaf();
		expect( layer.classList.contains( VISIBLE ) ).toBe( true );
		expect( elevated.classList.contains( VISIBLE ) ).toBe( true );
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
