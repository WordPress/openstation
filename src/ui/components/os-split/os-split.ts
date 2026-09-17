/** Two bounded panes with optional pointer/keyboard resizing and a narrow layout. */
import { __ } from '../../../i18n';
import { Component, defineComponent, html } from '../../core';
import { styles } from './os-split.styles';

export class OsSplit extends Component {
	static props = [ 'position', 'min-start', 'min-end', 'resizable', 'direction', 'collapse-at', 'narrow', 'compact', 'label' ] as const;
	static styles = [ styles ];
	static help = {
		title: 'Split pane',
		summary: 'List/detail or editor/preview panes. Optional accessible resizing; narrow windows stack or show the pane chosen by the app.',
		status: 'stable',
		props: [
			{ name: 'position', type: 'number (%)', default: '35', description: 'Start pane share of usable space, excluding the divider.' },
			{ name: 'min-start', type: 'number (px)', default: '160', description: 'Start pane minimum. Minima scale proportionally if they cannot both fit.' },
			{ name: 'min-end', type: 'number (px)', default: '160', description: 'End pane minimum.' },
			{ name: 'resizable', type: 'boolean', description: 'Enable the draggable, keyboard-focusable separator.' },
			{ name: 'direction', type: 'horizontal | vertical', default: 'horizontal' },
			{ name: 'collapse-at', type: 'number (px)', default: '600', description: 'Horizontal layouts become narrow at this width. Zero disables automatic collapse.' },
			{ name: 'narrow', type: 'stack | start | end', default: 'stack', description: 'App chooses the visible panes in narrow mode.' },
			{ name: 'compact', type: 'boolean', description: 'Force narrow mode, for example in a phone app.' },
			{ name: 'label', type: 'string', description: 'Accessible separator name. Supply a translated name when resizable.' },
		],
		slots: [ { name: 'start', description: 'First pane (inline-start, or top).' }, { name: 'end', description: 'Second pane.' } ],
		parts: [ { name: 'start' }, { name: 'end' }, { name: 'divider' } ],
		events: [ { name: 'os-split-change', detail: '{ position: number }', description: 'Committed pointer or keyboard resize; percentage of usable space. No event for attribute changes.' } ],
		example: html`<os-split resizable label="Resize preview" collapse-at="400" style="height: 240px">
			<os-panel slot="start">Editor</os-panel><os-panel slot="end">Preview</os-panel>
		</os-split>`,
	} as const;

