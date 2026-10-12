/**
 * `<os-coachmark>` — an anchored callout with a step counter.
 *
 * Points at an element and says one thing about it: "1 of 3 · Open a
 * window". The card's tail points at the element; a quiet ring can trace
 * it as well (`highlight`). The shell tour is the first consumer; the
 * shape is generic (any stepped, in-place explanation of a live UI),
 * which is why it is a kit component rather than tour-private DOM.
 *
 * What it deliberately is NOT: a modal. There is no scrim and the
 * overlay passes every pointer through, because the point of a
 * coachmark is that the user does the thing it describes — drags the
 * window, clicks the tile — while it is up. Only the card itself takes
 * pointer and keyboard events.
 *
 * Instruction, not a hero moment: the card is neutral, the counter is
 * muted text and the primary button is the card's own ink inverted, so
 * nothing in it competes with the accent the UI around it uses to say
 * "this is the one you are on".
 *
 * The card and the outline live in ONE top-layer popover
 * (`popover="manual"`, the way `<os-action-menu>` escapes clipping),
 * so windows, the dock and anything with a z-index cannot cover them.
 *
 * ```html
 * <os-coachmark open heading="Open a window" step="1" total="3"
 *               primary-label="Do it for me" secondary-label="Skip">
 *   Click a dock tile. Every admin screen opens as a window.
 * </os-coachmark>
 * <script>
 *   coachmark.anchor = document.querySelector( '.os-dock__item' );
 * </script>
 * ```
 */

import { Component, defineComponent, html, type TemplateResult } from '../../core';
import '../os-button/os-button';
import { styles } from './os-coachmark.styles';

/**
 * Where the card sits relative to the anchor. `auto` (the default)
 * takes the side with the most room; a named side is honoured when
 * the card fits there and flipped to its opposite when it does not.
 * Every placement is then clamped inside the viewport.
 */
export type OsCoachmarkPlacement = 'auto' | 'top' | 'bottom' | 'start' | 'end';

type Side = 'top' | 'bottom' | 'start' | 'end';

/** The card edge the tail sits on, in physical terms. */
type TailEdge = 'top' | 'bottom' | 'left' | 'right';

/** Which way the anchor is from the card, as the peek content reads it. */
const LOOK: Record< TailEdge, [ number, number ] > = {
	top: [ 0, -1 ],
	bottom: [ 0, 1 ],
	left: [ -1, 0 ],
	right: [ 1, 0 ],
};

/** Distance between the outline and the card. */
const GAP = 12;
/** Room between an anchor and the top of a peek figure on a card below it. */
const PEEK_CLEARANCE = 4;
/** Kept between the card and the viewport edge. */
const MARGIN = 12;
/** How far the outline sits outside the anchor's own box. */
const OUTLINE_INSET = 4;
/** Clearance on each side of a speaker, inside the gap left for it. */
const SPEAKER_PAD = 16;
/** The tail never sits closer than this to a card corner. */
const TAIL_EDGE = 28;

/**
 * How long the card takes to fade out once `open` is removed. The
 * popover stays in the top layer until then, so a host that removes
 * the element should wait at least this long or it cuts the fade.
 */
export const COACHMARK_EXIT_MS = 180;
/** How long a step change animates the card and the outline. */
const STEP_MS = 360;

/** Tracking key for an anchor that is set but has no box to point at. */
const ANCHOR_GONE = 'gone';

const SIDES: readonly Side[] = [ 'bottom', 'top', 'end', 'start' ];

function opposite( side: Side ): Side {
	switch ( side ) {
		case 'top':
			return 'bottom';
		case 'bottom':
			return 'top';
		case 'start':
			return 'end';
		default:
			return 'start';
	}
}

/**
 * Is there a box on screen for the card to point at?
 *
 * Connected is not enough. An anchor inside a `hidden` ancestor (a
 * closed panel, a tab pane that is not showing) is still in the
 * document, and the browser reports its rect as zeros: a real-looking
 * box at the top-left corner, which is where the card and its ring
 * then went. `checkVisibility()` is false for exactly that case, an
 * element with no box of its own. Where the engine lacks it the anchor
 * is taken at its word.
 */
function hasBox( el: Element ): boolean {
	if ( ! el.isConnected ) {
		return false;
	}
	const check = ( el as { checkVisibility?: () => boolean } ).checkVisibility;
	return typeof check !== 'function' || check.call( el );
}

