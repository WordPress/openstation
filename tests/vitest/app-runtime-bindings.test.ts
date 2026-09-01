/**
 * App Framework runtime — the attribute vocabulary.
 *
 * Pins the grammar an `.os.php` view relies on: which event each
 * tag triggers on, how `os-arg-*` and event details merge into
 * arguments, when typing debounces, what `os-bind` writes, and how
 * `os-poll` declarations are read.
 */
import { describe, expect, it } from 'vitest';
import {
	LISTENED_EVENTS,
	boundValue,
	confirmSpec,
	eventFor,
	findTrigger,
	readBinding,
	readPolls,
} from '../../src/app-runtime/bindings';

function el( html: string ): HTMLElement {
	const host = document.createElement( 'div' );
	host.innerHTML = html.trim();
	return host.firstElementChild as HTMLElement;
}

describe( 'eventFor', () => {
	it( 'knows the natural event of the shipped controls', () => {
		expect( eventFor( el( '<os-button></os-button>' ) ) ).toBe( 'click' );
		expect( eventFor( el( '<os-select></os-select>' ) ) ).toBe( 'os-pick' );
		expect( eventFor( el( '<os-segmented></os-segmented>' ) ) ).toBe( 'os-pick' );
		expect( eventFor( el( '<os-text-field></os-text-field>' ) ) ).toBe( 'os-input-change' );
		expect( eventFor( el( '<os-switch></os-switch>' ) ) ).toBe( 'os-switch-change' );
		expect( eventFor( el( '<os-histogram></os-histogram>' ) ) ).toBe( 'os-series-toggle' );
		expect( eventFor( el( '<form></form>' ) ) ).toBe( 'submit' );
	} );

	it( 'falls back to click and honours os-on', () => {
		expect( eventFor( el( '<div></div>' ) ) ).toBe( 'click' );
		expect( eventFor( el( '<os-text-field os-on="os-input-commit"></os-text-field>' ) ) ).toBe( 'os-input-commit' );
	} );

	it( 'listens for every default event', () => {
		for ( const tag of [ 'os-select', 'os-switch', 'os-disclosure', 'details', 'os-histogram' ] ) {
			expect( LISTENED_EVENTS ).toContain( eventFor( el( `<${ tag }></${ tag }>` ) ) );
		}
	} );
} );

describe( 'findTrigger', () => {
	it( 'walks up to the nearest trigger whose event matches', () => {
		const root = el( '<div><os-button os-action="go"><span class="inner">Go</span></os-button></div>' );
		const inner = root.querySelector( '.inner' ) as Element;
		expect( findTrigger( inner, 'click', root ) ).toBe( root.firstElementChild );
	} );

	it( 'ignores a trigger that listens for a different event', () => {
		const root = el( '<div><os-select os-bind="source"><os-option>x</os-option></os-select></div>' );
		const option = root.querySelector( 'os-option' ) as Element;
		expect( findTrigger( option, 'click', root ) ).toBeNull();
		expect( findTrigger( option, 'os-pick', root ) ).toBe( root.firstElementChild );
	} );

	it( 'never returns the root itself', () => {
		const root = el( '<div os-action="nope"><span>x</span></div>' );
		expect( findTrigger( root.firstElementChild, 'click', root ) ).toBeNull();
	} );
} );