	private observer: ResizeObserver | null = null;
	private width = 0;
	private height = 0;
	private drag: { id: number; origin: number; last: number; position: number; initial: number; target: HTMLElement } | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		if ( typeof ResizeObserver !== 'undefined' ) {
			this.observer = new ResizeObserver( ( entries ) => {
				const { width, height } = entries[ 0 ].contentRect;
				if ( width === this.width && height === this.height ) {
					return;
				}
				const position = this.positionValue();
				this.width = width;
				this.height = height;
				if ( this.isCompact() ) {
					this.cancelDrag();
				} else if ( this.drag ) {
					// Continue from the last pointer position when the container
					// reflows; an observer notification is not a user cancellation.
					this.setPosition( position );
					this.drag.origin = this.drag.last;
					this.drag.position = this.positionValue();
				}
				this.requestUpdate();
			} );
			this.observer.observe( this );
		}
	}

	disconnectedCallback(): void {
		this.observer?.disconnect();
		this.observer = null;
		this.cancelDrag();
	}

	attributeChangedCallback( name: string, oldValue: string | null, newValue: string | null ): void {
		if ( oldValue !== newValue && name === 'direction' ) {
			this.cancelDrag();
		}
		super.attributeChangedCallback( name, oldValue, newValue );
	}

	private number( name: string, fallback: number ): number {
		const raw = this.getAttribute( name );
		const value = raw === null || raw.trim() === '' ? NaN : Number( raw );
		return Number.isFinite( value ) && value >= 0 ? value : fallback;
	}

	private isVertical(): boolean {
		return this.getAttribute( 'direction' ) === 'vertical';
	}

	private isCompact(): boolean {
		const threshold = this.number( 'collapse-at', 600 );
		return this.hasAttribute( 'compact' ) || ( ! this.isVertical() && threshold > 0 && this.width > 0 && this.width <= threshold );
	}

	private extent(): number {
		return Math.max( 0, ( this.isVertical() ? this.height : this.width ) - ( this.hasAttribute( 'resizable' ) ? 8 : 0 ) );
	}

	private bounds(): [ number, number ] {
		const size = this.extent();
		if ( size <= 0 ) {
			return [ 0, 100 ];
		}
		const start = this.number( 'min-start', 160 );
		const end = this.number( 'min-end', 160 );
		const total = start + end;
		const scale = total > size ? size / total : 1;
		return [ start * scale / size * 100, 100 - end * scale / size * 100 ];
	}

	private positionValue(): number {
		const [ min, max ] = this.bounds();
		return Math.min( max, Math.max( min, this.number( 'position', 35 ) ) );
	}

	private enabled(): boolean {
		return this.hasAttribute( 'resizable' ) && ! this.isCompact();
	}

	private setPosition( value: number ): void {
		const [ min, max ] = this.bounds();
		this.setAttribute( 'position', String( Math.min( max, Math.max( min, value ) ) ) );
	}

	private coordinate( e: PointerEvent ): number {
		return this.isVertical() ? e.clientY : e.clientX;
	}

	private sign(): number {
		return ! this.isVertical() && getComputedStyle( this ).direction === 'rtl' ? -1 : 1;
	}

	private onDown = ( e: PointerEvent ): void => {
		if ( ! this.enabled() || e.button !== 0 || this.drag || this.extent() <= 0 ) {
			return;
		}
		e.preventDefault();
		const target = e.currentTarget as HTMLElement;
		target.focus();
		this.drag = { id: e.pointerId, origin: this.coordinate( e ), last: this.coordinate( e ), position: this.positionValue(), initial: this.positionValue(), target };
		target.setPointerCapture( e.pointerId );
		this.requestUpdate();
	};

	private onMove = ( e: PointerEvent ): void => {
		if ( this.drag?.id !== e.pointerId ) {
			return;
		}
		this.drag.last = this.coordinate( e );
		this.setPosition( this.drag.position + ( this.coordinate( e ) - this.drag.origin ) * this.sign() / Math.max( 1, this.extent() ) * 100 );
	};

	private finishDrag( commit: boolean ): void {
		const drag = this.drag;
		if ( ! drag ) {
			return;
		}
		this.drag = null;
		if ( ! commit ) {
			this.setPosition( drag.initial );
		}
		if ( drag.target.hasPointerCapture( drag.id ) ) {
			drag.target.releasePointerCapture( drag.id );
		}
		this.requestUpdate();
		if ( commit && this.positionValue() !== drag.initial ) {
			this.emit( 'os-split-change', { position: this.positionValue() } );
		}
	}

	private cancelDrag = (): void => this.finishDrag( false );

	private onCancel = ( e: PointerEvent ): void => {
		if ( this.drag?.id === e.pointerId ) {
			this.cancelDrag();
		}
	};

	private onLostCapture = ( e: PointerEvent ): void => {
		if ( this.drag?.id === e.pointerId ) {
			// Release can lose capture without delivering pointerup here.
			// Keep the last visible size; only an explicit cancellation
			// rolls back. A preceding pointercancel already cleared drag.
			this.finishDrag( true );
		}
	};

	private onUp = ( e: PointerEvent ): void => {
		if ( this.drag?.id === e.pointerId ) {
			this.onMove( e );
			this.finishDrag( true );
		}
	};

	private onKey = ( e: KeyboardEvent ): void => {
		if ( ! this.enabled() ) {
			return;
		}
		if ( e.key === 'Escape' && this.drag ) {
			e.preventDefault();
			this.cancelDrag();
			return;
		}
		const [ min, max ] = this.bounds();
		const before = this.positionValue();
		const step = e.shiftKey ? 10 : 2;
		const forward = this.isVertical() ? 'ArrowDown' : 'ArrowRight';
		const backward = this.isVertical() ? 'ArrowUp' : 'ArrowLeft';
		let next = before;
		if ( e.key === 'Home' ) {
			next = min;
		} else if ( e.key === 'End' ) {
			next = max;
		} else if ( e.key === forward || e.key === backward ) {
			next += step * this.sign() * ( e.key === forward ? 1 : -1 );
		} else {
			return;
		}
		e.preventDefault();
		this.setPosition( next );
		if ( before !== this.positionValue() ) {
			this.emit( 'os-split-change', { position: this.positionValue() } );
		}
	};

	/** Keep focus reachable when a narrow layout hides the focused pane or divider. */
	private recoverFocus( mode: string ): void {
		const hiddenSlot = mode === 'end' ? 'start' : 'end';
		const root = this.getRootNode() as Document | ShadowRoot;
		const focused = root.activeElement;
		const hiddenFocus = mode !== 'stack' && Array.from( this.children ).some(
			( child ) => child.slot === hiddenSlot && child.contains( focused ),
		);
		const dividerFocus = this.shadowRoot?.activeElement?.classList.contains( 'divider' );
		if ( ! hiddenFocus && ! dividerFocus ) {
			return;
		}
		queueMicrotask( () => {
			if ( this.isConnected ) {
				this.shadowRoot?.querySelector< HTMLElement >( mode === 'end' ? '.pane.end' : '.pane.start' )?.focus();
			}
		} );
	}

	protected render() {
		if ( ! this.enabled() && this.drag ) {
			this.cancelDrag();
		}
		const enabled = this.enabled();
		const position = this.positionValue();
		const [ min, max ] = this.bounds();
		const narrow = this.getAttribute( 'narrow' );
		const mode = narrow === 'start' || narrow === 'end' ? narrow : 'stack';
		this.style.setProperty( '--_split-start', `calc((100% - ${ this.hasAttribute( 'resizable' ) ? 8 : 0 }px) * ${ position / 100 })` );
		if ( this.isCompact() ) {
			this.recoverFocus( mode );
		}
		return html`<div class="layout ${ this.isCompact() ? 'compact ' + mode : '' }">
			<div class="pane start" part="start" id="start" tabindex="-1"><slot name="start"></slot></div>
			<div class="divider ${ enabled ? 'enabled' : '' } ${ this.drag ? 'dragging' : '' }" part="divider"
				role=${ enabled ? 'separator' : 'presentation' } aria-hidden=${ enabled ? 'false' : 'true' } tabindex=${ enabled ? '0' : '-1' }
				aria-label=${ this.getAttribute( 'label' ) || __( 'Resize panes' ) }
				aria-controls="start" aria-orientation=${ this.isVertical() ? 'horizontal' : 'vertical' }
				aria-valuemin=${ String( min ) } aria-valuemax=${ String( max ) } aria-valuenow=${ String( position ) }
				@pointerdown=${ this.onDown } @pointermove=${ this.onMove } @pointerup=${ this.onUp }
				@pointercancel=${ this.onCancel } @lostpointercapture=${ this.onLostCapture } @keydown=${ this.onKey }></div>
			<div class="pane end" part="end" tabindex="-1"><slot name="end"></slot></div>
		</div><div class="shield" ?hidden=${ ! this.drag } aria-hidden="true"></div>`;
	}
}
defineComponent( 'os-split', OsSplit );