export class OsCoachmark extends Component {
	static props = [
		'open',
		'placement',
		'step',
		'total',
		'counter-label',
		'heading',
		'primary-label',
		'secondary-label',
		'speaker-size',
		'highlight',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Coachmark',
		status: 'stable',
		summary:
			'Anchored callout with a step counter. Floats a small card beside the element it points at, its tail aimed at it, in the browser top layer, so windows and the dock cannot cover it; a quiet ring traces the element too unless `highlight` is `none`. No scrim: the desk stays fully usable while it is up, which is the point — the user does the thing the card describes. Focus moves into the card on open and returns on close; Tab cycles the card, Escape dismisses.',
		props: [
			{
				name: 'open',
				type: 'boolean attribute',
				description: 'Shows the coachmark. Remove it to hide; focus returns to where it was.',
			},
			{
				name: 'anchor',
				type: 'Element | null (property)',
				description:
					'The element the card points at. Set it from script — an element reference, never an id. `null` centres the card in the viewport with no tail and no ring. The card, its tail and the ring follow the anchor while the coachmark is open, so a dragged window keeps its highlight. An anchor that leaves the document or stops being rendered (a closed panel, a hidden tab pane) is treated as `null` until it is back.',
			},
			{
				name: 'placement',
				type: "'auto' | 'top' | 'bottom' | 'start' | 'end'",
				default: 'auto',
				description:
					'Which side of the anchor the card sits on. `auto` picks the side with the most room; a named side flips to its opposite when the card would overflow. Always clamped inside the viewport.',
			},
			{ name: 'step', type: 'number', description: 'Current step, rendered with `total` as "1 of 3".' },
			{ name: 'total', type: 'number', description: 'Step count. Omit both to hide the counter.' },
			{
				name: 'counter-label',
				type: 'string',
				description:
					'The counter text, already translated ("1 de 3"). Replaces the built-in English "1 of 3"; still shown only when `step` and `total` are set.',
			},
			{ name: 'heading', type: 'string', description: 'The card heading. Pass a translated string.' },
			{ name: 'primary-label', type: 'string', default: 'Next', description: 'Label of the primary button.' },
			{
				name: 'secondary-label',
				type: 'string',
				default: 'Skip',
				description: 'Label of the secondary button. An empty string hides it.',
			},
			{
				name: 'highlight',
				type: "'ring' | 'none'",
				default: 'ring',
				description:
					'How the anchor is marked besides the tail. `ring` traces it with a thin neutral outline (`--os-ui-coachmark-ring`); `none` leaves the anchor exactly as its own UI draws it, for a target that already shows its state, or one whose own colours are the point.',
			},
			{
				name: 'speaker-size',
				type: 'number (px)',
				description:
					'Turns the card into a speech balloon for someone standing beside it: a character, an avatar. The speaker goes across from the anchor, never between the two (left or right of a card above or below its anchor, above or below one beside it), on whichever of the two sides has more room. The tail then points at them instead of at the anchor, and the card reports where they should stand through `os-coachmark-speaker`. For a character that belongs on the card itself, use the `peek` slot instead.',
			},
		],
		slots: [
			{ name: '(default)', description: 'The card body — a sentence or two; `<os-key>` for a chord.' },
			{
				name: 'peek',
				description:
					'A small figure peeking over the card\'s top edge, near its end corner: a mascot, an avatar. Only the top `--os-ui-coachmark-peek-reveal` (23px) shows; it pops up once per step and sits still, and under reduced motion it is simply there. While the card points at something, the coachmark sets `--os-coachmark-look-x` and `--os-coachmark-look-y` on itself (-1, 0 or 1, towards the anchor) so the figure can look at it. Decorative: mark it `aria-hidden`.',
			},
		],
		events: [
			{ name: 'os-coachmark-primary', detail: '{ step }', description: 'The primary button was activated.' },
			{ name: 'os-coachmark-secondary', detail: '{ step }', description: 'The secondary button was activated.' },
			{
				name: 'os-coachmark-dismiss',
				detail: '{ step }',
				description: 'Escape was pressed with focus in the card. The host decides what that means; the coachmark does not close itself.',
			},
			{
				name: 'os-coachmark-speaker',
				detail: '{ x, y }',
				description:
					'Where the speaker should stand, in viewport coordinates, whenever that changes. Only with `speaker-size` set. The card does not move the speaker itself: it has no idea what one is.',
			},
		],
		example: html`
			<os-cluster gap="8">
				<os-button data-demo="target" variant="secondary">The thing to explain</os-button>
				<os-button data-demo="show">Show coachmark</os-button>
			</os-cluster>
			<os-coachmark
				heading="This is a coachmark"
				step="1"
				total="1"
				primary-label="Got it"
				secondary-label=""
			>
				It outlines an element and floats beside it. Got it closes it.
			</os-coachmark>
		`,
		exampleInit: ( root: HTMLElement ) => {
			const mark = root.querySelector< OsCoachmark >( 'os-coachmark' );
			const show = root.querySelector< HTMLElement >( '[data-demo="show"]' );
			if ( ! mark || ! show ) {
				return;
			}
			const target = root.querySelector< HTMLElement >( '[data-demo="target"]' );
			// Assignment, not addEventListener: the Components tab
			// re-runs this on every filter keystroke. The card's
			// buttons live in the shadow root, so the demo closes on
			// any composed click that passed through one of them
			// rather than on the custom event (which has no on*
			// property to assign).
			show.onclick = () => {
				mark.anchor = target;
				mark.setAttribute( 'open', '' );
			};
			mark.onclick = ( e: MouseEvent ) => {
				const viaButton = e
					.composedPath()
					.some( ( n ) => n instanceof HTMLElement && n.tagName === 'OS-BUTTON' );
				if ( viaButton ) {
					mark.removeAttribute( 'open' );
				}
			};
		},
	} as const;

