/**
 * `<wpd-tile>` component tests. The high-level behavior is also
 * covered through `buildTileFromSpec` in
 * `tests/vitest/tile-spec.test.ts`; this file pins the component-
 * specific contract: reactive attributes, keyboard activation,
 * idempotent paint.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installHooksStub, clearHooksStub } from '../../../../tests/vitest/helpers/hooks-stub';
import './wpd-tile';
import { TILE_CLASS } from './wpd-tile';

// Two microtasks: one for `requestUpdate()` to schedule, another
// for the render callback to flush.
const tick = async (): Promise< void > => {
	await Promise.resolve();
	await Promise.resolve();
};

describe( '<wpd-tile>', () => {
	let host: HTMLElement;
	beforeEach( () => {
		installHooksStub();
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );
	afterEach( () => {
		clearHooksStub();
		host.remove();
		vi.unstubAllGlobals();
	} );

	test( 'paints synchronously on first connect', () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="42" label="Hello" icon="dashicons-admin-post"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		expect( tile.classList.contains( TILE_CLASS ) ).toBe( true );
		expect( tile.querySelector( '.desktop-mode-file-tile__label' )?.textContent ).toBe(
			'Hello',
		);
		expect( tile.querySelector( '.desktop-mode-file-tile__icon' ) ).not.toBeNull();
	} );

	test( 'updating the `label` attribute re-paints the label', async () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="First"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		expect(
			tile.querySelector( '.desktop-mode-file-tile__label' )?.textContent,
		).toBe( 'First' );

		tile.setAttribute( 'label', 'Second' );
		await tick();
		expect(
			tile.querySelector( '.desktop-mode-file-tile__label' )?.textContent,
		).toBe( 'Second' );
	} );

	test( 'flipping `selected` adds/removes the modifier class', async () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="x"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		expect( tile.classList.contains( `${ TILE_CLASS }--selected` ) ).toBe( false );

		tile.setAttribute( 'selected', '' );
		await tick();
		expect( tile.classList.contains( `${ TILE_CLASS }--selected` ) ).toBe( true );

		tile.removeAttribute( 'selected' );
		await tick();
		expect( tile.classList.contains( `${ TILE_CLASS }--selected` ) ).toBe( false );
	} );

	test( 'Enter key fires a click event', () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="x"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		const onClick = vi.fn();
		tile.addEventListener( 'click', onClick );
		tile.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter' } ) );
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'Space key fires a click event', () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="x"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		const onClick = vi.fn();
		tile.addEventListener( 'click', onClick );
		tile.dispatchEvent( new KeyboardEvent( 'keydown', { key: ' ' } ) );
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'tabindex defaults to 0 (focusable)', () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="x"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		expect( tile.getAttribute( 'tabindex' ) ).toBe( '0' );
	} );

	test( 'tabindex override is preserved', () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="x" tabindex="-1"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		expect( tile.getAttribute( 'tabindex' ) ).toBe( '-1' );
	} );

	test( 'access-gated adds the lock badge + aria-disabled', () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="x" access-gated></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		expect( tile.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
		expect( tile.querySelector( '.desktop-mode-file-tile__lock' ) ).not.toBeNull();
	} );

	test( 'status attribute slots a <wpd-ribbon>', () => {
		host.innerHTML =
			'<wpd-tile type="post" ref="1" label="x" status="draft"></wpd-tile>';
		const tile = host.querySelector( 'wpd-tile' )!;
		const ribbon = tile.querySelector( 'wpd-ribbon' );
		expect( ribbon ).not.toBeNull();
		expect( ribbon!.textContent ).toBe( 'Draft' );
	} );
} );
