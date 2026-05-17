/**
 * Tests for the unified tile renderer + drag-out helper.
 *
 * The renderer is now the `<wpd-tile>` web component (light-DOM,
 * single source of truth for every tile in the shell).
 * `buildTileFromSpec` is a thin shim that creates a `<wpd-tile>`
 * host with attributes from a `TileSpec`. `attachTileDragOut`
 * remains the imperative helper for callers who already have a
 * tile element.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from './helpers/hooks-stub';
import { DragManager } from '../../src/drag/manager';
import { __resetRecoveryForTests } from '../../src/drag/recovery';
import {
	attachTileDragOut,
	buildTileFromSpec,
	TILE_CLASS,
} from '../../src/desktop-files/tile-spec';
import type { ShortcutDragData } from '../../src/desktop-files/drag-payloads';

function pointerEvent(
	type: string,
	clientX: number,
	clientY: number,
	target: HTMLElement | Document = document,
): PointerEvent {
	const ev = new Event( type, { bubbles: true } );
	Object.defineProperty( ev, 'pointerId', { value: 1 } );
	Object.defineProperty( ev, 'button', { value: 0 } );
	Object.defineProperty( ev, 'clientX', { value: clientX } );
	Object.defineProperty( ev, 'clientY', { value: clientY } );
	if ( target instanceof HTMLElement ) {
		Object.defineProperty( ev, 'target', { value: target } );
	}
	return ev as unknown as PointerEvent;
}

function installElementFromPointStub(
	regions: Array< { el: Element; rect: { x: number; y: number; w: number; h: number } } >,
): void {
	const ordered = [ ...regions ];
	document.elementFromPoint = ( x: number, y: number ): Element | null => {
		for ( let i = ordered.length - 1; i >= 0; i -= 1 ) {
			const { el, rect } = ordered[ i ];
			if ( x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h ) {
				return el;
			}
		}
		return null;
	};
}

function mount( el: HTMLElement ): HTMLElement {
	document.body.appendChild( el );
	return el;
}

describe( 'buildTileFromSpec', () => {
	beforeEach( () => {
		installHooksStub();
		document.body.innerHTML = '';
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
	} );

	test( 'host is <wpd-tile> with canonical class + data-* contract', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '42',
			label: 'Hello world',
			icon: 'dashicons-admin-post',
		} ) );
		expect( tile.tagName ).toBe( 'WPD-TILE' );
		expect( tile.classList.contains( TILE_CLASS ) ).toBe( true );
		expect( tile.dataset.fileType ).toBe( 'post' );
		expect( tile.dataset.fileRef ).toBe( '42' );
		expect( tile.getAttribute( 'role' ) ).toBe( 'listitem' );
		expect( tile.getAttribute( 'aria-label' ) ).toBe( 'Hello world' );
		expect(
			tile.querySelector( '.desktop-mode-file-tile__label' )?.textContent,
		).toBe( 'Hello world' );
	} );

	test( 'extra dataset keys land on data-* attrs on the host', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '42',
			label: 'x',
			dataset: { postId: 42, folderId: 0 },
		} ) );
		expect( tile.dataset.postId ).toBe( '42' );
		expect( tile.dataset.folderId ).toBe( '0' );
	} );

	test( 'thumbnail wins over icon', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'attachment',
			ref: '7',
			label: 'pic',
			thumbnail: 'https://example.test/thumb.jpg',
			icon: 'dashicons-format-image',
		} ) );
		const img = tile.querySelector< HTMLImageElement >(
			'.desktop-mode-file-tile__preview',
		);
		expect( img ).not.toBeNull();
		expect( img!.src ).toBe( 'https://example.test/thumb.jpg' );
		expect( img!.draggable ).toBe( false );
		expect( tile.querySelector( '.desktop-mode-file-tile__icon' ) ).toBeNull();
	} );

	test( 'folder role applies the modifier class', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'folder',
			ref: '0',
			label: 'Posts',
			icon: 'dashicons-admin-post',
			role: 'folder',
		} ) );
		expect( tile.classList.contains( `${ TILE_CLASS }--folder` ) ).toBe(
			true,
		);
		expect( tile.dataset.role ).toBe( 'folder' );
	} );

	test( 'missing + access-gated modifiers + lock badge', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
			missing: true,
			accessGated: true,
		} ) );
		expect( tile.classList.contains( `${ TILE_CLASS }--missing` ) ).toBe(
			true,
		);
		expect(
			tile.classList.contains( `${ TILE_CLASS }--access-gated` ),
		).toBe( true );
		expect( tile.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
		expect( tile.querySelector( '.desktop-mode-file-tile__lock' ) ).not.toBeNull();
	} );

	test( 'extraClasses ride on the host', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
			extraClasses: [
				'desktop-mode-my-wordpress__tile',
				'desktop-mode-my-wordpress__tile--entry',
			],
		} ) );
		expect( tile.classList.contains( 'desktop-mode-my-wordpress__tile' ) ).toBe(
			true,
		);
		expect(
			tile.classList.contains( 'desktop-mode-my-wordpress__tile--entry' ),
		).toBe( true );
	} );

	test( 'status ribbon renders a <wpd-ribbon> for non-publish statuses', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
			status: 'draft',
		} ) );
		const ribbon = tile.querySelector( 'wpd-ribbon' );
		expect( ribbon ).not.toBeNull();
		expect( ribbon!.textContent ).toBe( 'Draft' );
	} );

	test( 'status ribbon is suppressed when OS setting is off', () => {
		const wp = ( window as unknown as { wp: { desktop?: Record< string, unknown > } } ).wp;
		wp.desktop = {
			...( wp.desktop ?? {} ),
			getOsSettings: () => ( { showPostStatusRibbons: false } ),
		};
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
			status: 'draft',
		} ) );
		expect( tile.querySelector( 'wpd-ribbon' ) ).toBeNull();
	} );

	test( 'publish status renders no ribbon', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
			status: 'publish',
		} ) );
		expect( tile.querySelector( 'wpd-ribbon' ) ).toBeNull();
	} );

	test( 'absolute positioning when x/y given', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
			x: 80,
			y: 120,
		} ) );
		expect( tile.style.position ).toBe( 'absolute' );
		expect( tile.style.left ).toBe( '80px' );
		expect( tile.style.top ).toBe( '120px' );
	} );

	test( 'no positioning when x/y omitted (flow layout)', () => {
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
		} ) );
		expect( tile.style.position ).toBe( '' );
	} );

	test( 'fires desktop-mode.tile.rendered action', () => {
		const calls: Array< { tile: HTMLElement } > = [];
		window.wp!.hooks!.addAction(
			'desktop-mode.tile.rendered',
			'test/observer',
			( payload: unknown ) => {
				calls.push( payload as { tile: HTMLElement } );
			},
		);
		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '1',
			label: 'x',
		} ) );
		expect( calls.length ).toBeGreaterThan( 0 );
		expect( calls[ 0 ].tile ).toBe( tile );
	} );
} );

describe( 'attachTileDragOut', () => {
	beforeEach( () => {
		installHooksStub();
		__resetRecoveryForTests();
		document.elementFromPoint = () => null;
		document.body.innerHTML = '';
	} );

	afterEach( () => {
		clearHooksStub();
		vi.unstubAllGlobals();
	} );

	test( 'super-threshold drag emits a shortcut payload to a drop target', () => {
		const manager = new DragManager();
		const wp = ( window as unknown as { wp: { desktop?: Record< string, unknown > } } ).wp;
		wp.desktop = { ...( wp.desktop ?? {} ), dragManager: manager };

		const tile = mount( buildTileFromSpec( {
			type: 'post',
			ref: '42',
			label: 'Hello',
			icon: 'dashicons-admin-post',
		} ) );

		const drop = document.createElement( 'div' );
		drop.id = 'drop';
		document.body.appendChild( drop );

		const onDrop = vi.fn();
		manager.registerDropTarget( {
			id: 'drop',
			element: drop,
			accept: ( payload ) => payload.type === 'shortcut',
			onDrop,
		} );

		attachTileDragOut( tile, {
			kind: 'post',
			ref: '42',
			title: 'Hello',
			icon: 'dashicons-admin-post',
		} );

		installElementFromPointStub( [
			{ el: tile, rect: { x: 0, y: 0, w: 100, h: 100 } },
			{ el: drop, rect: { x: 400, y: 400, w: 600, h: 600 } },
		] );

		tile.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 500, 500 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 500, 500 ) );

		expect( onDrop ).toHaveBeenCalledTimes( 1 );
		const [ session ] = onDrop.mock.calls[ 0 ];
		expect( session.payload.type ).toBe( 'shortcut' );
		const data = session.payload.data as ShortcutDragData;
		expect( data.kind ).toBe( 'post' );
		expect( data.ref ).toBe( '42' );
		expect( data.title ).toBe( 'Hello' );
	} );

	test( 'sub-threshold gesture fires onClick callback without dropping', () => {
		const manager = new DragManager();
		const wp = ( window as unknown as { wp: { desktop?: Record< string, unknown > } } ).wp;
		wp.desktop = { ...( wp.desktop ?? {} ), dragManager: manager };

		const tile = mount( buildTileFromSpec( {
			type: 'user',
			ref: '7',
			label: 'You',
		} ) );

		const drop = document.createElement( 'div' );
		document.body.appendChild( drop );
		const onDrop = vi.fn();
		manager.registerDropTarget( {
			id: 'drop',
			element: drop,
			accept: () => true,
			onDrop,
		} );

		const onClick = vi.fn();
		attachTileDragOut( tile, { kind: 'user', ref: '7' }, onClick );

		installElementFromPointStub( [
			{ el: drop, rect: { x: 0, y: 0, w: 1000, h: 1000 } },
		] );

		tile.dispatchEvent( pointerEvent( 'pointerdown', 50, 50, tile ) );
		document.dispatchEvent( pointerEvent( 'pointermove', 51, 50 ) );
		document.dispatchEvent( pointerEvent( 'pointerup', 51, 50 ) );

		expect( onDrop ).not.toHaveBeenCalled();
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'no-op when no drag manager is present', () => {
		const tile = mount( buildTileFromSpec( { type: 'post', ref: '1', label: 'x' } ) );
		attachTileDragOut( tile, { kind: 'post', ref: '1' } );
		expect( () => {
			tile.dispatchEvent( pointerEvent( 'pointerdown', 0, 0, tile ) );
		} ).not.toThrow();
	} );
} );
