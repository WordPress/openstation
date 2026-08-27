/**
 * The in-place loading affordance for non-window lazy mount points.
 *
 * Three behaviours carry the weight and each has a way of quietly
 * regressing: the delay (a spinner that flashes reads as a glitch), the
 * failure state (the blank-forever box this exists to remove), and the
 * `<os-spinner>`-or-fallback choice (the component ships in a lazy
 * bundle, so a widget mounting during boot can beat it to the page).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHOW_DELAY_MS, showInlineLoader } from '../../src/ui/inline-loader';

let host: HTMLElement;

beforeEach( () => {
	vi.useFakeTimers();
	document.body.innerHTML = '';
	document.head.innerHTML = '';
	host = document.createElement( 'div' );
	document.body.appendChild( host );
} );

afterEach( () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
} );

const root = () => host.querySelector< HTMLElement >( '.os-inline-loader' );

describe( 'showInlineLoader — the show delay', () => {
	it( 'paints nothing before the delay elapses', () => {
		showInlineLoader( host );
		vi.advanceTimersByTime( SHOW_DELAY_MS - 1 );
		expect( root() ).toBeNull();
	} );

	it( 'paints once the delay elapses', () => {
		showInlineLoader( host, { label: 'Loading preferences…' } );
		vi.advanceTimersByTime( SHOW_DELAY_MS );
		expect( root()?.textContent ).toContain( 'Loading preferences…' );
	} );

	it( 'never paints for a load that beat the delay', () => {
		// The whole point of the delay: a fast load must leave no trace.
		const loader = showInlineLoader( host );
		loader.done();
		vi.advanceTimersByTime( SHOW_DELAY_MS * 10 );
		expect( root() ).toBeNull();
	} );

	it( 'paints synchronously when asked to', () => {
		showInlineLoader( host, { immediate: true } );
		expect( root() ).not.toBeNull();
	} );

	it( 'does not paint into a container that left the document', () => {
		showInlineLoader( host );
		host.remove();
		vi.advanceTimersByTime( SHOW_DELAY_MS );
		expect( root() ).toBeNull();
	} );
} );

describe( 'showInlineLoader — it appends, never replaces', () => {
	it( 'keeps markup the caller already painted', () => {
		// A widget's template and a panel's header are painted before
		// the bundle is awaited; assigning over innerHTML would wipe
		// them and the card would flicker back to empty.
		const existing = document.createElement( 'p' );
		existing.textContent = 'template';
		host.appendChild( existing );

		const loader = showInlineLoader( host, { immediate: true } );
		expect( host.contains( existing ) ).toBe( true );

		loader.done();
		expect( host.contains( existing ) ).toBe( true );
		expect( root() ).toBeNull();
	} );
} );

describe( 'showInlineLoader — failure', () => {
	it( 'paints the message even when the spinner never showed', () => {
		// A load that fails in under the delay still has to say so:
		// silence here is the blank box this module exists to remove.
		const loader = showInlineLoader( host );
		loader.fail( 'Preferences could not be loaded.' );
		expect( root()?.textContent ).toContain(
			'Preferences could not be loaded.',
		);
	} );

	it( 'replaces a painted spinner rather than stacking under it', () => {
		const loader = showInlineLoader( host, { immediate: true } );
		loader.fail( 'Nope.' );
		expect( host.querySelectorAll( '.os-inline-loader' ) ).toHaveLength( 1 );
		expect( root()?.textContent ).toBe( 'Nope.' );
	} );

	it( 'announces a failure assertively, unlike progress', () => {
		const loader = showInlineLoader( host, { immediate: true } );
		expect( root()?.getAttribute( 'aria-live' ) ).toBe( 'polite' );
		loader.fail( 'Nope.' );
		expect( root()?.getAttribute( 'aria-live' ) ).toBe( 'assertive' );
	} );

	it( 'offers a retry that clears the error and re-runs the caller', () => {
		const retry = vi.fn();
		const loader = showInlineLoader( host, { immediate: true } );
		loader.fail( 'Nope.', retry );

		host.querySelector< HTMLButtonElement >( 'button' )?.click();

		expect( retry ).toHaveBeenCalledTimes( 1 );
		expect( root() ).toBeNull();
	} );

	it( 'renders no retry control when none was offered', () => {
		const loader = showInlineLoader( host, { immediate: true } );
		loader.fail( 'Nope.' );
		expect( host.querySelector( 'button' ) ).toBeNull();
	} );

	it( 'is idempotent in both directions', () => {
		const loader = showInlineLoader( host, { immediate: true } );
		loader.done();
		loader.done();
		loader.fail( 'too late' );
		expect( root() ).toBeNull();

		const other = showInlineLoader( host, { immediate: true } );
		other.fail( 'first' );
		other.fail( 'second' );
		expect( root()?.textContent ).toBe( 'first' );
	} );
} );

describe( 'showInlineLoader — the spinner it picks', () => {
	it( 'falls back to inline markup when <os-spinner> would not upgrade', () => {
		// The component lives in the lazy `shell-overlays` bundle. A
		// widget can mount before that lands, and an <os-spinner> there
		// would be an inert unknown element for exactly the window this
		// module covers.
		vi.spyOn( customElements, 'get' ).mockReturnValue( undefined );

		showInlineLoader( host, { immediate: true } );

		expect( host.querySelector( 'os-spinner' ) ).toBeNull();
		const arc = root()?.firstElementChild as HTMLElement;
		expect( arc.tagName ).toBe( 'SPAN' );
		expect( arc.style.borderTopColor ).toBe( 'transparent' );
	} );

	it( 'uses <os-spinner> once the tag is registered', () => {
		vi.spyOn( customElements, 'get' ).mockReturnValue(
			class extends HTMLElement {},
		);

		showInlineLoader( host, { immediate: true } );

		const spinner = host.querySelector( 'os-spinner' );
		expect( spinner ).not.toBeNull();
		// The wrapper is the live region; a labelled spinner inside it
		// would have a screen reader read the status twice.
		expect( spinner?.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		expect( spinner?.getAttribute( 'preset' ) ).toBe( 'inline' );
	} );

	it( 'skips the spin keyframes under reduced motion', () => {
		vi.spyOn( customElements, 'get' ).mockReturnValue( undefined );
		vi.stubGlobal( 'matchMedia', () => ( { matches: true } ) );

		showInlineLoader( host, { immediate: true } );

		expect(
			document.getElementById( 'os-inline-loader-keyframes' ),
		).toBeNull();
		const arc = root()?.firstElementChild as HTMLElement;
		expect( arc.style.animation ).toBe( '' );
		vi.unstubAllGlobals();
	} );
} );
