/**
 * Unit tests for `src/ui/modal-focus.ts` — the focus scope every
 * light-DOM modal in the shell shares.
 *
 * jsdom does not run the browser's own sequential-focus navigation,
 * so a "Tab" here is a synthetic keydown: the trap's job is to
 * *intervene* at the ends, and that intervention is exactly what a
 * synthetic event exercises. The stretches it deliberately leaves to
 * the browser are the stretches there is nothing to assert about.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { trapFocus } from '../../src/ui/modal-focus';

function tab( shiftKey = false ): void {
	document.dispatchEvent(
		new KeyboardEvent( 'keydown', {
			key: 'Tab',
			shiftKey,
			bubbles: true,
			cancelable: true,
		} ),
	);
}

describe( 'trapFocus', () => {
	let outside: HTMLButtonElement;
	let dialog: HTMLElement;
	let first: HTMLButtonElement;
	let last: HTMLButtonElement;

	beforeEach( () => {
		document.body.innerHTML = '';
		outside = document.createElement( 'button' );
		outside.textContent = 'behind the scrim';
		document.body.appendChild( outside );

		dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'dialog' );
		first = document.createElement( 'button' );
		first.textContent = 'settings';
		last = document.createElement( 'button' );
		last.textContent = 'got it';
		dialog.append( first, last );
		document.body.appendChild( dialog );
	} );

	afterEach( () => {
		document.body.innerHTML = '';
	} );

	test( 'moves focus into the dialog on open', () => {
		outside.focus();
		trapFocus( { root: dialog, initialFocus: last } );
		expect( document.activeElement ).toBe( last );
	} );

	test( 'falls back to the first control, then to the root itself', () => {
		const scope = trapFocus( { root: dialog } );
		expect( document.activeElement ).toBe( first );
		scope.release();

		const empty = document.createElement( 'div' );
		document.body.appendChild( empty );
		trapFocus( { root: empty } );
		expect( document.activeElement ).toBe( empty );
		// A bare <div> has no tab stop — the scope has to give it a
		// programmatic one or `focus()` is a silent no-op.
		expect( empty.getAttribute( 'tabindex' ) ).toBe( '-1' );
	} );

	test( 'Tab wraps from the last control back to the first', () => {
		trapFocus( { root: dialog, initialFocus: last } );
		tab();
		expect( document.activeElement ).toBe( first );
	} );

	test( 'Shift+Tab wraps from the first control back to the last', () => {
		trapFocus( { root: dialog, initialFocus: first } );
		tab( true );
		expect( document.activeElement ).toBe( last );
	} );

	test( 'Tab from outside the dialog is pulled back in', () => {
		trapFocus( { root: dialog, initialFocus: last } );
		// Selecting text inside the dialog leaves focus on <body>;
		// from there neither end matches and an unguarded forward Tab
		// would hand focus to the first control behind the scrim.
		( document.activeElement as HTMLElement ).blur();
		tab();
		expect( document.activeElement ).toBe( first );
	} );

	test( 'focus landing behind the scrim is pulled back to where it was', () => {
		trapFocus( { root: dialog, initialFocus: last } );
		outside.focus();
		expect( document.activeElement ).toBe( last );
	} );

	test( 'a released scope stops trapping', () => {
		const scope = trapFocus( { root: dialog, initialFocus: last } );
		scope.release();
		outside.focus();
		expect( document.activeElement ).toBe( outside );
	} );

	test( 'release hands focus to returnFocusTo ahead of the opener', () => {
		const windowRoot = document.createElement( 'div' );
		document.body.appendChild( windowRoot );
		outside.focus();

		const scope = trapFocus( {
			root: dialog,
			initialFocus: last,
			returnFocusTo: windowRoot,
		} );
		scope.release();

		expect( document.activeElement ).toBe( windowRoot );
		expect( windowRoot.getAttribute( 'tabindex' ) ).toBe( '-1' );
	} );

	test( 'release falls back to the opener when no return target is given', () => {
		outside.focus();
		const scope = trapFocus( { root: dialog, initialFocus: last } );
		scope.release();
		expect( document.activeElement ).toBe( outside );
	} );

	test( 'release skips a return target that has left the document', () => {
		const gone = document.createElement( 'div' );
		document.body.appendChild( gone );
		outside.focus();
		const scope = trapFocus( {
			root: dialog,
			initialFocus: last,
			returnFocusTo: gone,
		} );
		gone.remove();
		scope.release();
		expect( document.activeElement ).toBe( outside );
	} );

	test( 'release is idempotent', () => {
		outside.focus();
		const scope = trapFocus( { root: dialog, initialFocus: last } );
		scope.release();
		( document.activeElement as HTMLElement ).blur();
		// A second release must not yank focus back a second time —
		// several dismissal paths reach the dialogs' cleanup().
		scope.release();
		expect( document.activeElement ).not.toBe( outside );
	} );

	test( 'unbinds itself once the dialog leaves the document', () => {
		trapFocus( { root: dialog, initialFocus: last } );
		dialog.remove();
		outside.focus();
		expect( document.activeElement ).toBe( outside );
		tab();
		expect( document.activeElement ).toBe( outside );
	} );
} );
