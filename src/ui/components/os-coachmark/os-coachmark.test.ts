import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import './os-coachmark';
import { COACHMARK_EXIT_MS, type OsCoachmark } from './os-coachmark';

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

		vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } );
		mark.removeAttribute( 'open' );
		await settle();
		// Focus is back straight away; the card is still fading out.
		expect( host.ownerDocument.activeElement ).toBe( before );
		expect( hide ).not.toHaveBeenCalled();
		expect( layer.hidden ).toBe( false );
		expect( layer.classList.contains( 'leaving' ) ).toBe( true );

		vi.advanceTimersByTime( COACHMARK_EXIT_MS );
		await settle();
		expect( hide ).toHaveBeenCalledTimes( 1 );
		expect( layer.hidden ).toBe( true );
		vi.useRealTimers();
	} );

	test( 'reopening mid fade-out cancels the exit instead of hiding', async () => {
		vi.useFakeTimers( { toFake: [ 'setTimeout', 'clearTimeout' ] } );
		const mark = await mount( 'open' );
		mark.removeAttribute( 'open' );
		await settle();
		mark.setAttribute( 'open', '' );
		await settle();
		vi.advanceTimersByTime( COACHMARK_EXIT_MS );
		await settle();
		const layer = mark.shadowRoot!.querySelector< HTMLElement >( '.layer' )!;
		expect( hide ).not.toHaveBeenCalled();
		expect( layer.hidden ).toBe( false );
		expect( layer.classList.contains( 'leaving' ) ).toBe( false );
		vi.useRealTimers();
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
		// The built-in counter is English; a caller passes its own.
		mark.setAttribute( 'counter-label', '1 de 3' );
		await settle();
		expect( root.querySelector( '.meta' )!.textContent ).toBe( '1 de 3' );
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

		// highlight="none": the card still points, the anchor keeps its look.
		mark.setAttribute( 'highlight', 'none' );
		mark.anchor = target;
		expect( outline.hidden ).toBe( true );
	} );

	test( 'an anchor that is hidden or removed lets go of the ring, and takes it back when it returns', async () => {
		// A hidden anchor is still connected and reports a rect of zeros,
		// which put the card and an 8px ring in the top-left corner; a
		// removed one stopped the tracking and left the ring behind.
		const mark = await mount( 'open' );
		const outline = mark.shadowRoot!.querySelector< HTMLElement >( '.outline' )!;
		const frames = async (): Promise< void > => {
			await new Promise( ( resolve ) => requestAnimationFrame( () => resolve( null ) ) );
			await new Promise( ( resolve ) => requestAnimationFrame( () => resolve( null ) ) );
		};
		const target = document.createElement( 'div' );
		host.appendChild( target );
		let visible = true;
		target.getBoundingClientRect = () =>
			( visible
				? { left: 100, top: 200, width: 50, height: 40, right: 150, bottom: 240 }
				: { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 } ) as DOMRect;
		// jsdom has no layout, so no `checkVisibility` either.
		( target as unknown as { checkVisibility: () => boolean } ).checkVisibility = () => visible;
		mark.anchor = target;
		expect( outline.hidden ).toBe( false );

		visible = false;
		await frames();
		expect( outline.hidden ).toBe( true );

		visible = true;
		await frames();
		expect( outline.hidden ).toBe( false );
		expect( outline.style.left ).toBe( '96px' );

		target.remove();
		await frames();
		expect( outline.hidden ).toBe( true );
	} );

	test( 'a new anchor animates the move; the anchor moving on its own does not', async () => {
		const mark = await mount( 'open' );
		const layer = mark.shadowRoot!.querySelector< HTMLElement >( '.layer' )!;
		const target = document.createElement( 'div' );
		host.appendChild( target );
		mark.anchor = target;
		expect( layer.classList.contains( 'stepping' ) ).toBe( true );

		layer.classList.remove( 'stepping' );
		// Tracking a dragged window re-positions every frame; if that
		// transitioned, the ring would trail behind the drag.
		( mark as unknown as { _position(): void } )._position();
		expect( layer.classList.contains( 'stepping' ) ).toBe( false );
	} );

	test( 'the tail points at the speaker when there is one, and at the anchor when there is not', async () => {
		const mark = await mount( 'open speaker-size="100"' );
		const root = mark.shadowRoot!;
		const card = root.querySelector< HTMLElement >( '.card' )!;
		const tail = root.querySelector< HTMLElement >( '.tail' )!;
		card.getBoundingClientRect = () =>
			( { left: 0, top: 0, width: 300, height: 120, right: 300, bottom: 120 } ) as DOMRect;
		Object.defineProperty( window, 'innerHeight', { value: 768, configurable: true } );
		Object.defineProperty( window, 'innerWidth', { value: 1024, configurable: true } );
		const spots: Array< { x: number; y: number } > = [];
		mark.addEventListener( 'os-coachmark-speaker', ( e ) =>
			spots.push( ( e as CustomEvent< { x: number; y: number } > ).detail ),
		);
		const anchorAt = ( left: number, top: number ): HTMLElement => {
			const el = document.createElement( 'div' );
			host.appendChild( el );
			el.getBoundingClientRect = () =>
				( { left, top, width: 40, height: 40, right: left + 40, bottom: top + 40 } ) as DOMRect;
			return el;
		};

		// A dock tile near the right edge: the card goes above it, at its
		// usual distance, and speaks from its left, where the room is.
		mark.anchor = anchorAt( 800, 700 );
		expect( card.style.top ).toBe( `${ 700 - 4 - 12 - 120 }px` );
		expect( tail.dataset.edge ).toBe( 'left' );
		const cardLeft = parseFloat( card.style.left );
		const reach = 16 + 100 / 2;
		expect( spots[ spots.length - 1 ] ).toEqual( { x: cardLeft - reach, y: 700 - 4 - 12 - 120 + 60 } );

		// A card beside its anchor speaks from below instead.
		mark.setAttribute( 'placement', 'end' );
		mark.anchor = anchorAt( 100, 100 );
		expect( tail.dataset.edge ).toBe( 'bottom' );
		const top = parseFloat( card.style.top );
		expect( spots[ spots.length - 1 ].y ).toBe( top + 120 + reach );

		// Without a speaker the tail points at the anchor instead: the card
		// sits above the tile, so the tail is on its bottom edge, level with
		// the tile's centre, and a peeking figure is told to look down.
		mark.removeAttribute( 'speaker-size' );
		mark.removeAttribute( 'placement' );
		mark.anchor = anchorAt( 800, 700 );
		expect( tail.hidden ).toBe( false );
		expect( tail.dataset.edge ).toBe( 'bottom' );
		expect( tail.style.getPropertyValue( '--_tail-at' ) ).toBe(
			`${ 820 - parseFloat( card.style.left ) }px`,
		);
		expect( mark.style.getPropertyValue( '--os-coachmark-look-y' ) ).toBe( '1' );

		// No anchor, nothing to point at.
		mark.anchor = null;
		expect( tail.hidden ).toBe( true );
		expect( mark.style.getPropertyValue( '--os-coachmark-look-y' ) ).toBe( '0' );
	} );
} );
