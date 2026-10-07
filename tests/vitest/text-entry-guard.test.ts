import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	installTextEntryGuard,
	isShadowTextEntryKeydown,
} from '../../src/text-entry-guard';
import '../../src/ui/components/os-text-field/os-text-field';

const tick = (): Promise< void > => Promise.resolve();

function keydown( init: KeyboardEventInit ): KeyboardEvent {
	return new KeyboardEvent( 'keydown', {
		bubbles: true,
		composed: true,
		cancelable: true,
		...init,
	} );
}

function thirdPartyShortcut( letter: string ): {
	fired: number;
	off: () => void;
} {
	const state = { fired: 0, off: () => {} };
	const listener = ( e: Event ): void => {
		const target = e.target as HTMLElement;
		if ( target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ) {
			return;
		}
		if ( ( e as KeyboardEvent ).key === letter ) {
			state.fired++;
		}
	};
	document.addEventListener( 'keydown', listener );
	state.off = () => document.removeEventListener( 'keydown', listener );
	return state;
}

function shadowLeaf< T extends HTMLElement >( leaf: T ): T {
	const host = document.createElement( 'div' );
	document.body.appendChild( host );
	host.attachShadow( { mode: 'open' } ).appendChild( leaf );
	return leaf;
}

describe( 'text-entry guard', () => {
	let off: () => void;

	beforeEach( () => {
		off = installTextEntryGuard();
	} );

	afterEach( () => {
		off();
		document.body.innerHTML = '';
	} );

	test( 'a bare letter typed into a shadow-root input never reaches a document listener', () => {
		const shortcut = thirdPartyShortcut( 'n' );
		const input = shadowLeaf( document.createElement( 'input' ) );

		const seenByDocument: string[] = [];
		const capture = ( e: Event ): void => {
			seenByDocument.push( ( e as KeyboardEvent ).key );
		};
		document.addEventListener( 'keydown', capture, true );

		const ev = keydown( { key: 'n' } );
		input.dispatchEvent( ev );

		expect( shortcut.fired ).toBe( 0 );
		expect( seenByDocument ).toEqual( [] );

		expect( ev.defaultPrevented ).toBe( false );

		document.removeEventListener( 'keydown', capture, true );
		shortcut.off();
	} );

	test( 'the same script still sees a bare letter typed into a light-DOM input as INPUT', () => {
		const shortcut = thirdPartyShortcut( 'n' );
		const input = document.createElement( 'input' );
		document.body.appendChild( input );

		let reached = 0;
		const bubble = (): void => {
			reached++;
		};
		document.addEventListener( 'keydown', bubble );

		input.dispatchEvent( keydown( { key: 'n' } ) );

		expect( reached ).toBe( 1 );
		expect( shortcut.fired ).toBe( 0 );

		document.removeEventListener( 'keydown', bubble );
		shortcut.off();
	} );

	test( 'a bare letter on a non-text element still fires the shortcut', () => {
		const shortcut = thirdPartyShortcut( 'n' );
		const button = document.createElement( 'button' );
		document.body.appendChild( button );

		button.dispatchEvent( keydown( { key: 'n' } ) );
		expect( shortcut.fired ).toBe( 1 );
		shortcut.off();
	} );

	test( 'named keys and chords from a shadow-root input keep propagating', () => {
		const input = shadowLeaf( document.createElement( 'input' ) );
		const seen: string[] = [];
		const listener = ( e: Event ): void => {
			const k = e as KeyboardEvent;
			seen.push( `${ k.metaKey ? 'meta+' : '' }${ k.ctrlKey ? 'ctrl+' : '' }${ k.key }` );
		};
		document.addEventListener( 'keydown', listener );

		input.dispatchEvent( keydown( { key: 'Escape' } ) );
		input.dispatchEvent( keydown( { key: 'Enter' } ) );
		input.dispatchEvent( keydown( { key: 'ArrowDown' } ) );
		input.dispatchEvent( keydown( { key: 'Tab' } ) );
		input.dispatchEvent( keydown( { key: 'k', metaKey: true } ) );
		input.dispatchEvent( keydown( { key: 'n', ctrlKey: true } ) );
		input.dispatchEvent( keydown( { key: 'Process' } ) );

		expect( seen ).toEqual( [
			'Escape',
			'Enter',
			'ArrowDown',
			'Tab',
			'meta+k',
			'ctrl+n',
			'Process',
		] );
		document.removeEventListener( 'keydown', listener );
	} );

	test( 'a listener on window still sees the keystroke (the presence probe)', () => {
		const input = shadowLeaf( document.createElement( 'input' ) );
		let seen = 0;
		const probe = (): void => {
			seen++;
		};
		window.addEventListener( 'keydown', probe, true );

		input.dispatchEvent( keydown( { key: 'n' } ) );
		expect( seen ).toBe( 1 );

		window.removeEventListener( 'keydown', probe, true );
	} );

	test( 'the real <os-text-field>: n is hidden from the document, Enter still submits', async () => {
		const shortcut = thirdPartyShortcut( 'n' );
		const host = document.createElement( 'div' );
		document.body.appendChild( host );
		host.innerHTML = '<os-text-field label="Folder name" value="Untitled folder"></os-text-field>';
		await tick();

		const field = host.querySelector( 'os-text-field' )!;
		const input = field.shadowRoot!.querySelector( 'input' ) as HTMLInputElement;
		let submitted = 0;
		field.addEventListener( 'os-submit', () => {
			submitted++;
		} );

		input.dispatchEvent( keydown( { key: 'n' } ) );
		expect( shortcut.fired ).toBe( 0 );

		input.dispatchEvent( keydown( { key: 'Enter' } ) );
		expect( submitted ).toBe( 1 );

		shortcut.off();
	} );

	test( 'uninstalling restores propagation', () => {
		off();
		const shortcut = thirdPartyShortcut( 'n' );
		const input = shadowLeaf( document.createElement( 'input' ) );

		input.dispatchEvent( keydown( { key: 'n' } ) );
		expect( shortcut.fired ).toBe( 1 );

		shortcut.off();

	} );

	test( 'installing twice is one listener', () => {
		const again = installTextEntryGuard();
		expect( again ).toBe( off );
	} );
} );

