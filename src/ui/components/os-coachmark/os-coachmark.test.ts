import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-coachmark';
import type { OsCoachmark } from './os-coachmark';

/** Three microtasks: the paint, then the two the component queues behind it. */
const settle = async (): Promise< void > => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

describe( '<os-coachmark>', () => {
	let host: HTMLElement;
	let show: ReturnType< typeof vi.fn >;
	let hide: ReturnType< typeof vi.fn >;

	beforeEach( () => {
		host = document.createElement( 'div' );
		document.body.appendChild( host );
		// jsdom has no Popover API; the component only calls it when
		// present, and this pins that it does.
		show = vi.fn();
		hide = vi.fn();
		( HTMLElement.prototype as unknown as { showPopover: unknown } ).showPopover = show;
		( HTMLElement.prototype as unknown as { hidePopover: unknown } ).hidePopover = hide;
	} );
	afterEach( () => {
		host.remove();
		delete ( HTMLElement.prototype as unknown as { showPopover?: unknown } ).showPopover;
		delete ( HTMLElement.prototype as unknown as { hidePopover?: unknown } ).hidePopover;
	} );

	async function mount( attrs = '' ): Promise< OsCoachmark > {
		host.innerHTML = `<button id="before">before</button>
			<os-coachmark heading="Hello" step="1" total="3" ${ attrs }>Body</os-coachmark>`;
		await settle();
		return host.querySelector( 'os-coachmark' ) as OsCoachmark;
	}

	test( 'open shows the top-layer popover, focuses the card and restores focus on close', async () => {
		const mark = await mount();
		const before = host.querySelector< HTMLButtonElement >( '#before' )!;
		before.focus();
		expect( host.ownerDocument.activeElement ).toBe( before );

		mark.setAttribute( 'open', '' );
		await settle();
		expect( show ).toHaveBeenCalledTimes( 1 );
		const layer = mark.shadowRoot!.querySelector< HTMLElement >( '.layer' )!;
		expect( layer.hidden ).toBe( false );
		// Focus moved inside the card (the primary button's inner control).
		expect( host.ownerDocument.activeElement ).toBe( mark );
		expect( mark.shadowRoot!.activeElement?.classList.contains( 'primary' ) ).toBe( true );

		mark.removeAttribute( 'open' );
		await settle();
		expect( hide ).toHaveBeenCalledTimes( 1 );
		expect( layer.hidden ).toBe( true );
		expect( host.ownerDocument.activeElement ).toBe( before );
	} );

	test( 'renders the counter and fires the three events', async () => {
		const mark = await mount( 'open primary-label="Do it" secondary-label="Skip"' );
		const primary = vi.fn();
		const secondary = vi.fn();
		const dismiss = vi.fn();
		mark.addEventListener( 'os-coachmark-primary', primary );
		mark.addEventListener( 'os-coachmark-secondary', secondary );
		mark.addEventListener( 'os-coachmark-dismiss', dismiss );

		const root = mark.shadowRoot!;
		expect( root.querySelector( '.meta' )!.textContent ).toBe( '1 of 3' );
		root.querySelector< HTMLElement >( 'os-button.primary' )!.click();
		root.querySelector< HTMLElement >( 'os-button.secondary' )!.click();
		root
			.querySelector< HTMLElement >( '.card' )!
			.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );

		expect( primary ).toHaveBeenCalledTimes( 1 );
		expect( ( primary.mock.calls[ 0 ][ 0 ] as CustomEvent ).detail ).toEqual( { step: 1 } );
		expect( secondary ).toHaveBeenCalledTimes( 1 );
		expect( dismiss ).toHaveBeenCalledTimes( 1 );
		// Dismiss is a request, not a close: the host decides.
		expect( mark.hasAttribute( 'open' ) ).toBe( true );
	} );

	test( 'an empty secondary label hides the secondary button; the outline follows the anchor', async () => {
		const mark = await mount( 'open secondary-label=""' );
		const root = mark.shadowRoot!;
		expect( root.querySelector< HTMLElement >( 'os-button.secondary' )!.hidden ).toBe( true );
		const outline = root.querySelector< HTMLElement >( '.outline' )!;
		expect( outline.hidden ).toBe( true );

		const target = document.createElement( 'div' );
		host.appendChild( target );
		target.getBoundingClientRect = () =>
			( { left: 100, top: 200, width: 50, height: 40, right: 150, bottom: 240 } ) as DOMRect;
		mark.anchor = target;
		expect( outline.hidden ).toBe( false );
		expect( outline.style.left ).toBe( '96px' );
		expect( outline.style.top ).toBe( '196px' );
		expect( outline.style.width ).toBe( '58px' );

		mark.anchor = null;
		expect( outline.hidden ).toBe( true );
	} );
} );
