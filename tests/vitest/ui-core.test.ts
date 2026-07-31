/**
 * wpd-ui core — tests for the templater + base component.
 *
 * Covers:
 *   - text, attribute, event, property, boolean-attribute bindings
 *   - diffing on re-render (no-op updates don't touch the DOM)
 *   - prop ↔ attribute sync on Component subclasses
 *   - static styles applied to shadow and light DOM
 *   - microtask-batched re-render
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Component, css, defineComponent, html, render } from '../../src/ui/core';

describe( 'wpd-ui html renderer', () => {
	let host: HTMLDivElement;

	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
	} );

	afterEach( () => {
		host.remove();
	} );

	test( 'renders text interpolation', () => {
		render( html`<p>Hello ${ 'world' }!</p>`, host );
		expect( host.innerHTML ).toBe( '<p>Hello world!</p>' );
	} );

	test( 'attribute interpolation composes around static fragments', () => {
		render( html`<div class="a ${ 'b' } c">X</div>`, host );
		expect( host.querySelector( 'div' )?.getAttribute( 'class' ) ).toBe(
			'a b c',
		);
	} );

	test( 'empty attribute interpolation removes the attribute', () => {
		render( html`<div class=${ '' }>X</div>`, host );
		expect( host.querySelector( 'div' )?.hasAttribute( 'class' ) ).toBe(
			false,
		);
	} );

	test( '@event binding fires handler on dispatch', () => {
		const spy = vi.fn();
		render( html`<button @click=${ spy }>Go</button>`, host );
		host.querySelector( 'button' )!.click();
		expect( spy ).toHaveBeenCalledTimes( 1 );
	} );

	test( '@event binding swaps listeners on re-render', () => {
		const first = vi.fn();
		const second = vi.fn();
		const go = ( handler: typeof first ) =>
			render( html`<button @click=${ handler }>Go</button>`, host );
		go( first );
		go( second );
		host.querySelector( 'button' )!.click();
		expect( first ).not.toHaveBeenCalled();
		expect( second ).toHaveBeenCalledTimes( 1 );
	} );

	test( '.property binding sets a JS property, not an attribute', () => {
		render( html`<input .value=${ 'hello' } />`, host );
		const input = host.querySelector( 'input' )!;
		expect( input.value ).toBe( 'hello' );
		// Verified NOT as attribute — reading via property is the
		// whole point of this binding.
		expect( input.hasAttribute( 'value' ) ).toBe( false );
	} );

	test( '?attribute binding toggles presence', () => {
		const go = ( disabled: boolean ) =>
			render( html`<button ?disabled=${ disabled }>X</button>`, host );
		go( true );
		expect( host.querySelector( 'button' )!.hasAttribute( 'disabled' ) ).toBe(
			true,
		);
		go( false );
		expect( host.querySelector( 'button' )!.hasAttribute( 'disabled' ) ).toBe(
			false,
		);
	} );

	test( 'second render with same template updates text without re-parsing', () => {
		// Call-site identity matters — TemplateStringsArray is
		// cached per tagged-template call site, so wrapping in a
		// helper keeps the identity stable across calls.
		const update = ( value: string ) =>
			render( html`<p>${ value }</p>`, host );
		update( 'one' );
		const first = host.querySelector( 'p' )!;
		update( 'two' );
		const second = host.querySelector( 'p' )!;
		expect( first ).toBe( second );
		expect( first.textContent ).toBe( 'two' );
	} );

	test( 'remounts when the container was cleared behind the renderer\'s back', () => {
		// Hosts that mix imperative DOM management with the templater
		// (the OS Settings editor slot did) can wipe the container
		// between renders. The cached mount must not take the
		// update-in-place fast path against those detached nodes —
		// that renders nothing, silently.
		const update = ( value: string ) =>
			render( html`<p>${ value }</p>`, host );
		update( 'one' );
		host.innerHTML = '';
		update( 'two' );
		expect( host.querySelector( 'p' )?.textContent ).toBe( 'two' );
	} );

	test( 'no-op re-render doesn\'t touch the text-node slot', () => {
		const update = ( value: string ) =>
			render( html`<p>${ value }</p>`, host );
		update( 'same' );
		const p = host.querySelector( 'p' )!;
		// The dynamic slot is the <p>'s first (and only) child text
		// node. Spy on its textContent setter — a no-op render
		// should leave it untouched.
		const slot = p.firstChild as Text;
		const setSpy = vi.spyOn( slot, 'textContent', 'set' );
		update( 'same' );
		expect( setSpy ).not.toHaveBeenCalled();
		setSpy.mockRestore();
	} );

	test( 'null / false / undefined render as empty strings in text', () => {
		render( html`<p>${ null }|${ undefined }|${ false }|${ 0 }</p>`, host );
		expect( host.querySelector( 'p' )?.textContent ).toBe( '|||0' );
	} );

	test( 'arrays in text flatten to concatenated strings', () => {
		render( html`<p>${ [ 'a', 'b', 'c' ] }</p>`, host );
		expect( host.querySelector( 'p' )?.textContent ).toBe( 'abc' );
	} );

	test( 'switching a slot between templates disposes top-level slot content', () => {
		// The inner templates keep their own slots at TOP level (not
		// wrapped in an element), so their content is inserted as
		// siblings of the instance's cloned nodes. Switching the outer
		// slot to a different template must remove that content too —
		// regression: the Agents detail pane leaked its tabs + form
		// after deleting the last agent swapped in the empty state.
		const detail = ( label: string ) => html`
			<span class="head">${ label }</span>
			${ html`<nav class="tabs">${ label }</nav>` }
			${ html`<form class="pane">${ label }</form>` }
		`;
		const empty = html`<p class="empty">nothing here</p>`;

		render( html`<div class="wrap">${ detail( 'A' ) }</div>`, host );
		expect( host.querySelector( '.head' ) ).not.toBeNull();
		expect( host.querySelector( '.tabs' ) ).not.toBeNull();
		expect( host.querySelector( '.pane' ) ).not.toBeNull();

		render( html`<div class="wrap">${ empty }</div>`, host );
		expect( host.querySelector( '.empty' ) ).not.toBeNull();
		expect( host.querySelector( '.head' ) ).toBeNull();
		expect( host.querySelector( '.tabs' ) ).toBeNull();
		expect( host.querySelector( '.pane' ) ).toBeNull();

		// And back — the empty state must not leak either.
		render( html`<div class="wrap">${ detail( 'B' ) }</div>`, host );
		expect( host.querySelector( '.empty' ) ).toBeNull();
		expect( host.querySelector( '.pane' )?.textContent ).toContain( 'B' );
	} );

	test( 'different strings identity triggers a full remount', () => {
		render( html`<p>first</p>`, host );
		const firstP = host.querySelector( 'p' );
		render( html`<p>second</p>`, host );
		const secondP = host.querySelector( 'p' );
		// Because strings identity changed, the container is
		// re-emptied and re-parsed — different node instances.
		expect( firstP ).not.toBe( secondP );
	} );

	// -------------------------------------------------------------
	// Nested templates + arrays
	// -------------------------------------------------------------

	test( 'nested TemplateResult renders inside a text slot', () => {
		const inner = ( name: string ) => html`<span>hi ${ name }</span>`;
		render( html`<div>${ inner( 'world' ) }</div>`, host );
		const div = host.querySelector( 'div' )!;
		const span = div.querySelector( 'span' );
		expect( span ).not.toBeNull();
		expect( span!.textContent ).toBe( 'hi world' );
	} );

	test( 're-rendering a nested template with same strings updates in place', () => {
		const outer = ( name: string ) =>
			render( html`<div>${ ( ( n ) => html`<span>hi ${ n }</span>` )( name ) }</div>`, host );
		outer( 'alice' );
		const firstSpan = host.querySelector( 'span' );
		outer( 'bob' );
		const secondSpan = host.querySelector( 'span' );
		expect( firstSpan ).toBe( secondSpan );
		expect( secondSpan!.textContent ).toBe( 'hi bob' );
	} );

	test( 'array of TemplateResults renders all items', () => {
		const list = ( items: string[] ) =>
			html`<ul>${ items.map( ( i ) => html`<li>${ i }</li>` ) }</ul>`;
		render( list( [ 'a', 'b', 'c' ] ), host );
		const lis = host.querySelectorAll( 'li' );
		expect( lis.length ).toBe( 3 );
		expect( Array.from( lis ).map( ( n ) => n.textContent ) ).toEqual( [ 'a', 'b', 'c' ] );
	} );

	test( 'array of primitives renders as text nodes', () => {
		render( html`<p>${ [ 'one ', 'two ', 'three' ] }</p>`, host );
		expect( host.querySelector( 'p' )!.textContent ).toBe( 'one two three' );
	} );

	test( 'array shrinking disposes trailing entries', () => {
		const list = ( items: string[] ) =>
			render( html`<ul>${ items.map( ( i ) => html`<li>${ i }</li>` ) }</ul>`, host );
		list( [ 'a', 'b', 'c' ] );
		expect( host.querySelectorAll( 'li' ).length ).toBe( 3 );
		list( [ 'a' ] );
		expect( host.querySelectorAll( 'li' ).length ).toBe( 1 );
		expect( host.querySelector( 'li' )!.textContent ).toBe( 'a' );
	} );

	test( 'array growth mounts new entries', () => {
		const list = ( items: string[] ) =>
			render( html`<ul>${ items.map( ( i ) => html`<li>${ i }</li>` ) }</ul>`, host );
		list( [ 'a' ] );
		list( [ 'a', 'b', 'c' ] );
		expect( host.querySelectorAll( 'li' ).length ).toBe( 3 );
	} );

	test( 'array items keep node identity when length + shape match', () => {
		const list = ( items: string[] ) =>
			render( html`<ul>${ items.map( ( i ) => html`<li>${ i }</li>` ) }</ul>`, host );
		list( [ 'a', 'b' ] );
		const firstLis = Array.from( host.querySelectorAll( 'li' ) );
		list( [ 'x', 'y' ] );
		const secondLis = Array.from( host.querySelectorAll( 'li' ) );
		// Same DOM nodes, text updated in place — proves the array
		// diffed positionally instead of remounting.
		expect( firstLis[ 0 ] ).toBe( secondLis[ 0 ] );
		expect( firstLis[ 1 ] ).toBe( secondLis[ 1 ] );
		expect( secondLis[ 0 ].textContent ).toBe( 'x' );
		expect( secondLis[ 1 ].textContent ).toBe( 'y' );
	} );

	test( 'nested event bindings fire + swap on re-render', () => {
		let counter = 0;
		const bump = () => {
			counter++;
		};
		const outer = ( handler: () => void ) =>
			render(
				html`<div>${ ( ( h ) => html`<button @click=${ h }>go</button>` )( handler ) }</div>`,
				host,
			);
		outer( bump );
		host.querySelector( 'button' )!.click();
		expect( counter ).toBe( 1 );

		const noop = (): void => {};
		outer( noop );
		host.querySelector( 'button' )!.click();
		// Second listener was swapped in; old handler no longer fires.
		expect( counter ).toBe( 1 );
	} );

	test( 'mixed array: primitive + template + null', () => {
		render(
			html`<p>${ [
				'plain ',
				html`<em>italic</em>`,
				null,
				' tail',
			] }</p>`,
			host,
		);
		const p = host.querySelector( 'p' )!;
		expect( p.textContent ).toBe( 'plain italic tail' );
		expect( p.querySelector( 'em' ) ).not.toBeNull();
	} );

	test( 'switching slot shape from text to template tears down the text', () => {
		const variant = ( v: string | ReturnType<typeof html> ) =>
			render( html`<div>${ v }</div>`, host );
		variant( 'plain' );
		expect( host.querySelector( 'span' ) ).toBeNull();
		variant( html`<span>rich</span>` );
		expect( host.querySelector( 'span' )!.textContent ).toBe( 'rich' );
		// textContent of the div now reflects only the span's content
		// — the stale 'plain' text was cleaned up.
		expect( host.querySelector( 'div' )!.textContent ).toBe( 'rich' );
	} );

	test( 'DOM node threaded through a text slot is inserted, not stringified', () => {
		const pre = document.createElement( 'input' );
		pre.type = 'search';
		pre.value = 'hello';
		render( html`<div>${ pre }</div>`, host );
		const live = host.querySelector( 'input' );
		expect( live ).toBe( pre );
		expect( live!.value ).toBe( 'hello' );
		// No accidental stringification.
		expect( host.innerHTML ).not.toContain( '[object' );
	} );

	test( 'DOM node re-render with same node keeps identity; different node swaps', () => {
		const a = document.createElement( 'div' );
		a.id = 'a';
		const b = document.createElement( 'div' );
		b.id = 'b';
		const go = ( n: Node ) =>
			render( html`<section>${ n }</section>`, host );

		go( a );
		expect( host.querySelector( '#a' ) ).toBe( a );

		go( a );
		// Same node — stayed in place, no remount.
		expect( host.querySelector( '#a' ) ).toBe( a );

		go( b );
		expect( host.querySelector( '#a' ) ).toBeNull();
		expect( host.querySelector( '#b' ) ).toBe( b );
	} );

	test( 'siblings after a text-node with multiple markers are still processed', () => {
		// Regression: the walker iterated a snapshot of childNodes but
		// incorrectly advanced `i` past siblings after splitting a text
		// node that contained multiple markers — so any element following
		// such a text node was never walked, leaving its own markers (and
		// attribute bindings) unresolved.
		const onClick = vi.fn();
		render(
			html`
				<header>top</header>
				${ 'a' } ${ 'b' } ${ 'c' }
				<footer>
					<button @click=${ onClick }>${ 'go' }</button>
				</footer>
			`,
			host,
		);
		// All three text markers rendered.
		expect( host.textContent ).toContain( 'a' );
		expect( host.textContent ).toContain( 'b' );
		expect( host.textContent ).toContain( 'c' );
		// Footer's button was walked — event bound, text slot filled,
		// no marker literals leaked into the output.
		const btn = host.querySelector( 'button' )!;
		expect( btn.textContent ).toBe( 'go' );
		expect( host.innerHTML ).not.toContain( '$$wpd$$' );
		btn.click();
		expect( onClick ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'wpd-ui css', () => {
	test( 'returns a StyleDef with text content', () => {
		const style = css`
			:host {
				color: red;
			}
		`;
		expect( style.__wpdCss ).toBe( true );
		expect( style.cssText ).toContain( 'color: red' );
	} );

	test( 'rejects unknown interpolations', () => {
		expect( () =>
			// @ts-expect-error — intentional misuse
			css`:host { color: ${ {} } }`,
		).toThrow( TypeError );
	} );

	test( 'composes nested css`` results', () => {
		const brand = css`
			color: #2271b1;
		`;
		const composed = css`
			:host {
				${ brand }
			}
		`;
		expect( composed.cssText ).toContain( 'color: #2271b1' );
	} );
} );

describe( 'wpd-ui Component', () => {
	// Light-DOM component — exercises the `shadow = false` escape
	// hatch. Most app components use the default (shadow = true),
	// but a few low-level shells want the outer CSS cascade to
	// continue; this test keeps that path covered.
	class WpdGreeter extends Component {
		static props = [ 'name' ] as const;
		static shadow = false;
		protected render() {
			const name = ( this as unknown as { name: string } ).name || 'world';
			return html`<p>Hello ${ name }</p>`;
		}
	}
	defineComponent( 'wpd-greeter', WpdGreeter );

	class WpdSwatch extends Component {
		static props = [ 'selected', 'label' ] as const;
		static shadow = true;
		static styles = [
			css`
				:host {
					display: inline-block;
				}
				button {
					background: var(--bg, #eee);
				}
			`,
		];
		protected render() {
			const selected =
				( this as unknown as { selected: string | null } ).selected !==
				null;
			const label =
				( this as unknown as { label: string | null } ).label || '';
			return html`<button
				class=${ selected ? 'selected' : '' }
				@click=${ ( e: Event ) => this._onClick( e ) }
			>
				${ label }
			</button>`;
		}
		private _onClick( _e: Event ): void {
			this.emit( 'wpd-pick', { label: ( this as unknown as { label: string } ).label } );
		}
	}
	defineComponent( 'wpd-swatch', WpdSwatch );

	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'renders on connection + reflects the initial prop', async () => {
		const el = document.createElement( 'wpd-greeter' ) as WpdGreeter;
		( el as unknown as { name: string } ).name = 'Alice';
		document.body.appendChild( el );
		await microtask();
		expect( el.innerHTML ).toBe( '<p>Hello Alice</p>' );
	} );

	test( 'property → attribute sync', async () => {
		const el = document.createElement( 'wpd-greeter' ) as WpdGreeter;
		document.body.appendChild( el );
		( el as unknown as { name: string } ).name = 'Bob';
		await microtask();
		expect( el.getAttribute( 'name' ) ).toBe( 'Bob' );
	} );

	test( 'attribute → property → re-render', async () => {
		const el = document.createElement( 'wpd-greeter' ) as WpdGreeter;
		document.body.appendChild( el );
		await microtask();
		el.setAttribute( 'name', 'Carol' );
		await microtask();
		expect( el.textContent ).toBe( 'Hello Carol' );
	} );

	test( 'multiple property writes in one tick collapse into a single render', async () => {
		// Subclass-local counter — more robust than spying on DOM
		// ops that an optimiser might skip.
		let renderCount = 0;
		class WpdCounter extends Component {
			static props = [ 'n' ] as const;
			static shadow = false;
			protected render() {
				renderCount++;
				return html`<span>${ ( this as unknown as { n: string } ).n }</span>`;
			}
		}
		defineComponent( 'wpd-counter', WpdCounter );
		const el = document.createElement( 'wpd-counter' ) as WpdCounter;
		document.body.appendChild( el );
		await microtask();
		const before = renderCount;
		( el as unknown as { n: string } ).n = 'one';
		( el as unknown as { n: string } ).n = 'two';
		( el as unknown as { n: string } ).n = 'three';
		await microtask();
		expect( renderCount - before ).toBe( 1 );
		expect( el.textContent ).toBe( 'three' );
	} );

	test( 'shadow DOM component adopts stylesheets on mount', async () => {
		const el = document.createElement( 'wpd-swatch' ) as WpdSwatch;
		( el as unknown as { label: string } ).label = 'Red';
		document.body.appendChild( el );
		await microtask();
		expect( el.shadowRoot ).not.toBeNull();
		const btn = el.shadowRoot!.querySelector( 'button' )!;
		expect( btn.textContent?.trim() ).toBe( 'Red' );
	} );

	test( 'emit dispatches a CustomEvent with detail', async () => {
		const el = document.createElement( 'wpd-swatch' ) as WpdSwatch;
		( el as unknown as { label: string } ).label = 'Blue';
		document.body.appendChild( el );
		await microtask();
		const heard: { detail: { label: string } }[] = [];
		el.addEventListener( 'wpd-pick', ( e: Event ) => {
			heard.push( { detail: ( e as CustomEvent ).detail } );
		} );
		el.shadowRoot!.querySelector( 'button' )!.click();
		expect( heard ).toHaveLength( 1 );
		expect( heard[ 0 ].detail.label ).toBe( 'Blue' );
	} );
} );

/**
 * Vitest + jsdom don't queue microtasks when we simply call
 * `await Promise.resolve()` from outside an async boundary. One
 * `await` of a resolved promise drains the queued `queueMicrotask`
 * callback reliably across engines.
 */
function microtask(): Promise<void> {
	return Promise.resolve();
}
