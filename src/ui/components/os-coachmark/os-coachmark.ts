/**
 * `<os-coachmark>` — an anchored callout with a step counter.
 *
 * Points at an element, outlines it, and says one thing about it:
 * "1 of 3 · Open a window". The shell tour is the first consumer; the
 * shape is generic (any stepped, in-place explanation of a live UI),
 * which is why it is a kit component rather than tour-private DOM.
 *
 * What it deliberately is NOT: a modal. There is no scrim and the
 * overlay passes every pointer through, because the point of a
 * coachmark is that the user does the thing it describes — drags the
 * window, clicks the tile — while it is up. Only the card itself takes
 * pointer and keyboard events.
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

/** Distance between the outline and the card. */
const GAP = 12;
/** Kept between the card and the viewport edge. */
const MARGIN = 12;
/** How far the outline sits outside the anchor's own box. */
const OUTLINE_INSET = 4;

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

export class OsCoachmark extends Component {
	static props = [
		'open',
		'placement',
		'step',
		'total',
		'heading',
		'primary-label',
		'secondary-label',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Coachmark',
		status: 'stable',
		summary:
			'Anchored callout with a step counter. Outlines the element it points at and floats a small card beside it in the browser top layer, so windows and the dock cannot cover it. No scrim: the desk stays fully usable while it is up, which is the point — the user does the thing the card describes. Focus moves into the card on open and returns on close; Tab cycles the card, Escape dismisses.',
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
					'The element the card points at and outlines. Set it from script — an element reference, never an id. `null` centres the card in the viewport with no outline. The outline follows the anchor while the coachmark is open, so a dragged window keeps its highlight.',
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
			{ name: 'heading', type: 'string', description: 'The card heading. Pass a translated string.' },
			{ name: 'primary-label', type: 'string', default: 'Next', description: 'Label of the primary button.' },
			{
				name: 'secondary-label',
				type: 'string',
				default: 'Skip',
				description: 'Label of the secondary button. An empty string hides it.',
			},
		],
		slots: [ { name: '(default)', description: 'The card body — a sentence or two; `<os-key>` for a chord.' } ],
		events: [
			{ name: 'os-coachmark-primary', detail: '{ step }', description: 'The primary button was activated.' },
			{ name: 'os-coachmark-secondary', detail: '{ step }', description: 'The secondary button was activated.' },
			{
				name: 'os-coachmark-dismiss',
				detail: '{ step }',
				description: 'Escape was pressed with focus in the card. The host decides what that means; the coachmark does not close itself.',
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

	/** The element the card points at and outlines. */
	get anchor(): Element | null {
		return this._anchor;
	}
	set anchor( el: Element | null ) {
		this._anchor = el ?? null;
		this._lastKey = '';
		if ( this._shown ) {
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
	}

	protected render(): TemplateResult {
		const open = this.hasAttribute( 'open' );
		const step = this.getAttribute( 'step' );
		const total = this.getAttribute( 'total' );
		// A raw "%1 of %2" is a translation problem the caller owns:
		// labels arrive translated, and so does the counter when the
		// caller renders it. The component's default is the English
		// pattern every other kit default uses.
		const meta = step && total ? `${ step } of ${ total }` : '';
		const primary = this.getAttribute( 'primary-label' ) ?? 'Next';
		const secondary = this.getAttribute( 'secondary-label' ) ?? 'Skip';
		return html`<div class="layer" popover="manual" ?hidden=${ ! open }>
			<div class="outline" hidden aria-hidden="true"></div>
			<div
				class="card"
				role="dialog"
				aria-labelledby="os-coachmark-heading"
				tabindex="-1"
				@keydown=${ this._onKeyDown }
			>
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
		const layer = this.layer;
		if ( layer ) {
			try {
				layer.hidePopover?.();
			} catch {
				// Not open — nothing to hide.
			}
		}
		const back = this._returnFocus;
		this._returnFocus = null;
		if ( back && back.isConnected ) {
			back.focus?.( { preventScroll: true } );
		}
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
	 * and only touches the DOM when something moved.
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
			if ( this._anchor && this._anchor.isConnected ) {
				const r = this._anchor.getBoundingClientRect();
				const key = `${ r.left },${ r.top },${ r.width },${ r.height }`;
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
		const anchor = this._anchor && this._anchor.isConnected ? this._anchor : null;

		if ( ! anchor ) {
			outline.hidden = true;
			card.style.left = `${ Math.max( MARGIN, ( vw - cr.width ) / 2 ) }px`;
			card.style.top = `${ Math.max( MARGIN, ( vh - cr.height ) / 2 ) }px`;
			this._lastKey = '';
			return;
		}

		const ar = anchor.getBoundingClientRect();
		this._lastKey = `${ ar.left },${ ar.top },${ ar.width },${ ar.height }`;
		outline.hidden = false;
		outline.style.left = `${ ar.left - OUTLINE_INSET }px`;
		outline.style.top = `${ ar.top - OUTLINE_INSET }px`;
		outline.style.width = `${ ar.width + OUTLINE_INSET * 2 }px`;
		outline.style.height = `${ ar.height + OUTLINE_INSET * 2 }px`;

		const rtl = getComputedStyle( this.ownerDocument.documentElement ).direction === 'rtl';
		const room: Record< Side, number > = {
			top: ar.top,
			bottom: vh - ar.bottom,
			start: rtl ? vw - ar.right : ar.left,
			end: rtl ? ar.left : vw - ar.right,
		};
		const need = ( side: Side ): number =>
			( side === 'top' || side === 'bottom' ? cr.height : cr.width ) + GAP + MARGIN;
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
				top = ar.top - OUTLINE_INSET - GAP - cr.height;
				break;
			case 'bottom':
				left = centerX;
				top = ar.bottom + OUTLINE_INSET + GAP;
				break;
			default:
				top = centerY;
				left =
					physical( side ) === 'left'
						? ar.left - OUTLINE_INSET - GAP - cr.width
						: ar.right + OUTLINE_INSET + GAP;
		}
		left = Math.min( Math.max( MARGIN, left ), Math.max( MARGIN, vw - cr.width - MARGIN ) );
		top = Math.min( Math.max( MARGIN, top ), Math.max( MARGIN, vh - cr.height - MARGIN ) );
		card.style.left = `${ left }px`;
		card.style.top = `${ top }px`;
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