describe( 'readBinding', () => {
	it( 'merges os-arg-* attributes with the event detail', () => {
		const trigger = el( '<os-select os-action="pick" os-arg-scope="all"></os-select>' );
		const ev = new CustomEvent( 'os-pick', { detail: { value: 'debug-log' } } );
		const binding = readBinding( trigger, ev );
		expect( binding.action ).toBe( 'pick' );
		expect( binding.args ).toEqual( { scope: 'all', value: 'debug-log' } );
		expect( binding.debounce ).toBe( 0 );
	} );

	it( 'drops event objects and nodes from the detail', () => {
		const trigger = el( '<os-card os-action="open"></os-card>' );
		const ev = new CustomEvent( 'os-card-click', {
			detail: { originalEvent: new MouseEvent( 'click' ), id: 4 },
		} );
		expect( readBinding( trigger, ev ).args ).toEqual( { id: 4 } );
	} );

	it( 'reads native control values', () => {
		const input = el( '<input os-bind="q" value="hello">' ) as HTMLInputElement;
		expect( readBinding( input, new Event( 'change' ) ).args ).toEqual( { value: 'hello' } );
		const box = el( '<input type="checkbox" os-bind="on" checked>' ) as HTMLInputElement;
		expect( readBinding( box, new Event( 'change' ) ).args ).toEqual( { checked: true, value: 'on' } );
		const details = el( '<details os-action="toggle" open></details>' );
		expect( readBinding( details, new Event( 'toggle' ) ).args ).toEqual( { open: true } );
	} );

	it( 'debounces typing by default and honours os-debounce', () => {
		const typed = el( '<os-text-field os-bind="query"></os-text-field>' );
		expect( readBinding( typed, new CustomEvent( 'os-input-change', { detail: { value: 'a' } } ) ).debounce ).toBe( 250 );
		// A slider drag fires per tick, same as typing fires per key —
		// undebounced it is one WordPress request per pixel.
		const dragged = el( '<os-range-field os-bind="size"></os-range-field>' );
		expect( readBinding( dragged, new CustomEvent( 'os-range-change', { detail: { value: 3 } } ) ).debounce ).toBe( 250 );
		const custom = el( '<os-text-field os-bind="query" os-debounce="50"></os-text-field>' );
		expect( readBinding( custom, new CustomEvent( 'os-input-change', { detail: { value: 'a' } } ) ).debounce ).toBe( 50 );
		const clicked = el( '<os-button os-action="go" os-debounce="abc"></os-button>' );
		expect( readBinding( clicked, new MouseEvent( 'click' ) ).debounce ).toBe( 0 );
	} );

	it( 'defaults the action to set when only os-bind is present', () => {
		const binding = readBinding( el( '<os-segmented os-bind="range"></os-segmented>' ), null );
		expect( binding.action ).toBe( 'set' );
		expect( binding.bind ).toBe( 'range' );
	} );
} );

describe( 'boundValue', () => {
	it( 'prefers checked (a switch also carries its identifier as value), then value, then open', () => {
		expect( boundValue( { value: null, checked: true } ) ).toBe( true );
		expect( boundValue( { value: 'on', checked: false } ) ).toBe( false );
		expect( boundValue( { value: '7d' } ) ).toBe( '7d' );
		expect( boundValue( { open: true } ) ).toBe( true );
		expect( boundValue( { key: 'k' } ) ).toBeUndefined();
	} );
} );

describe( 'confirmSpec', () => {
	it( 'reads the four os-confirm attributes', () => {
		const trigger = el(
			'<os-button os-action="clear" os-confirm="Sure?" os-confirm-title="Clear" os-confirm-label="Do it" os-confirm-danger></os-button>',
		);
		expect( confirmSpec( trigger ) ).toEqual( { message: 'Sure?', title: 'Clear', label: 'Do it', danger: true } );
		expect( confirmSpec( el( '<os-button os-action="x"></os-button>' ) ) ).toBeNull();
	} );
} );

describe( 'readPolls', () => {
	it( 'collects os-poll declarations, dedupes them, and rejects silly intervals', () => {
		const root = el( `
			<div>
				<span os-poll="30000" os-action="refresh"></span>
				<span os-poll="30000" os-action="refresh"></span>
				<span os-poll="5000" os-action="refresh" os-arg-scope="fast"></span>
				<span os-poll="10" os-action="refresh"></span>
				<span os-poll="1000"></span>
			</div>
		` );
		const polls = readPolls( root );
		expect( polls ).toHaveLength( 2 );
		expect( polls[ 0 ] ).toMatchObject( { action: 'refresh', intervalMs: 30000, args: {} } );
		expect( polls[ 1 ] ).toMatchObject( { action: 'refresh', intervalMs: 5000, args: { scope: 'fast' } } );
	} );
} );