describe( 'isShadowTextEntryKeydown — the policy', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	function judge( leaf: HTMLElement, init: KeyboardEventInit ): boolean {
		let verdict = false;
		const listener = ( e: Event ): void => {
			verdict = isShadowTextEntryKeydown( e as KeyboardEvent );
		};
		leaf.addEventListener( 'keydown', listener );
		leaf.dispatchEvent( keydown( init ) );
		leaf.removeEventListener( 'keydown', listener );
		return verdict;
	}

	test( 'text-ish inputs, textareas and contenteditable in a shadow root qualify', () => {
		expect( judge( shadowLeaf( document.createElement( 'input' ) ), { key: 'n' } ) ).toBe( true );
		const search = document.createElement( 'input' );
		search.type = 'search';
		expect( judge( shadowLeaf( search ), { key: ' ' } ) ).toBe( true );
		expect( judge( shadowLeaf( document.createElement( 'textarea' ) ), { key: 'n' } ) ).toBe( true );
		const editable = document.createElement( 'div' );
		editable.setAttribute( 'contenteditable', 'true' );
		expect( judge( shadowLeaf( editable ), { key: 'n' } ) ).toBe( true );
	} );

	test( 'inputs that do not take characters do not qualify', () => {
		const checkbox = document.createElement( 'input' );
		checkbox.type = 'checkbox';
		expect( judge( shadowLeaf( checkbox ), { key: 'n' } ) ).toBe( false );
		expect( judge( shadowLeaf( document.createElement( 'button' ) ), { key: 'n' } ) ).toBe( false );
	} );

	test( 'a light-DOM input does not qualify', () => {
		const input = document.createElement( 'input' );
		document.body.appendChild( input );
		expect( judge( input, { key: 'n' } ) ).toBe( false );
	} );

	test( 'modifiers and named keys do not qualify', () => {
		const input = shadowLeaf( document.createElement( 'input' ) );
		expect( judge( input, { key: 'n', metaKey: true } ) ).toBe( false );
		expect( judge( input, { key: 'n', ctrlKey: true } ) ).toBe( false );
		expect( judge( input, { key: 'n', altKey: true } ) ).toBe( false );
		expect( judge( input, { key: 'N', shiftKey: true } ) ).toBe( true );
		expect( judge( input, { key: 'Enter' } ) ).toBe( false );
		expect( judge( input, { key: 'Dead' } ) ).toBe( false );
	} );
} );
