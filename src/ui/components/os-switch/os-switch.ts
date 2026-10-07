import { Component, defineComponent, html } from '../../core';
import { styles } from './os-switch.styles';

const TAP_SLOP = 4;

export class OsSwitch extends Component {
	static props = [
		'name',
		'checked',
		'value',
		'label',
		'description',
		'disabled',
		'size',
		'tone',
		'block',
		'labelPosition',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Switch',
		summary:
			'On/off switch for settings that take effect immediately. On is the holographic moment — the track fills with Holomesh and glows. Supports tap, drag and keyboard, and emits os-checkbox-change alongside its own event so it drops straight into checkbox listeners.',
		status: 'stable',
		props: [
			{ name: 'name', type: 'string', description: 'Key used by an enclosing os-form to collect, populate and reset this field.' },
			{
				name: 'checked',
				type: 'boolean attribute',
				description: 'Reflects + controls the on state; updated on user toggle.',
			},
			{
				name: 'value',
				type: 'string',
				description:
					'Identifier returned in the event detail — useful when several switches share a listener.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'Text rendered beside the switch.',
			},
			{
				name: 'description',
				type: 'string',
				description:
					'Optional second line under the label, for the sentence that explains what off means.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Disables the control.',
			},
			{
				name: 'size',
				type: "'sm' | 'md' | 'lg'",
				default: "'md'",
				description: 'Track height; every other measurement derives from it.',
			},
			{
				name: 'tone',
				type: "'holo' | 'accent' | 'danger' | 'success'",
				default: "'holo'",
				description:
					'What the on state paints. The default is the Holomesh fill; the others are flat colours for when brand is the wrong thing to say.',
			},
			{
				name: 'block',
				type: 'boolean attribute',
				description:
					'Full-width settings row — label hard left, switch hard right.',
			},
			{
				name: 'label-position',
				type: "'end' | 'start'",
				default: "'end'",
				description: 'Which side of the switch the label sits on.',
			},
		],
		events: [
			{
				name: 'os-switch-change',
				description: 'Fires when the user toggles the switch.',
				detail: '{ checked: boolean, value: string | null }',
			},
			{
				name: 'os-checkbox-change',
				description:
					'Same detail, same moment — the compatibility alias that lets a switch drop into an existing checkbox listener.',
				detail: '{ checked: boolean, value: string | null }',
			},
		],
		cssProps: [
			{ name: '--os-ui-holo-fill', description: 'The on-state mesh.' },
			{ name: '--os-ui-holo-track', description: 'The off-state track.' },
			{ name: '--os-ui-holo-glow', description: 'The bloom around an on switch.' },
			{ name: '--os-ui-switch-knob', description: 'Knob colour.' },
		],
		example: html`
			<os-stack gap="10">
				<os-switch checked label="Reduce motion"></os-switch>
				<os-switch label="Auto-hide the dock"></os-switch>
				<os-switch size="sm" checked tone="accent" label="Small, flat accent"></os-switch>
				<os-switch size="lg" checked label="Large"></os-switch>
				<os-switch checked disabled label="Locked on"></os-switch>
			</os-stack>
		`,
	} as const;

	private _pointerId: number | null = null;

	private _startX = 0;

	private _travel = 0;

	private _moved = false;

	private _dir = 1;

	private _swallowClick = false;

	protected render() {
		const checked = this._attr( 'checked' ) !== null;
		const disabled = this._attr( 'disabled' ) !== null;
		const label = this._attr( 'label' ) || '';
		const description = this._attr( 'description' ) || '';
		return html`
			<div class="os-switch__row">
				<span class="os-switch__text">
					<span class="os-switch__label">${ label }</span>
					<span class="os-switch__description" id="os-switch-desc"
						>${ description }</span
					>
				</span>
				<button
					type="button"
					role="switch"
					aria-checked=${ checked ? 'true' : 'false' }
					aria-label=${ label || 'Toggle' }
					aria-describedby=${ description ? 'os-switch-desc' : '' }
					?disabled=${ disabled }
					@click=${ () => this._onClick() }
					@keydown=${ ( e: KeyboardEvent ) => this._onKeyDown( e ) }
					@pointerdown=${ ( e: PointerEvent ) => this._onPointerDown( e ) }
					@pointermove=${ ( e: PointerEvent ) => this._onPointerMove( e ) }
					@pointerup=${ ( e: PointerEvent ) => this._onPointerUp( e ) }
					@pointercancel=${ () => this._endGesture() }
				>
					<span class="os-switch__knob"></span>
				</button>
			</div>
		`;
	}

