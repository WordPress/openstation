/**
 * Component base-class — attribute/property reflection.
 *
 * Locks in the HTML-convention reflection rule: assigning `false` /
 * `null` / `undefined` to a `static props` accessor REMOVES the
 * attribute, assigning `true` adds it with an empty value. Without
 * this, `el.disabled = false` used to emit `disabled="false"` and
 * the element stayed visually disabled because `[disabled]` and
 * `hasAttribute('disabled')` both still matched.
 *
 * @since 0.19.0
 */

import { describe, expect, it } from 'vitest';
import { Component, defineComponent } from './component';
import { html } from './html';

class WpdReflectTest extends Component {
	static props = [ 'disabled', 'busy', 'variant', 'value' ] as const;
	static shadow = false;
	render() {
		return html``;
	}
}
defineComponent( 'wpd-reflect-test', WpdReflectTest );

const tag = ( cb: ( el: WpdReflectTest ) => void ): void => {
	const el = document.createElement( 'wpd-reflect-test' ) as WpdReflectTest;
	document.body.appendChild( el );
	try {
		cb( el );
	} finally {
		el.remove();
	}
};

describe( 'Component prop reflection', () => {
	it( 'removes the attribute when set to `false`', () => {
		tag( ( el ) => {
			el.setAttribute( 'disabled', '' );
			expect( el.hasAttribute( 'disabled' ) ).toBe( true );
			( el as unknown as { disabled: boolean } ).disabled = false;
			expect( el.hasAttribute( 'disabled' ) ).toBe( false );
		} );
	} );

	it( 'removes the attribute when set to `null`', () => {
		tag( ( el ) => {
			el.setAttribute( 'disabled', '' );
			( el as unknown as { disabled: null } ).disabled = null;
			expect( el.hasAttribute( 'disabled' ) ).toBe( false );
		} );
	} );

	it( 'removes the attribute when set to `undefined`', () => {
		tag( ( el ) => {
			el.setAttribute( 'disabled', '' );
			( el as unknown as { disabled: undefined } ).disabled = undefined;
			expect( el.hasAttribute( 'disabled' ) ).toBe( false );
		} );
	} );

	it( 'sets an empty-value attribute when set to `true`', () => {
		tag( ( el ) => {
			( el as unknown as { busy: boolean } ).busy = true;
			expect( el.hasAttribute( 'busy' ) ).toBe( true );
			expect( el.getAttribute( 'busy' ) ).toBe( '' );
		} );
	} );

	it( 'stringifies non-boolean values unchanged', () => {
		tag( ( el ) => {
			( el as unknown as { variant: string } ).variant = 'primary';
			expect( el.getAttribute( 'variant' ) ).toBe( 'primary' );
			( el as unknown as { value: number } ).value = 42;
			expect( el.getAttribute( 'value' ) ).toBe( '42' );
		} );
	} );

	it( 'reflects setAttribute back through the getter', () => {
		tag( ( el ) => {
			el.setAttribute( 'variant', 'danger' );
			expect( ( el as unknown as { variant: string } ).variant ).toBe( 'danger' );
		} );
	} );
} );
