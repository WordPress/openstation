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

		expect( win.iframe ).not.toBeNull();
		expect( win.element.isConnected ).toBe( true );
	} );
} );
