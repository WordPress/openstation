import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { doAction, HOOKS } from '../../src/hooks';
import { listTitleBarButtons } from '../../src/title-bar-buttons/registry';
import { MioResidency } from '../../src/mio/residency';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import type { MioWindowContext } from '../../src/mio/assistant/types';

beforeEach( () => { installHooksStub(); vi.stubGlobal( 'ResizeObserver', class { observe() {} disconnect() {} } ); } );
afterEach( () => { document.body.innerHTML = ''; clearHooksStub(); vi.unstubAllGlobals(); } );
const flush = async () => { for ( let i = 0; i < 5; i++ ) { await Promise.resolve(); } };
function makeWindow( id: string ): MioWindowContext {
	const win = document.createElement( 'div' );
	win.id = `wp-window-${ id }`;
	win.className = 'os-window';
	const body = document.createElement( 'div' );
	body.className = 'os-window__body';
	win.appendChild( body );
	document.body.appendChild( win );
	return { host: body, title: id, documents: [], prompt: () => id, abilities: () => [] };
}

describe( 'MIO window ownership', () => {
	test( 'only explicit live registrations claim MIO; focus transfers and release restore the desk', async () => {
		const shell = document.createElement( 'div' );
		const layer = document.createElement( 'div' );
		shell.append( layer ); document.body.append( shell );
		let focused: string | null = 'a';
		const handle = { getPosition: () => ( { x: 240, y: 150 } ), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
		const residency = new MioResidency( { shell, layer: () => layer, focused: () => focused, handle: () => handle, enabled: () => true, ready: async () => undefined } );
		const a = residency.register( 'a', makeWindow( 'a' ) );
		const b = residency.register( 'b', makeWindow( 'b' ) );
		await flush();
		expect( residency.getWindowId() ).toBe( 'a' );
		expect( layer.dataset.mioWindow ).toBe( 'a' );
		expect( layer.dataset.mioVisible ).toBe( 'false' );
		focused = 'b'; residency.refresh(); await flush();
		expect( layer.dataset.mioWindow ).toBe( 'b' );
		expect( document.querySelectorAll( '.os-mio-residence:not([hidden])' ) ).toHaveLength( 1 );
		focused = 'unregistered'; doAction( HOOKS.WINDOW_MINIMIZED ); await flush();
		expect( residency.getWindowId() ).toBeNull();
		expect( layer.parentElement ).toBe( shell );
		expect( layer.dataset.mioWindow ).toBeUndefined();
		expect( layer.dataset.mioVisible ).toBe( 'true' );
		focused = 'b'; doAction( HOOKS.DESKTOP_SWITCHED ); await flush();
		b.dispose(); await flush();
		expect( layer.isConnected ).toBe( true );
		expect( layer.parentElement ).toBe( shell );
		a.dispose();
	} );
	test( 'wallpaper visibility updates in place and does not prevent window chat', async () => {
		const shell = document.createElement( 'div' ); const layer = document.createElement( 'div' );
		shell.append( layer ); document.body.append( shell );
		let shown = false; let focused: string | null = null;
		const handle = { getPosition: () => ( { x: 240, y: 150 } ), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
		const residency = new MioResidency( { shell, layer: () => layer, focused: () => focused, handle: () => handle, enabled: () => true, wallpaperVisible: () => shown, ready: async () => undefined } );
		const lease = residency.register( 'a', makeWindow( 'a' ) ); await flush();
		expect( layer.dataset.mioVisible ).toBe( 'false' );
		shown = true; residency.refresh(); await flush();
		expect( layer.dataset.mioVisible ).toBe( 'true' );
		expect( handle.setPosition ).not.toHaveBeenCalled();
		shown = false; focused = 'a'; residency.refresh(); await flush();
		window.openStationMountMioChat = vi.fn( () => ( { destroy: vi.fn() } ) );
		await lease.openChat();
		expect( layer.dataset.mioVisible ).toBe( 'true' );
		residency.closeChat(); focused = null; residency.refresh(); await flush();
		expect( layer.parentElement ).toBe( shell );
		expect( layer.dataset.mioVisible ).toBe( 'false' );
		lease.dispose(); delete window.openStationMountMioChat;
	} );
	test( 'waits for the first handoff, ignores repeated focus, and measures without shrink transforms', async () => {
		const shell = document.createElement( 'div' );
		const layer = document.createElement( 'div' );
		shell.append( layer ); document.body.append( shell );
		let transformed = false;
		const finish: Array<() => void> = [];
		const animate = vi.fn( () => {
			transformed = true;
			return { finished: new Promise<void>( resolve => finish.push( resolve ) ), cancel: () => { transformed = false; } } as Animation;
		} );
		layer.animate = animate;
		layer.getBoundingClientRect = () => ( { left: 100, top: 80, right: transformed ? 100 : 700, bottom: transformed ? 80 : 580 } as DOMRect );
		const handle = { getPosition: () => ( { x: 240, y: 150 } ), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
		window.openStationMountMioChat = vi.fn( () => ( { destroy: vi.fn() } ) );
		const residency = new MioResidency( { shell, layer: () => layer, focused: () => 'a', handle: () => handle, enabled: () => true, ready: async () => undefined } );
		const lease = residency.register( 'a', makeWindow( 'a' ) );
		const opening = lease.openChat();
		residency.refresh(); await flush();
		expect( animate ).toHaveBeenCalledTimes( 1 );
		expect( window.openStationMountMioChat ).not.toHaveBeenCalled();
		finish[ 0 ](); await flush();
		expect( handle.setPosition ).toHaveBeenLastCalledWith( 618, 485 );
		expect( animate ).toHaveBeenCalledTimes( 2 );
		expect( handle.setAnimating ).toHaveBeenLastCalledWith( true );
		finish[ 1 ](); await opening;
		expect( window.openStationMountMioChat ).toHaveBeenCalledTimes( 1 );
		expect( layer.style.opacity ).toBe( '' );
		expect( layer.dataset.mioVisible ).toBe( 'true' );
		residency.closeChat();
		expect( layer.dataset.mioVisible ).toBe( 'false' );
		delete window.openStationMountMioChat;
		layer.animate = undefined as unknown as typeof layer.animate;
		lease.dispose(); await flush();
	} );
	test( 'chat temporarily replaces a callout and idle windows stay invisible', async () => {
		vi.stubGlobal( 'requestAnimationFrame', vi.fn( () => 1 ) );
		vi.stubGlobal( 'cancelAnimationFrame', vi.fn() );
		const shell = document.createElement( 'div' ); const layer = document.createElement( 'div' );
		shell.append( layer ); document.body.append( shell );
		const context = makeWindow( 'tip' );
		const target = document.createElement( 'h2' ); context.host.append( target );
		target.getBoundingClientRect = () => ( { left: 10, right: 200, top: 10, bottom: 50, width: 190, height: 40 } as DOMRect );
		const handle = { getPosition: () => ( { x: 100, y: 150 } ), setAnchor: vi.fn(), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
		const residency = new MioResidency( { shell, layer: () => layer, focused: () => 'tip', handle: () => handle, enabled: () => true, ready: async () => undefined } );
		const lease = residency.register( 'tip', context ); await flush();
		const frame = document.querySelector<HTMLElement>( '.os-mio-residence' )!;
		frame.getBoundingClientRect = () => ( { left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 } as DOMRect );
		expect( layer.dataset.mioVisible ).toBe( 'false' );
		lease.showCallout( { id: 'tip', target: () => target, message: 'Hello' } );
		expect( layer.dataset.mioVisible ).toBe( 'true' );
		window.openStationMountMioChat = vi.fn( () => ( { destroy: vi.fn() } ) );
		await lease.openChat();
		expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( true );
		expect( layer.dataset.mioVisible ).toBe( 'true' );
		residency.closeChat();
		expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( false );
		lease.clearCallout();
		expect( layer.dataset.mioVisible ).toBe( 'false' );
		lease.dispose(); await flush();
		delete window.openStationMountMioChat;
	} );
	test( 'AI availability gates chat live while offline callouts keep their residence', async () => {
		vi.stubGlobal( 'requestAnimationFrame', vi.fn( () => 1 ) );
		vi.stubGlobal( 'cancelAnimationFrame', vi.fn() );
		const shell = document.createElement( 'div' ); const layer = document.createElement( 'div' );
		shell.append( layer ); document.body.append( shell );
		const context = makeWindow( 'offline' );
		const target = document.createElement( 'h2' ); context.host.append( target );
		target.getBoundingClientRect = () => ( { left: 10, right: 200, top: 10, bottom: 50, width: 190, height: 40 } as DOMRect );
		const handle = { getPosition: () => ( { x: 100, y: 150 } ), setAnchor: vi.fn(), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
		let aiEnabled = false; let connector = false;
		const ready = vi.fn( async () => undefined );
		const residency = new MioResidency( { shell, layer: () => layer, focused: () => 'offline', handle: () => handle, enabled: () => true, chatAvailable: () => aiEnabled && connector, ready } );
		const lease = residency.register( 'offline', context ); await flush();
		const frame = document.querySelector<HTMLElement>( '.os-mio-residence' )!;
		frame.getBoundingClientRect = () => ( { left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 } as DOMRect );
		lease.showCallout( { id: 'tip', target: () => target, message: 'Offline tip' } );
		const button = frame.querySelector<HTMLElement>( '.os-mio-chat-launcher' )!;
		for ( const [ enabled, configured ] of [ [ false, false ], [ true, false ], [ false, true ] ] ) {
			aiEnabled = enabled; connector = configured; residency.refresh(); await lease.openChat();
			expect( button.hidden ).toBe( true );
			expect( layer.dataset.mioVisible ).toBe( 'true' );
			expect( residency.getWindowId() ).toBe( 'offline' );
		}
		expect( ready ).not.toHaveBeenCalled();
		const destroy = vi.fn();
		window.openStationMountMioChat = vi.fn( () => ( { destroy } ) );
		aiEnabled = true; connector = true; residency.refresh();
		expect( button.hidden ).toBe( false );
		await lease.openChat();
		connector = false; residency.refresh();
		expect( destroy ).toHaveBeenCalledOnce();
		expect( button.hidden ).toBe( true );
		expect( frame.querySelector<HTMLElement>( '.os-mio-callout' )!.hidden ).toBe( false );
		lease.dispose(); await flush(); delete window.openStationMountMioChat;
	} );
	test( 'registers a per-window toggle, preserves local consent across the master switch, and cleans up', async () => {
		let enabled = true;
		const residency = new MioResidency( { shell: document.body, layer: () => null, handle: () => null, focused: () => 'a', enabled: () => enabled, ready: async () => undefined } );
		const lease = residency.register( 'a', makeWindow( 'a' ) );
		const def = listTitleBarButtons().find( button => button.id.startsWith( 'openstation/mio-window-' ) )!;
		const host = document.createElement( 'os-window-button' );
		host.innerHTML = def.icon; document.body.append( host );
		def.render!( host, { id: 'a' } as never );
		expect( host.querySelector( '.os-mio-window-toggle__slash' ) ).not.toBeNull();
		expect( host.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		host.dispatchEvent( new CustomEvent( 'os-button-activate' ) ); await flush();
		expect( lease.isEnabled() ).toBe( false );
		expect( residency.getWindowId() ).toBeNull();
		expect( host.dataset.mioDisabled ).toBe( 'true' );
		enabled = false; residency.refresh();
		expect( host.hasAttribute( 'disabled' ) ).toBe( true );
		expect( host.inert ).toBe( true );
		expect( host.dataset.mioAvailable ).toBe( 'false' );
		host.dispatchEvent( new CustomEvent( 'os-button-activate' ) );
		expect( lease.isEnabled() ).toBe( false );
		enabled = true; residency.refresh();
		expect( host.inert ).toBe( false );
		expect( host.dataset.mioAvailable ).toBe( 'true' );
		expect( lease.isEnabled() ).toBe( false );
		lease.setEnabled( true ); await flush();
		expect( residency.getWindowId() ).toBe( 'a' );
		lease.dispose();
		expect( listTitleBarButtons().some( button => button.id === def.id ) ).toBe( false );
	} );
	test( 'refuses another window’s host and duplicate leases', () => {
		const residency = new MioResidency( { shell: document.body, layer: () => null, handle: () => null, focused: () => null, enabled: () => true, ready: async () => undefined } );
		const a = makeWindow( 'a' ); const b = makeWindow( 'b' );
		expect( () => residency.register( 'a', b ) ).toThrow( 'explicit context' );
		const lease = residency.register( 'a', a );
		expect( () => residency.register( 'a', a ) ).toThrow( 'already registered' );
		lease.dispose();
	} );
} );

test( 'closing chat restores focus to the actual launcher button in shadow DOM', async () => {
	await import( '../../src/ui/components/os-button/os-button' );
	const shell = document.createElement( 'div' ); const layer = document.createElement( 'div' );
	shell.append( layer ); document.body.append( shell );
	const residency = new MioResidency( { shell, layer: () => layer, focused: () => 'focus-return', handle: () => null, enabled: () => true, ready: async () => {} } );
	const lease = residency.register( 'focus-return', makeWindow( 'focus-return' ) ); await flush();
	const launcher = document.querySelector<HTMLElement>( '#wp-window-focus-return .os-mio-chat-launcher' )!;
	const panel = document.createElement( 'section' );
	const input = document.createElement( 'input' ); panel.append( input );
	window.openStationMountMioChat = vi.fn( host => { host.append( panel ); input.focus(); return { destroy: () => panel.remove() }; } );
	await lease.openChat(); expect( document.activeElement ).toBe( input );
	residency.closeChat( true );
	expect( document.activeElement ).toBe( launcher );
	expect( launcher.shadowRoot!.activeElement ).toBe( launcher.shadowRoot!.querySelector( 'button' ) );
	lease.dispose(); delete window.openStationMountMioChat; await flush();
} );

test.each( [ 'host', 'window' ] )( 'a detached %s releases current ownership without a focus event', async target => {
	const shell = document.createElement( 'div' ); const layer = document.createElement( 'div' ); shell.append( layer ); document.body.append( shell );
	const residency = new MioResidency( { shell, layer: () => layer, focused: () => 'detached', handle: () => null, enabled: () => true, ready: async () => {} } );
	const context = makeWindow( 'detached' );
	const lease = residency.register( 'detached', context ); await flush();
	const destroy = vi.fn(); window.openStationMountMioChat = vi.fn( () => ( { destroy } ) ); await lease.openChat();
	const originalWindow = document.getElementById( 'wp-window-detached' )!;
	( target === 'host' ? context.host : originalWindow ).remove();
	await flush(); await flush();
	expect( destroy ).toHaveBeenCalledOnce(); expect( residency.getWindowId() ).toBeNull();
	expect( layer.parentElement ).toBe( shell ); expect( layer.isConnected ).toBe( true );
	expect( layer.dataset.mioWindow ).toBeUndefined();
	expect( originalWindow.querySelector( '.os-mio-residence' ) ).toBeNull();
	await lease.openChat(); expect( window.openStationMountMioChat ).toHaveBeenCalledOnce();
	// A stale lease cannot interfere with a replacement registration.
	if ( target === 'window' ) { document.body.append( originalWindow ); } else { originalWindow.append( context.host ); }
	const replacement = residency.register( 'detached', context ); await flush();
	lease.dispose(); expect( residency.getWindowId() ).toBe( 'detached' ); replacement.dispose();
	delete window.openStationMountMioChat; await flush();
} );

test( 'synchronous host reconnection preserves its live lease', async () => {
	const shell = document.createElement( 'div' ); const layer = document.createElement( 'div' ); shell.append( layer ); document.body.append( shell );
	const context = makeWindow( 'reconnect' ); const parent = context.host.parentElement!;
	const residency = new MioResidency( { shell, layer: () => layer, focused: () => 'reconnect', handle: () => null, enabled: () => true, ready: async () => {} } );
	const lease = residency.register( 'reconnect', context ); await flush();
	context.host.remove(); parent.append( context.host ); await flush();
	expect( residency.getWindowId() ).toBe( 'reconnect' );
	expect( parent.querySelector( '.os-mio-residence' ) ).not.toBeNull();
	lease.dispose(); await flush();
} );

test.each( [ 'shrink', 'grow' ] )( 'disposing the current owner during %s cancels stale transitions and restores the shell', async phase => {
	const shell = document.createElement( 'div' ); const layer = document.createElement( 'div' ); shell.append( layer ); document.body.append( shell );
	const animations: Array<{ resolve: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
	layer.animate = vi.fn( () => {
		let resolve!: () => void; let reject!: ( reason: Error ) => void;
		const finished = new Promise<void>( ( done, fail ) => { resolve = done; reject = fail; } );
		const cancel = vi.fn( () => reject( new DOMException( 'Canceled', 'AbortError' ) ) );
		animations.push( { resolve, cancel } ); return { finished, cancel } as unknown as Animation;
	} );
	const handle = { getPosition: () => ( { x: 240, y: 150 } ), setPosition: vi.fn(), setAnimating: vi.fn(), applyConfig: vi.fn(), destroy: vi.fn() };
	const residency = new MioResidency( { shell, layer: () => layer, focused: () => 'moving', handle: () => handle, enabled: () => true, ready: async () => {} } );
	const lease = residency.register( 'moving', makeWindow( 'moving' ) ); await flush();
	if ( phase === 'grow' ) { animations[ 0 ].resolve(); await flush(); expect( layer.dataset.mioWindow ).toBe( 'moving' ); }
	const stale = animations.at( -1 )!;
	expect( residency.getWindowId() ).toBe( 'moving' ); lease.dispose();
	expect( stale.cancel ).toHaveBeenCalled();
	expect( layer.isConnected ).toBe( true ); expect( layer.parentElement ).toBe( shell );
	expect( document.querySelector( '.os-mio-residence' ) ).toBeNull();
	stale.resolve(); await flush(); // A late completion must not reclaim the removed frame.
	animations.at( -1 )!.resolve(); await flush(); animations.at( -1 )!.resolve(); await flush();
	expect( residency.getWindowId() ).toBeNull(); expect( layer.dataset.mioWindow ).toBeUndefined();
	expect( layer.parentElement ).toBe( shell ); expect( layer.style.opacity ).toBe( '' );
	expect( handle.setPosition ).toHaveBeenLastCalledWith( 240, 150 );
} );
