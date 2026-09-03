/**
 * OpenStation — phone layer: the app switcher.
 *
 * A sheet over the app listing every open window as a card, most
 * recent first. Tap a card to go to it; swipe it sideways to close
 * it; "Close all" at the bottom.
 *
 * The cards are a deck. Each one is drawn as a small window (a title
 * bar over a body surface) and the deck is laid out bottom-up by
 * `mobile.css`, so the front card sits nearest the thumb and every
 * card behind it peeks out above with its title showing. The pile is
 * the picture of what the switcher holds: windows on top of windows.
 *
 * The switcher is a dialog: focus moves in when it opens, returns to
 * where it was when it closes, and Escape closes it. Cards are plain
 * buttons — a screen reader user closes with the × next to each,
 * the swipe is the pointer's shortcut to the same thing.
 */
import { __, sprintf } from '../i18n';
import { osIcon } from '../ui/icons';
import { SWIPE_INTENT_PX, swipeOutcome } from './gestures';

export interface SwitcherCard {
	id: string;
	title: string;
	icon: string;
	subtitle: string;
	/** The app that is on screen right now — tapping it just dismisses the sheet. */
	active?: boolean;
}

export interface SwitcherDeps {
	renderIcon: ( icon: string, opts: { title: string; className?: string } ) => HTMLElement;
	onPick: ( card: SwitcherCard ) => void;
	onClose: ( card: SwitcherCard ) => void;
	onCloseAll: () => void;
	/** The sheet was dismissed (backdrop, ×, Escape). */
	onDismiss: () => void;
}

export interface SwitcherSurface {
	el: HTMLElement;
	open( cards: readonly SwitcherCard[] ): void;
	/** Repaint while open; a no-op while closed or mid-swipe. */
	update( cards: readonly SwitcherCard[] ): void;
	close(): void;
	isOpen(): boolean;
}

