/**
 * `<os-switch>` — the on/off switch.
 *
 * A checkbox says "this item is included". A switch says "this
 * setting is on", and it says it in the present tense: flipping it
 * takes effect now, with no Save button waiting downstream. That
 * distinction is the whole reason both exist, and it is the one to
 * check before reaching for either. If the change lands on submit,
 * use `<os-checkbox>`.
 *
 * ```html
 * <os-switch checked label="Reduce motion"></os-switch>
 * <os-switch block label="Auto-hide the dock"
 *            description="The dock slides away until you point at the edge."></os-switch>
 * <os-switch size="sm" tone="danger" label="Developer mode"></os-switch>
 * ```
 *
 * ## The holographic state
 *
 * On is an identity moment, so on is the mesh: the track fills with
 * Holomesh and picks up a Pulse glow, and the fill tilts under the
 * pointer the way a foil card does. `tone="accent" | "danger" |
 * "success"` takes the mesh back off for the cases where brand is the
 * wrong thing to say — a dozen switches in one settings list, or a
 * destructive toggle that should read as danger.
 *
 * ## Gestures
 *
 * Tap toggles. Drag also works, iOS-style: press the track, move, and
 * the knob follows the pointer in real time; release past the halfway
 * mark and it snaps on. A drag that ends where it started is treated
 * as a tap, so a shaky finger never eats the interaction.
 *
 * Keyboard: Space and Enter toggle (from the native `<button>`),
 * ArrowLeft/Home force off and ArrowRight/End force on — the explicit
 * pair, so a keyboard user can set a known state without tracking the
 * current one.
 *
 * ## Events
 *
 * Emits `os-switch-change` with `{ checked, value }`. It ALSO emits
 * `os-checkbox-change` with the same detail, which makes the switch a
 * drop-in for any listener already bound to `<os-checkbox>` /
 * `<os-checkbox-label>` at a common ancestor — swapping a checkbox for
 * a switch is then a tag change and nothing else. New code should
 * listen for `os-switch-change`; the alias exists for the swap.
 *
 * Accessibility: `role="switch"` plus `aria-checked` on a real
 * `<button>`. That pairing is announced as "on"/"off" rather than
 * "pressed", `disabled` comes from the platform, and the focus ring is
 * the kit's shared `--os-ui-focus-ring`.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-switch.styles';

/**
 * Pointer travel, in px, below which a drag is treated as a tap.
 *
 * Set from the smallest deliberate drag a finger makes rather than
 * from a mouse: below this, the movement is almost always tremor
 * during a click, and treating it as a drag means a tap on an "on"
 * switch would sometimes leave it on.
 */
const TAP_SLOP = 4;

export class OsSwitch extends Component {
	static props = [
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

	/** Pointer id owning the current gesture, or null when idle. */
	private _pointerId: number | null = null;

	/** Client X where the gesture started. */
	private _startX = 0;

	/** How far the knob may travel, in px. Measured on pointerdown. */
	private _travel = 0;

	/** True once the pointer has moved past {@link TAP_SLOP}. */
	private _moved = false;

	/** 1 in LTR, -1 in RTL. Resolved per gesture. */
	private _dir = 1;

	/**
	 * Set when a drag has already decided the outcome, so the `click`
	 * the browser fires after `pointerup` does not toggle a second time
	 * and undo it. Cleared by that same click.
	 */
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

	// ------------------------------------------------------------------
	// Gestures
	// ------------------------------------------------------------------

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
		/*
		 * How far the knob can go, from the TRACK alone.
		 *
		 * The stylesheet defines travel as `w - knob - 2·pad`, and the
		 * knob as `h - 2·pad`, so the two pads cancel and the whole
		 * thing collapses to `w - h` — the track's own client box,
		 * width minus height. That identity is worth using rather than
		 * measuring the knob, because by the time this handler runs the
		 * browser may already have applied `:active`, which widens the
		 * knob to 1.28× as its press feedback. Measuring it there would
		 * shorten the travel by a quarter and the switch would flip
		 * noticeably early — intermittently, since whether `:active`
		 * lands before `pointerdown` is not something the spec pins
		 * down.
		 *
		 * Measured rather than read from the tokens all the same: a
		 * caller is free to re-point `--_h` or `--_pad` from the
		 * document tree, and the laid-out box is the only honest
		 * source for what those ended up being.
		 */
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
		// Clamp to the track. The knob starts at one end or the other
		// depending on state, so the legal range for the offset differs:
		// an "on" switch can only be dragged back toward zero.
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
			// A tap. `click` fires next and does the toggling — doing it
			// here as well would toggle twice and land back where it
			// started.
			return;
		}
		// Released past the midpoint? The knob's final resting place is
		// wherever it already is, rounded to the nearer end.
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

	// ------------------------------------------------------------------
	// Toggling
	// ------------------------------------------------------------------

	private _onClick(): void {
		// A drag that crossed the slop threshold ends in a `click` too.
		// `_onPointerUp` has already decided the outcome; toggling again
		// here would undo it. Checked before `disabled` so the flag is
		// always consumed by the click it was raised for.
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
		// The explicit pair. Space and Enter toggle relative to the
		// current state, which a screen-reader user has to be tracking;
		// these set an absolute one.
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

	/** Reflect the new state and announce it. */
	private _commit( next: boolean ): void {
		if ( next ) {
			this.setAttribute( 'checked', '' );
		} else {
			this.removeAttribute( 'checked' );
		}
		const detail = { checked: next, value: this._attr( 'value' ) };
		this.emit( 'os-switch-change', detail );
		// The compatibility alias — see the class docblock. Same detail,
		// same tick, so a listener bound to either name sees one change.
		this.emit( 'os-checkbox-change', detail );
	}

	/** Typed read of a declared prop. */
	private _attr( name: string ): string | null {
		return ( this as unknown as Record< string, string | null > )[ name ] ?? null;
	}
}

defineComponent( 'os-switch', OsSwitch );
