/**
 * Integration guard for the "native render runs AFTER mount" contract.
 * Before the fix, `config.render( body )` was
 * called from inside the `Window` constructor — at which point the
 * window element was still a detached subtree. Custom elements in
 * that subtree hadn't been upgraded, so declarative setter writes
 * (`element.items = [...]`, `.value = ...`) stashed own data
 * properties on the pre-upgrade instances and those shadowed the
 * class setters after upgrade. Empty selects in practice.
 *
 * The fix moved the render call out of the constructor into
 * `Window.hydrateNative()`, and the window manager now invokes it
 * AFTER `desktop.appendChild( win.element )`. These tests pin that
 * contract: custom elements inside the render body must be real
 * class instances (upgraded), and declarative setters must reach
 * the class implementation.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WindowManager } from '../../src/window-manager';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import '../../src/ui/components/os-select/os-select';

const tick = (): Promise<void> => Promise.resolve();

describe( 'WindowManager — native-window hydration order', async () => {
	let desktop: HTMLElement;
	let manager: WindowManager;

	beforeEach( async () => {
		installHooksStub();
		desktop = document.createElement( 'div' );
		Object.defineProperty( desktop, 'getBoundingClientRect', {
			value: () =>
				( {
					left: 0,
					top: 0,
					right: 1600,
					bottom: 900,
					width: 1600,
					height: 900,
					x: 0,
					y: 0,
					toJSON: () => ( {} ),
				} ) as DOMRect,
		} );
		Object.defineProperty( desktop, 'clientWidth', { value: 1600, configurable: true } );
		Object.defineProperty( desktop, 'clientHeight', { value: 900, configurable: true } );
		document.body.appendChild( desktop );
		manager = new WindowManager( desktop );
	} );

	afterEach( async () => {
		for ( const win of manager.getAll() ) {
			win.destroy();
		}
		desktop.remove();
		clearHooksStub();
	} );

	test( 'render body is already connected to the document when the callback fires', async () => {
		let isConnectedAtRenderTime = false;
		let isDesktopAncestorAtRenderTime = false;

		await manager.open( {
			id: 'probe',
			url: '#probe',
			title: 'Probe',
			native: true,
			render: ( body ) => {
				isConnectedAtRenderTime = body.isConnected;
				// Walk up to confirm the render body lives inside the
				// manager's desktop, not a detached container.
				isDesktopAncestorAtRenderTime = desktop.contains( body );
			},
		} );

		expect( isConnectedAtRenderTime ).toBe( true );
		expect( isDesktopAncestorAtRenderTime ).toBe( true );
	} );

	test( 'declarative .items on a os-select inside render populates the listbox', async () => {
		let selInsideBody: ( HTMLElement & {
			items: ReadonlyArray<{ value: string; label: string }>;
		} ) | null = null;

		await manager.open( {
			id: 'picker',
			url: '#picker',
			title: 'Picker',
			native: true,
			render: ( body ) => {
				body.innerHTML = `<os-select></os-select>`;
				// Same-tick write of a declarative setter — pre-0.12
				// this would silently create an own data property on
				// a pre-upgrade element. Post-0.12 it hits the real
				// OsSelect setter because the body is connected and
				// the element has already upgraded.
				const sel = body.querySelector( 'os-select' ) as HTMLElement & {
					items: ReadonlyArray<{ value: string; label: string }>;
				};
				sel.items = [
					{ value: 'x', label: 'X' },
					{ value: 'y', label: 'Y' },
				];
				selInsideBody = sel;
			},
		} );

		// Wait for the Component's render microtask to drain so the
		// shadow listbox has picked up the options the setter
		// queued.
		await tick();
		await tick();

		expect( selInsideBody ).not.toBeNull();
		expect(
			selInsideBody!.shadowRoot!.querySelectorAll( '[role="option"]' )
				.length,
		).toBe( 2 );
	} );

	test( 'iframe windows still open normally (hydrateNative is a no-op for them)', async () => {
		const win = await manager.open( {
			id: 'iframe-window',
			url: 'http://example.test/wp-admin/edit.php',
			title: 'Posts',
		} );

		// No render callback passed; window is iframe-backed.
		expect( win.iframe ).not.toBeNull();
		expect( win.element.isConnected ).toBe( true );
	} );
} );