export function createSwitcher( host: HTMLElement, deps: SwitcherDeps ): SwitcherSurface {
	const el = document.createElement( 'div' );
	el.className = 'os-mobile-switcher';
	el.setAttribute( 'role', 'dialog' );
	el.setAttribute( 'aria-modal', 'true' );
	el.setAttribute( 'aria-label', __( 'Open apps' ) );
	el.hidden = true;

	const backdrop = document.createElement( 'div' );
	backdrop.className = 'os-mobile-switcher__backdrop';
	backdrop.addEventListener( 'click', () => deps.onDismiss() );

	const sheet = document.createElement( 'div' );
	sheet.className = 'os-mobile-switcher__sheet';

	const header = document.createElement( 'header' );
	header.className = 'os-mobile-switcher__header';
	const heading = document.createElement( 'h2' );
	heading.className = 'os-mobile-switcher__title';
	heading.textContent = __( 'Open apps' );
	const closeButton = document.createElement( 'button' );
	closeButton.type = 'button';
	closeButton.className = 'os-mobile-switcher__close';
	closeButton.setAttribute( 'aria-label', __( 'Close the switcher' ) );
	closeButton.appendChild( osIcon( 'close', { size: 20 } ) );
	closeButton.addEventListener( 'click', () => deps.onDismiss() );
	header.append( heading, closeButton );

	const list = document.createElement( 'div' );
	list.className = 'os-mobile-switcher__list';

	const footer = document.createElement( 'footer' );
	footer.className = 'os-mobile-switcher__footer';
	const closeAll = document.createElement( 'os-button' );
	closeAll.setAttribute( 'variant', 'secondary' );
	closeAll.textContent = __( 'Close all' );
	closeAll.addEventListener( 'click', () => deps.onCloseAll() );
	footer.appendChild( closeAll );

	sheet.append( header, list, footer );
	el.append( backdrop, sheet );
	host.appendChild( el );

	let open = false;
	let swiping = false;
	let pendingCards: readonly SwitcherCard[] | null = null;
	let restoreFocus: HTMLElement | null = null;

	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			e.preventDefault();
			deps.onDismiss();
		}
	};

	const card = ( c: SwitcherCard ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'os-mobile-card';
		wrap.dataset.cardId = c.id;
		if ( c.active ) {
			wrap.classList.add( 'os-mobile-card--active' );
		}

		const body = document.createElement( 'button' );
		body.type = 'button';
		body.className = 'os-mobile-card__body';
		if ( c.active ) {
			body.setAttribute( 'aria-current', 'true' );
		}
		body.setAttribute( 'aria-label', c.title );
		const icon = document.createElement( 'span' );
		icon.className = 'os-mobile-card__icon';
		icon.appendChild( deps.renderIcon( c.icon, { title: c.title, className: 'os-mobile-card__glyph' } ) );
		const text = document.createElement( 'span' );
		text.className = 'os-mobile-card__text';
		const title = document.createElement( 'span' );
		title.className = 'os-mobile-card__title';
		title.textContent = c.title;
		const subtitle = document.createElement( 'span' );
		subtitle.className = 'os-mobile-card__subtitle';
		subtitle.textContent = c.subtitle;
		text.append( title, subtitle );
		if ( c.active ) {
			const chip = document.createElement( 'span' );
			chip.className = 'os-mobile-card__status';
			chip.textContent = __( 'Active' );
			title.appendChild( chip );
		}
		// A small window: the title bar, then the body surface the next
		// card in the deck overlaps.
		const bar = document.createElement( 'span' );
		bar.className = 'os-mobile-card__bar';
		bar.append( icon, text );
		const preview = document.createElement( 'span' );
		preview.className = 'os-mobile-card__preview';
		preview.setAttribute( 'aria-hidden', 'true' );
		body.append( bar, preview );
		body.addEventListener( 'click', () => deps.onPick( c ) );

		const close = document.createElement( 'button' );
		close.type = 'button';
		close.className = 'os-mobile-card__close';
		close.setAttribute(
			'aria-label',
			sprintf(
				/* translators: %s: window title. */
				__( 'Close %s' ),
				c.title,
			),
		);
		close.appendChild( osIcon( 'close', { size: 16 } ) );
		close.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			dismissCard( wrap, c, 1 );
		} );

		wrap.append( body, close );
		bindSwipe( wrap, c );
		return wrap;
	};

	/** Slide the card out, then tell the layer. */
	const dismissCard = ( wrap: HTMLElement, c: SwitcherCard, direction: 1 | -1 ): void => {
		wrap.classList.add( 'os-mobile-card--out' );
		wrap.style.setProperty( '--os-mobile-card-dir', String( direction ) );
		let done = false;
		const finish = (): void => {
			if ( done ) {
				return;
			}
			done = true;
			deps.onClose( c );
		};
		wrap.addEventListener( 'transitionend', finish, { once: true } );
		setTimeout( finish, 240 );
	};

	const bindSwipe = ( wrap: HTMLElement, c: SwitcherCard ): void => {
		let pointerId: number | null = null;
		let startX = 0;
		let startY = 0;
		let lastX = 0;
		let lastT = 0;
		let velocity = 0;
		let intent = false;

		const settle = (): void => {
			wrap.classList.remove( 'os-mobile-card--dragging' );
			wrap.style.transform = '';
			wrap.style.opacity = '';
			pointerId = null;
			intent = false;
			swiping = false;
			if ( pendingCards ) {
				const next = pendingCards;
				pendingCards = null;
				paint( next );
			}
		};

		wrap.addEventListener( 'pointerdown', ( e ) => {
			if ( ! e.isPrimary || pointerId !== null ) {
				return;
			}
			pointerId = e.pointerId;
			startX = lastX = e.clientX;
			startY = e.clientY;
			lastT = e.timeStamp;
			velocity = 0;
			intent = false;
		} );
		wrap.addEventListener( 'pointermove', ( e ) => {
			if ( e.pointerId !== pointerId ) {
				return;
			}
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if ( ! intent ) {
				if ( Math.abs( dx ) < SWIPE_INTENT_PX ) {
					return;
				}
				if ( Math.abs( dy ) > Math.abs( dx ) ) {
					// A vertical scroll: let it be.
					pointerId = null;
					return;
				}
				intent = true;
				swiping = true;
				wrap.classList.add( 'os-mobile-card--dragging' );
				try {
					wrap.setPointerCapture( e.pointerId );
				} catch {
					// jsdom.
				}
			}
			const dt = Math.max( 1, e.timeStamp - lastT );
			velocity = ( e.clientX - lastX ) / dt;
			lastX = e.clientX;
			lastT = e.timeStamp;
			wrap.style.transform = `translateX(${ dx }px)`;
			wrap.style.opacity = String( Math.max( 0.35, 1 - Math.abs( dx ) / Math.max( 1, wrap.offsetWidth ) ) );
		} );
		const release = ( e: PointerEvent ): void => {
			if ( e.pointerId !== pointerId ) {
				return;
			}
			if ( ! intent ) {
				pointerId = null;
				return;
			}
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			const outcome = swipeOutcome( { dx, dy, velocity, width: wrap.offsetWidth } );
			// Swallow the click the release would fire on the body.
			const swallow = ( ev: Event ): void => {
				ev.stopPropagation();
				ev.preventDefault();
			};
			wrap.addEventListener( 'click', swallow, { capture: true, once: true } );
			setTimeout( () => wrap.removeEventListener( 'click', swallow, { capture: true } ), 300 );
			if ( outcome === 'commit' ) {
				wrap.classList.remove( 'os-mobile-card--dragging' );
				pointerId = null;
				intent = false;
				swiping = false;
				dismissCard( wrap, c, dx < 0 ? -1 : 1 );
				return;
			}
			settle();
		};
		wrap.addEventListener( 'pointerup', release );
		wrap.addEventListener( 'pointercancel', ( e ) => {
			if ( e.pointerId === pointerId ) {
				settle();
			}
		} );
	};

	/**
	 * One deck. The DOM order stays most-recent-first (what a screen
	 * reader hears, where focus lands); the stylesheet lays the pile
	 * out bottom-up, which reverses the paint order, so the z-order is
	 * set here to put the first card in front.
	 */
	const deck = ( cards: readonly SwitcherCard[] ): HTMLElement => {
		const section = document.createElement( 'section' );
		section.className = 'os-mobile-deck';
		const pile = document.createElement( 'div' );
		pile.className = 'os-mobile-deck__cards';
		cards.forEach( ( c, i ) => {
			const wrap = card( c );
			wrap.style.zIndex = String( cards.length - i );
			pile.appendChild( wrap );
		} );
		section.appendChild( pile );
		return section;
	};

	const paint = ( cards: readonly SwitcherCard[] ): void => {
		list.replaceChildren();
		if ( cards.length === 0 ) {
			const empty = document.createElement( 'p' );
			empty.className = 'os-mobile-switcher__empty';
			empty.textContent = __( 'Nothing open. Pick something from Home.' );
			list.appendChild( empty );
			footer.hidden = true;
			return;
		}
		list.appendChild( deck( cards ) );
		footer.hidden = false;
	};

	return {
		el,
		isOpen: () => open,
		open( cards ) {
			if ( open ) {
				this.update( cards );
				return;
			}
			open = true;
			const active = el.ownerDocument.activeElement;
			restoreFocus = active instanceof HTMLElement ? active : null;
			paint( cards );
			el.hidden = false;
			document.addEventListener( 'keydown', onKey );
			// Focus lands on the first card, or the × when there is none.
			const first = list.querySelector< HTMLElement >( '.os-mobile-card__body' );
			( first ?? closeButton ).focus();
		},
		update( cards ) {
			if ( ! open ) {
				return;
			}
			if ( swiping ) {
				pendingCards = cards;
				return;
			}
			paint( cards );
		},
		close() {
			if ( ! open ) {
				return;
			}
			open = false;
			swiping = false;
			pendingCards = null;
			el.hidden = true;
			document.removeEventListener( 'keydown', onKey );
			const target = restoreFocus;
			restoreFocus = null;
			if ( target && target.isConnected ) {
				target.focus();
			}
		},
	};
}
