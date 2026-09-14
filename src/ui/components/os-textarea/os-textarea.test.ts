import { afterEach, expect, test, vi } from 'vitest';
import './os-textarea';
import type { OsTextarea } from './os-textarea';

afterEach( () => {
	document.body.innerHTML = ''; vi.restoreAllMocks();
} );

test( 'auto-grow includes borders, caps at two lines and scrolls overflow; clear shrinks', async () => {
	const host = document.createElement( 'os-textarea' ) as OsTextarea;
	host.setAttribute( 'rows', '1' ); host.setAttribute( 'auto-grow', '' ); host.setAttribute( 'max-rows', '2' );
	document.body.append( host ); await Promise.resolve();
	const textarea = host.shadowRoot!.querySelector( 'textarea' )!;
	vi.spyOn( window, 'getComputedStyle' ).mockReturnValue( { fontSize: '13px', lineHeight: '20px', paddingTop: '8px', paddingBottom: '8px', borderTopWidth: '1px', borderBottomWidth: '1px' } as CSSStyleDeclaration );
	vi.spyOn( textarea, 'scrollHeight', 'get' ).mockReturnValue( 116 );
	textarea.value = 'A long message with more than two lines'; textarea.dispatchEvent( new Event( 'input' ) );
	expect( textarea.style.height ).toBe( '58px' ); expect( textarea.style.overflowY ).toBe( 'auto' );
	host.clear(); expect( textarea.style.height ).toBe( '38px' ); expect( textarea.style.overflowY ).toBe( 'hidden' );
} );

test( 'Enter does not submit while composing text; normal Enter submits', async () => {
	const host = document.createElement( 'os-textarea' ); host.setAttribute( 'submit-on-enter', '' ); document.body.append( host ); await Promise.resolve();
	const submit = vi.fn(); host.addEventListener( 'os-submit', submit );
	const textarea = host.shadowRoot!.querySelector( 'textarea' )!;
	textarea.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', isComposing: true } ) );
	textarea.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter', keyCode: 229 } ) );
	expect( submit ).not.toHaveBeenCalled();
	textarea.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Enter' } ) ); expect( submit ).toHaveBeenCalledOnce();
} );