	private _anchor: Element | null = null;
	/** Element that had focus when the coachmark opened. */
	private _returnFocus: HTMLElement | null = null;
	private _shown = false;
	private _raf = 0;
	private _lastKey = '';
	private _listeners: AbortController | null = null;
	/** Fading out: still in the top layer, no longer tracking or focused. */
	private _leaving = false;
	private _exitTimer = 0;
	private _stepTimer = 0;
	/** Last speaker point reported, so an unchanged one is not re-sent. */
	private _speakerKey = '';
	/** Last gaze direction written, so an unchanged one is not re-set. */
	private _lookKey = '';

	/** The element the card points at and outlines. */
	get anchor(): Element | null {
		return this._anchor;
	}
	set anchor( el: Element | null ) {
		this._anchor = el ?? null;
		this._lastKey = '';
		if ( this._shown ) {
			// Setting the anchor is how a host moves on to the next step,
			// so this is the one place the move animates. Tracking an
			// anchor that moves by itself does not come through here.
			this._beginStep();
			this._position();
		}
	}

	/** The current step as a number, for event detail. */
	get stepNumber(): number {
		return Number( this.getAttribute( 'step' ) ?? 0 ) || 0;
	}

	private get layer(): HTMLElement | null {
		return this.shadowRoot?.querySelector( '.layer' ) ?? null;
	}
	private get card(): HTMLElement | null {
		return this.shadowRoot?.querySelector( '.card' ) ?? null;
	}
	private get outline(): HTMLElement | null {
		return this.shadowRoot?.querySelector( '.outline' ) ?? null;
	}

	disconnectedCallback(): void {
		this._teardown();
		this._finishExit();
		window.clearTimeout( this._stepTimer );
	}

	protected render(): TemplateResult {
		const open = this.hasAttribute( 'open' );
		const step = this.getAttribute( 'step' );
		const total = this.getAttribute( 'total' );
		// A raw "%1 of %2" is a translation problem the caller owns:
		// labels arrive translated, and so does the counter, through
		// `counter-label`. The component's default is the English
		// pattern every other kit default uses.
		const meta =
			step && total ? this.getAttribute( 'counter-label' ) || `${ step } of ${ total }` : '';
		const primary = this.getAttribute( 'primary-label' ) ?? 'Next';
		const secondary = this.getAttribute( 'secondary-label' ) ?? 'Skip';
		return html`<div class="layer" popover="manual" ?hidden=${ ! open && ! this._leaving }>
			<div class="outline" hidden aria-hidden="true"></div>
			<div
				class="card"
				role="dialog"
				aria-labelledby="os-coachmark-heading"
				tabindex="-1"
				@keydown=${ this._onKeyDown }
			>
				<span class="tail" hidden aria-hidden="true"></span>
				<span class="peek" aria-hidden="true"><slot name="peek"></slot></span>
				<p class="meta">${ meta }</p>
				<h2 id="os-coachmark-heading">${ this.getAttribute( 'heading' ) ?? '' }</h2>
				<div class="body"><slot></slot></div>
				<div class="actions">
					<os-button
						variant="ghost"
						class="secondary"
						?hidden=${ secondary === '' }
						@click=${ () => this.emit( 'os-coachmark-secondary', { step: this.stepNumber } ) }
						>${ secondary }</os-button
					>
					<os-button
						variant="primary"
						class="primary"
						@click=${ () => this.emit( 'os-coachmark-primary', { step: this.stepNumber } ) }
						>${ primary }</os-button
					>
				</div>
			</div>
		</div>`;
	}