	private _onPointerDown( e: PointerEvent ): void {
		if ( this._attr( 'disabled' ) !== null ) {
			return;
		}
		const track = e.currentTarget as HTMLElement;
		this._pointerId = e.pointerId;
		this._startX = e.clientX;
		this._moved = false;
		this._dir = getComputedStyle( this ).direction === 'rtl' ? -1 : 1;
		this.style.setProperty( '--_dir', String( this._dir ) );

		this._travel = Math.max( 0, track.clientWidth - track.clientHeight );
		track.setPointerCapture( e.pointerId );
	}

	private _onPointerMove( e: PointerEvent ): void {
		if ( this._pointerId !== e.pointerId || this._travel === 0 ) {
			return;
		}
		const delta = ( e.clientX - this._startX ) * this._dir;
		if ( ! this._moved && Math.abs( delta ) >= TAP_SLOP ) {
			this._moved = true;
			this.setAttribute( 'data-dragging', '' );
		}
		if ( ! this._moved ) {
			return;
		}

		const on = this._attr( 'checked' ) !== null;
		const min = on ? -this._travel : 0;
		const max = on ? 0 : this._travel;
		this.style.setProperty(
			'--_drag',
			`${ Math.min( max, Math.max( min, delta ) ) }px`,
		);
	}

	private _onPointerUp( e: PointerEvent ): void {
		if ( this._pointerId !== e.pointerId ) {
			return;
		}
		const wasDrag = this._moved;
		const delta = ( e.clientX - this._startX ) * this._dir;
		this._swallowClick = wasDrag;
		this._endGesture();
		if ( ! wasDrag ) {
			return;
		}

		const on = this._attr( 'checked' ) !== null;
		const position = ( on ? this._travel : 0 ) + delta;
		const next = position > this._travel / 2;
		if ( next !== on ) {
			this._commit( next );
		}
	}

	private _endGesture(): void {
		this._pointerId = null;
		this._moved = false;
		this.removeAttribute( 'data-dragging' );
		this.style.removeProperty( '--_drag' );
	}

	private _onClick(): void {
		if ( this._swallowClick ) {
			this._swallowClick = false;
			return;
		}
		if ( this._attr( 'disabled' ) !== null ) {
			return;
		}
		this._commit( this._attr( 'checked' ) === null );
	}

	private _onKeyDown( e: KeyboardEvent ): void {
		if ( this._attr( 'disabled' ) !== null ) {
			return;
		}

		if ( e.key === 'ArrowRight' || e.key === 'End' ) {
			e.preventDefault();
			if ( this._attr( 'checked' ) === null ) {
				this._commit( true );
			}
		} else if ( e.key === 'ArrowLeft' || e.key === 'Home' ) {
			e.preventDefault();
			if ( this._attr( 'checked' ) !== null ) {
				this._commit( false );
			}
		}
	}

	private _commit( next: boolean ): void {
		if ( next ) {
			this.setAttribute( 'checked', '' );
		} else {
			this.removeAttribute( 'checked' );
		}
		const detail = { checked: next, value: this._attr( 'value' ) };
		this.emit( 'os-switch-change', detail );

		this.emit( 'os-checkbox-change', detail );
	}

	private _attr( name: string ): string | null {
		return ( this as unknown as Record< string, string | null > )[ name ] ?? null;
	}
}

defineComponent( 'os-switch', OsSwitch );
