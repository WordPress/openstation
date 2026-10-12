/**
 * Component base-class — attribute/property reflection.
 *
 * Locks in the HTML-convention reflection rule: assigning `false` /
 * `null` / `undefined` to a `static props` accessor REMOVES the
 * attribute, assigning `true` adds it with an empty value. Without
 * this, `el.disabled = false` used to emit `disabled="false"` and
 * the element stayed visually disabled because `[disabled]` and
 * `hasAttribute('disabled')` both still matched.
 */

import { describe, expect, it } from 'vitest';
import { Component, defineComponent } from './component';
import { html } from './html';

class OsReflectTest extends Component {
	static props = [ 'disabled', 'busy', 'variant', 'value' ] as const;
	static shadow = false;
	render() {
		return html``;
	}
}
defineComponent( 'os-reflect-test', OsReflectTest );

const tag = ( cb: ( el: OsReflectTest ) => void ): void => {
	const el = document.createElement( 'os-reflect-test' ) as OsReflectTest;
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

/**
 * A property assigned while the tag is still undefined lands as an own
 * data property on the plain element, and would shadow the class's
 * accessor after the upgrade. The app runtime assigns `os-prop-*`
 * values before it lazy-loads the component, so this is the cold-open
 * path for every property-driven component.
 */
class OsUpgradeTest extends Component {
	static props = [ 'variant' ] as const;
	static shadow = false;
	received: unknown = 'unset';
	get data(): unknown {
		return this.received;
	}
	set data( next: unknown ) {
		this.received = next;
	}
	render() {
		return html``;
	}
}

describe( 'Component upgrade', () => {
	it( 'routes properties assigned before define() through the class', () => {
		const el = document.createElement( 'os-upgrade-test' ) as unknown as Record< string, unknown >;
		el.data = [ 1, 2 ];
		el.variant = 'primary';
		document.body.appendChild( el as unknown as Element );
		try {
			defineComponent( 'os-upgrade-test', OsUpgradeTest );
			expect( ( el as unknown as OsUpgradeTest ).received ).toEqual( [ 1, 2 ] );
			expect( Object.prototype.hasOwnProperty.call( el, 'data' ) ).toBe( false );
			expect( ( el as unknown as Element ).getAttribute( 'variant' ) ).toBe( 'primary' );
		} finally {
			( el as unknown as Element ).remove();
		}
	} );
} );