	protected requestUpdate(): void {
		super.requestUpdate();
		// The base class paints on a microtask; two more land after
		// the paint, which is when the popover and the geometry can be
		// synced against real nodes.
		queueMicrotask( () => queueMicrotask( () => this._afterRender() ) );
	}

	private _afterRender(): void {
		if ( ! this.isConnected ) {
			return;
		}
		const open = this.hasAttribute( 'open' );
		if ( open && ! this._shown ) {
			this._show();
		} else if ( ! open && this._shown ) {
			this._hide();
		} else if ( open ) {
			// Content or labels changed while open: the card may have
			// grown, so re-measure.
			this._lastKey = '';
			this._position();
		}
	}

	private _show(): void {
		const layer = this.layer;
		if ( ! layer ) {
			return;
		}
		// Reopened mid fade-out: the popover never left the top layer, so
		// cancel the exit rather than showing it a second time.
		this._finishExit( false );
		this.card?.classList.remove( 'swap' );
		this._shown = true;
		const active = this.ownerDocument.activeElement;
		this._returnFocus =
			active instanceof HTMLElement && active !== this.ownerDocument.body ? active : null;
		try {
			layer.showPopover?.();
		} catch {
			// Already shown, or no popover support: the fixed layer
			// still paints, just without the top-layer guarantee.
		}
		this._listeners = new AbortController();
		const { signal } = this._listeners;
		const reposition = (): void => {
			this._lastKey = '';
			this._position();
		};
		window.addEventListener( 'resize', reposition, { signal } );
		document.addEventListener( 'os-work-area-changed', reposition, { signal } );
		this._position();
		this._track();
		this._focusPrimary();
	}

	private _hide(): void {
		this._teardown();
		// Focus goes back now, not after the fade: a keyboard user should
		// not wait on an animation to be somewhere again.
		const back = this._returnFocus;
		this._returnFocus = null;
		if ( back && back.isConnected ) {
			back.focus?.( { preventScroll: true } );
		}
		const layer = this.layer;
		if ( ! layer ) {
			return;
		}
		// Stay in the top layer long enough to fade out, instead of
		// vanishing the moment the host says so.
		this._leaving = true;
		layer.classList.add( 'leaving' );
		this.requestUpdate();
		this._exitTimer = window.setTimeout( () => this._finishExit(), COACHMARK_EXIT_MS );
	}

	/**
	 * End a fade-out. `leave` false cancels it instead: the coachmark
	 * was reopened before the fade finished, so it stays in the top
	 * layer.
	 */
	private _finishExit( leave = true ): void {
		if ( ! this._leaving ) {
			return;
		}
		window.clearTimeout( this._exitTimer );
		this._exitTimer = 0;
		this._leaving = false;
		const layer = this.layer;
		layer?.classList.remove( 'leaving' );
		if ( leave && layer ) {
			try {
				layer.hidePopover?.();
			} catch {
				// Not open — nothing to hide.
			}
		}
		this.requestUpdate();
	}

	/**
	 * Animate the next re-position and restart the content swap. Only a
	 * step change comes through here, so a card tracking an anchor that
	 * moves on its own (a window being dragged) still follows it frame
	 * for frame instead of trailing behind.
	 */
	private _beginStep(): void {
		const layer = this.layer;
		const card = this.card;
		if ( ! layer || ! card ) {
			return;
		}
		layer.classList.add( 'stepping' );
		card.classList.remove( 'swap' );
		// Restart the animation: a class removed and re-added in one
		// frame is otherwise a no-op.
		void card.offsetWidth;
		card.classList.add( 'swap' );
		window.clearTimeout( this._stepTimer );
		// Only the geometry transition is switched off again. `swap`
		// stays on the card until the next step: taking it off would
		// hand the card back its enter animation, and a changed
		// animation name restarts, replaying the fade-in after every
		// step.
		this._stepTimer = window.setTimeout( () => {
			layer.classList.remove( 'stepping' );
		}, STEP_MS );
	}

