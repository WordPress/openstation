import { Component, defineComponent, html, type TemplateResult } from '../../core';
import '../os-button/os-button';
import { styles } from './os-coachmark.styles';

export type OsCoachmarkPlacement = 'auto' | 'top' | 'bottom' | 'start' | 'end';

type Side = 'top' | 'bottom' | 'start' | 'end';

type TailEdge = 'top' | 'bottom' | 'left' | 'right';

const GAP = 12;

const MARGIN = 12;

const OUTLINE_INSET = 4;

const SPEAKER_PAD = 16;

const TAIL_EDGE = 28;

export const COACHMARK_EXIT_MS = 180;

const STEP_MS = 360;

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
					'The element the card points at and outlines. Set it from script — an element reference, never an id. `null` centres the card in the viewport with no outline. The outline follows the anchor while the coachmark is open, so a dragged window keeps its highlight. An anchor that leaves the document or stops being rendered (a closed panel, a hidden tab pane) is treated as `null` until it is back.',
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
				name: 'speaker-size',
				type: 'number (px)',
				description:
					'Turns the card into a speech balloon for someone standing beside it: a character, an avatar. The speaker goes across from the anchor, never between the two (left or right of a card above or below its anchor, above or below one beside it), on whichever of the two sides has more room. The card grows a tail pointing at them and reports where they should stand through `os-coachmark-speaker`. Omit it for a plain card.',
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

	private _returnFocus: HTMLElement | null = null;
	private _shown = false;
	private _raf = 0;
	private _lastKey = '';
	private _listeners: AbortController | null = null;

	private _leaving = false;
	private _exitTimer = 0;
	private _stepTimer = 0;

	private _speakerKey = '';

	get anchor(): Element | null {
		return this._anchor;
	}
	set anchor( el: Element | null ) {
		this._anchor = el ?? null;
		this._lastKey = '';
		if ( this._shown ) {
			this._beginStep();
			this._position();
		}
	}

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
			this._lastKey = '';
			this._position();
		}
	}

	private _show(): void {
		const layer = this.layer;
		if ( ! layer ) {
			return;
		}

		this._finishExit( false );
		this.card?.classList.remove( 'swap' );
		this._shown = true;
		const active = this.ownerDocument.activeElement;
		this._returnFocus =
			active instanceof HTMLElement && active !== this.ownerDocument.body ? active : null;
		try {
			layer.showPopover?.();
		} catch {

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

		const back = this._returnFocus;
		this._returnFocus = null;
		if ( back && back.isConnected ) {
			back.focus?.( { preventScroll: true } );
		}
		const layer = this.layer;
		if ( ! layer ) {
			return;
		}

		this._leaving = true;
		layer.classList.add( 'leaving' );
		this.requestUpdate();
		this._exitTimer = window.setTimeout( () => this._finishExit(), COACHMARK_EXIT_MS );
	}

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

			}
		}
		this.requestUpdate();
	}

	private _beginStep(): void {
		const layer = this.layer;
		const card = this.card;
		if ( ! layer || ! card ) {
			return;
		}
		layer.classList.add( 'stepping' );
		card.classList.remove( 'swap' );

		void card.offsetWidth;
		card.classList.add( 'swap' );
		window.clearTimeout( this._stepTimer );

		this._stepTimer = window.setTimeout( () => {
			layer.classList.remove( 'stepping' );
		}, STEP_MS );
	}

	private _teardown(): void {
		this._shown = false;
		if ( this._raf ) {
			cancelAnimationFrame( this._raf );
			this._raf = 0;
		}
		this._listeners?.abort();
		this._listeners = null;
	}

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

		const gap = GAP;

		if ( ! anchor ) {
			outline.hidden = true;
			const left = Math.max( MARGIN, ( vw - cr.width ) / 2 );
			const top = Math.max( MARGIN, ( vh - cr.height ) / 2 );
			card.style.left = `${ left }px`;
			card.style.top = `${ top }px`;

			this._lastKey = this._anchor ? ANCHOR_GONE : '';
			this._placeSpeaker( 'top', left, top, cr, speaker );
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
			( side === 'top' || side === 'bottom' ? cr.height : cr.width ) + gap + MARGIN;
		const fits = ( side: Side ): boolean => room[ side ] >= need( side );

		const requested = this.getAttribute( 'placement' ) ?? 'auto';
		const named = SIDES.find( ( s ) => s === requested );
		let side: Side;
		if ( ! named ) {
			side = SIDES.reduce( ( best, s ) => ( room[ s ] > room[ best ] ? s : best ), SIDES[ 0 ] );

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
				top = ar.bottom + OUTLINE_INSET + gap;
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

		this._placeSpeaker( side, left, top, cr, speaker );
	}

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
		if ( speaker <= 0 ) {
			tail.hidden = true;
			this._speakerKey = '';
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