	/** Stop tracking and drop listeners; shared by hide and disconnect. */
	private _teardown(): void {
		this._shown = false;
		if ( this._raf ) {
			cancelAnimationFrame( this._raf );
			this._raf = 0;
		}
		this._listeners?.abort();
		this._listeners = null;
	}

	/**
	 * Follow the anchor while open. A window being dragged, a dock
	 * tile magnifying under the pointer: neither fires an event the
	 * coachmark could subscribe to, so it reads the rect once a frame
	 * and only touches the DOM when something moved. An anchor going
	 * away (removed, or hidden with its panel) is a move too: the card
	 * re-centres and the ring comes off, rather than staying behind on
	 * the spot where the anchor used to be.
	 */
	private _track(): void {
		if ( typeof requestAnimationFrame !== 'function' ) {
			return;
		}
		const tick = (): void => {
			if ( ! this._shown ) {
				this._raf = 0;
				return;
			}
			if ( this._anchor ) {
				let key = ANCHOR_GONE;
				if ( hasBox( this._anchor ) ) {
					const r = this._anchor.getBoundingClientRect();
					key = `${ r.left },${ r.top },${ r.width },${ r.height }`;
				}
				if ( key !== this._lastKey ) {
					this._position();
				}
			}
			this._raf = requestAnimationFrame( tick );
		};
		this._raf = requestAnimationFrame( tick );
	}

	/** Place the outline on the anchor and the card beside it. */
	private _position(): void {
		const card = this.card;
		const outline = this.outline;
		if ( ! card || ! outline ) {
			return;
		}
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const cr = card.getBoundingClientRect();
		const anchor = this._anchor && hasBox( this._anchor ) ? this._anchor : null;
		const speaker = Math.max( 0, Number( this.getAttribute( 'speaker-size' ) ) || 0 );
		// The card keeps its usual distance from the anchor whether or
		// not someone is speaking it: the speaker stands BESIDE the card,
		// never between it and the thing it points at, where they hid
		// the very control the card was about and pushed the card away
		// from its ring.
		const gap = GAP;

		if ( ! anchor ) {
			outline.hidden = true;
			const left = Math.max( MARGIN, ( vw - cr.width ) / 2 );
			const top = Math.max( MARGIN, ( vh - cr.height ) / 2 );
			card.style.left = `${ left }px`;
			card.style.top = `${ top }px`;
			// An anchor that is set but has nowhere to be right now is
			// remembered as such, so tracking re-positions once when it
			// goes and once when it comes back, not every frame between.
			this._lastKey = this._anchor ? ANCHOR_GONE : '';
			if ( speaker > 0 ) {
				this._placeSpeaker( 'top', left, top, cr, speaker );
			} else {
				const tail = card.querySelector< HTMLElement >( '.tail' );
				if ( tail ) {
					tail.hidden = true;
				}
				this._look( null );
			}
			return;
		}

		const ar = anchor.getBoundingClientRect();
		this._lastKey = `${ ar.left },${ ar.top },${ ar.width },${ ar.height }`;
		outline.hidden = this.getAttribute( 'highlight' ) === 'none';
		outline.style.left = `${ ar.left - OUTLINE_INSET }px`;
		outline.style.top = `${ ar.top - OUTLINE_INSET }px`;
		outline.style.width = `${ ar.width + OUTLINE_INSET * 2 }px`;
		outline.style.height = `${ ar.height + OUTLINE_INSET * 2 }px`;

		// A peek figure rises above the card's top edge, so a card under
		// its anchor keeps that much more room: the figure sits in the
		// gap beside the tail, never over the thing the card points at.
		const peekSlot = this.shadowRoot?.querySelector< HTMLSlotElement >( 'slot[name="peek"]' );
		const peekReveal =
			peekSlot && peekSlot.assignedElements().length > 0
				? ( this.shadowRoot?.querySelector< HTMLElement >( '.peek' )?.offsetHeight ?? 0 )
				: 0;
		const below = Math.max( gap, peekReveal + PEEK_CLEARANCE );
		const rtl = getComputedStyle( this.ownerDocument.documentElement ).direction === 'rtl';
		const room: Record< Side, number > = {
			top: ar.top,
			bottom: vh - ar.bottom,
			start: rtl ? vw - ar.right : ar.left,
			end: rtl ? ar.left : vw - ar.right,
		};
		const need = ( side: Side ): number => {
			if ( side === 'bottom' ) {
				return cr.height + below + MARGIN;
			}
			return ( side === 'top' ? cr.height : cr.width ) + gap + MARGIN;
		};
		const fits = ( side: Side ): boolean => room[ side ] >= need( side );

		const requested = this.getAttribute( 'placement' ) ?? 'auto';
		const named = SIDES.find( ( s ) => s === requested );
		let side: Side;
		if ( ! named ) {
			side = SIDES.reduce( ( best, s ) => ( room[ s ] > room[ best ] ? s : best ), SIDES[ 0 ] );
			// Prefer the vertical sides when they fit: a card under a
			// tile reads better than one beside it.
			if ( fits( 'bottom' ) ) {
				side = 'bottom';
			} else if ( fits( 'top' ) ) {
				side = 'top';
			}
		} else {
			side = fits( named ) || ! fits( opposite( named ) ) ? named : opposite( named );
		}

		let left: number;
		let top: number;
		const centerX = ar.left + ar.width / 2 - cr.width / 2;
		const centerY = ar.top + ar.height / 2 - cr.height / 2;
		const physical = ( s: Side ): 'left' | 'right' =>
			( s === 'start' ) !== rtl ? 'left' : 'right';
		switch ( side ) {
			case 'top':
				left = centerX;
				top = ar.top - OUTLINE_INSET - gap - cr.height;
				break;
			case 'bottom':
				left = centerX;
				top = ar.bottom + OUTLINE_INSET + below;
				break;
			default:
				top = centerY;
				left =
					physical( side ) === 'left'
						? ar.left - OUTLINE_INSET - gap - cr.width
						: ar.right + OUTLINE_INSET + gap;
		}
		left = Math.min( Math.max( MARGIN, left ), Math.max( MARGIN, vw - cr.width - MARGIN ) );
		top = Math.min( Math.max( MARGIN, top ), Math.max( MARGIN, vh - cr.height - MARGIN ) );
		card.style.left = `${ left }px`;
		card.style.top = `${ top }px`;

		if ( speaker > 0 ) {
			this._placeSpeaker( side, left, top, cr, speaker );
		} else {
			this._pointTail( side, left, top, cr, ar, rtl );
		}
	}

	/**
	 * Aim the tail at the anchor: on the card edge facing it, level with
	 * its centre, kept off the rounded corners. A card clamped against
	 * the viewport edge still points at the right place, because the
	 * position along the edge comes from the anchor, not the card.
	 *
	 * Also tells the peek content which way to look.
	 */
	private _pointTail(
		side: Side,
		left: number,
		top: number,
		cr: DOMRect,
		ar: DOMRect,
		rtl: boolean,
	): void {
		const tail = this.card?.querySelector< HTMLElement >( '.tail' );
		if ( ! tail ) {
			return;
		}
		let edge: TailEdge;
		if ( side === 'top' ) {
			edge = 'bottom';
		} else if ( side === 'bottom' ) {
			edge = 'top';
		} else {
			// The card is on the anchor's start or end side; the tail is on
			// the card edge that faces back towards it.
			edge = ( side === 'start' ) !== rtl ? 'right' : 'left';
		}
		const vertical = edge === 'top' || edge === 'bottom';
		const length = vertical ? cr.width : cr.height;
		const at = vertical ? ar.left + ar.width / 2 - left : ar.top + ar.height / 2 - top;
		tail.hidden = false;
		tail.dataset.edge = edge;
		tail.style.setProperty(
			'--_tail-at',
			`${ Math.min( Math.max( at, TAIL_EDGE ), Math.max( TAIL_EDGE, length - TAIL_EDGE ) ) }px`,
		);
		this._look( edge );
	}

	/** Point the peek content's gaze, or let it look ahead. */
	private _look( edge: TailEdge | null ): void {
		// No speaker on this card, so the next one is told where to stand.
		this._speakerKey = '';
		// Written only when the direction changes: this runs once per
		// frame while the anchor moves, and an inline property write
		// invalidates style on the host and its slotted figure each time.
		const key = edge ?? '';
		if ( key === this._lookKey ) {
			return;
		}
		this._lookKey = key;
		const [ x, y ] = edge ? LOOK[ edge ] : [ 0, 0 ];
		this.style.setProperty( '--os-coachmark-look-x', String( x ) );
		this.style.setProperty( '--os-coachmark-look-y', String( y ) );
	}

	/**
	 * Stand the speaker beside the card and point the tail at them.
	 *
	 * Beside means on the axis across the one the card and its anchor
	 * share: a card above or below its anchor gets its speaker to the
	 * left or right, a card to one side of its anchor gets them above or
	 * below. That keeps the space between the card and the anchor clear,
	 * so the speaker never stands in front of what the card is pointing
	 * at, and the card stays close to its ring. Of the two sides, the
	 * one with more room wins (a card near the right edge speaks from
	 * its left); a tie goes to the right, or below. A card with no
	 * anchor counts as above-or-below.
	 */
	private _placeSpeaker(
		side: Side,
		left: number,
		top: number,
		cr: DOMRect,
		speaker: number,
	): void {
		const tail = this.card?.querySelector< HTMLElement >( '.tail' );
		if ( ! tail ) {
			return;
		}
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const reach = SPEAKER_PAD + speaker / 2;
		const clamp = ( n: number, min: number, max: number ): number =>
			Math.min( Math.max( n, min ), Math.max( min, max ) );

		let edge: TailEdge;
		let point: { x: number; y: number };
		if ( side === 'top' || side === 'bottom' ) {
			edge = vw - ( left + cr.width ) >= left ? 'right' : 'left';
			point = {
				x: edge === 'right' ? left + cr.width + reach : left - reach,
				y: clamp( top + cr.height / 2, MARGIN + speaker / 2, vh - MARGIN - speaker / 2 ),
			};
		} else {
			edge = vh - ( top + cr.height ) >= top ? 'bottom' : 'top';
			point = {
				x: clamp( left + cr.width / 2, MARGIN + speaker / 2, vw - MARGIN - speaker / 2 ),
				y: edge === 'bottom' ? top + cr.height + reach : top - reach,
			};
		}

		// The tail sits on the edge facing the speaker, level with them,
		// kept off the card's rounded corners.
		tail.hidden = false;
		tail.dataset.edge = edge;
		const vertical = edge === 'top' || edge === 'bottom';
		const length = vertical ? cr.width : cr.height;
		const along = clamp(
			vertical ? point.x - left : point.y - top,
			TAIL_EDGE,
			length - TAIL_EDGE,
		);
		tail.style.setProperty( '--_tail-at', `${ along }px` );

		const key = `${ Math.round( point.x ) },${ Math.round( point.y ) }`;
		if ( key !== this._speakerKey ) {
			this._speakerKey = key;
			this.emit( 'os-coachmark-speaker', point );
		}
	}

	/** The focusable controls inside the card, in tab order. */
	private _focusables(): HTMLElement[] {
		const card = this.card;
		if ( ! card ) {
			return [];
		}
		return Array.from( card.querySelectorAll< HTMLElement >( 'os-button' ) )
			.filter( ( b ) => ! b.hidden )
			.map( ( b ) => b.shadowRoot?.querySelector< HTMLElement >( 'button' ) ?? b );
	}

	private _focusPrimary(): void {
		const items = this._focusables();
		const target = items[ items.length - 1 ] ?? this.card;
		target?.focus?.( { preventScroll: true } );
	}

	/** Which os-button host currently owns focus, if any. */
	private _activeHost(): Element | null {
		return this.shadowRoot?.activeElement ?? null;
	}

	private _onKeyDown = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' ) {
			e.preventDefault();
			e.stopPropagation();
			this.emit( 'os-coachmark-dismiss', { step: this.stepNumber } );
			return;
		}
		if ( e.key !== 'Tab' ) {
			return;
		}
		const hosts = Array.from(
			this.card?.querySelectorAll< HTMLElement >( 'os-button' ) ?? [],
		).filter( ( b ) => ! b.hidden );
		if ( hosts.length === 0 ) {
			e.preventDefault();
			return;
		}
		const items = this._focusables();
		const index = hosts.indexOf( this._activeHost() as HTMLElement );
		if ( e.shiftKey && ( index <= 0 ) ) {
			e.preventDefault();
			items[ items.length - 1 ]?.focus( { preventScroll: true } );
		} else if ( ! e.shiftKey && ( index === -1 || index === hosts.length - 1 ) ) {
			e.preventDefault();
			items[ 0 ]?.focus( { preventScroll: true } );
		}
	};
}
defineComponent( 'os-coachmark', OsCoachmark );
