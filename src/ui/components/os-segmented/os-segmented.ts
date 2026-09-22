/**
 * `<os-segmented>` + `<os-segment>` — iOS-style segmented radio
 * group. Visually a pill-shaped bar of equal-width buttons; only
 * one is "on" at a time. Used in OS Settings for Dock size.
 *
 * The parent `<os-segmented>` owns the `value` prop. Whenever it
 * changes (via property, attribute, or a child segment clicked),
 * every `<os-segment>` child reflects selection state via
 * `aria-checked`. Clicking a segment emits `os-pick` with
 * `{ value }` on the group.
 */

import { Component, defineComponent, html } from '../../core';
import { segmentStyles, segmentedStyles } from './os-segmented.styles';

export class OsSegment extends Component {
	static props = [ 'value' ] as const;
	static styles = [ segmentStyles ];

	static help = {
		title: 'Segment',
		summary:
			'Single pill inside a <os-segmented> group. Value identifies it for selection; aria-checked and the roving tabindex are mirrored by the parent, which is the one tab stop for the whole group.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Identifier this segment contributes to the parent group selection.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Visible segment label.' },
		],
		events: [
			{
				name: 'os-segment-pick',
				description: 'Internal event bubbled to the parent <os-segmented>. Consumers should listen for os-pick on the group instead.',
				detail: '{ value: string }',
			},
		],
		/*
		 * A segment on its own is a transparent button with no pill
		 * around it and no thumb under it — the lit surface belongs to
		 * the GROUP, which owns one and slides it. So the example is
		 * the group.
		 */
		example: html`
			<os-segmented value="md" label="Dock size">
				<os-segment value="sm">Small</os-segment>
				<os-segment value="md">Medium</os-segment>
				<os-segment value="lg">Large</os-segment>
			</os-segmented>
		`,
	} as const;

	protected render() {
		this.setAttribute( 'role', 'radio' );
		/*
		 * `tabindex="-1"` because the GROUP is the tab stop and the
		 * host is what it roves. A shadow `<button>` is focusable by
		 * default, so without this the group would have two focusables
		 * per segment: the host carrying `role="radio"` + `aria-checked`
		 * and a bare button carrying neither, which is the pair a
		 * screen reader announces as a plain unlabelled button.
		 */
		return html`
			<button
				type="button"
				tabindex="-1"
				class="os-holo-sheen"
				@click=${ () => this._onPick() }
			>
				<slot></slot>
			</button>
		`;
	}

	private _onPick(): void {
		this.emit( 'os-segment-pick', {
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'os-segment', OsSegment );

export class OsSegmented extends Component {
	static props = [ 'value', 'label' ] as const;
	static styles = [ segmentedStyles ];

	static help = {
		title: 'Segmented',
		summary:
			'iOS-style segmented radio group. Pill-shaped bar of equal-width <os-segment> children where exactly one is active. One tab stop: arrow keys move the selection, Home and End jump the ends.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Currently selected segment value. Mirrored onto child aria-checked.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'aria-label for the radiogroup.',
			},
		],
		slots: [
			{ name: '(default)', description: '<os-segment value="…"> children.' },
		],
		events: [
			{
				name: 'os-pick',
				description: 'Fires when the selected segment changes.',
				detail: '{ value: string }',
			},
		],
		cssProps: [
			{ name: '--os-window-bg', description: 'Pill background.' },
			{ name: '--os-ui-fg', description: 'Active label colour.' },
			{ name: '--os-ui-fg-muted', description: 'Inactive label colour.' },
		],
		example: html`
			<os-segmented value="md" label="Dock size">
				<os-segment value="sm">Small</os-segment>
				<os-segment value="md">Medium</os-segment>
				<os-segment value="lg">Large</os-segment>
			</os-segmented>
		`,
	} as const;

	/** Re-measures the thumb when the group is resized by its container. */
	private _resizeObserver: ResizeObserver | null = null;

	/** Re-stamps the roving tabindex when segments arrive or leave. */
	private _segmentObserver: MutationObserver | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		// Delegated pick handler — children bubble
		// `os-segment-pick` up to us, we update our own `value`
		// (which cascades back into re-rendering child aria-
		// checked), then re-emit as `os-pick` for the user.
		this.addEventListener( 'os-segment-pick', ( e: Event ) => {
			const detail = ( e as CustomEvent ).detail as { value: string };
			e.stopPropagation();
			( this as unknown as { value: string } ).value = detail.value;
			this.emit( 'os-pick', { value: detail.value } );
		} );
		// The segments are content-sized, so the pill has to be
		// re-measured whenever the group's box changes — a window
		// resize, a panel column reflowing, a font finally arriving.
		// Guarded because jsdom has no ResizeObserver.
		if ( typeof ResizeObserver !== 'undefined' ) {
			this._resizeObserver = new ResizeObserver( () => this._placeThumb() );
			this._resizeObserver.observe( this );
		}
		this.addEventListener( 'keydown', this._onKeyDown );
		/*
		 * Segments that arrive after the last render, the same contract
		 * `<os-tabs>` keeps. The roving `tabindex` makes this load-
		 * bearing rather than cosmetic: an unstamped segment has no
		 * `tabindex` at all, and once its shadow button stopped being
		 * focusable that leaves it with no keyboard path in. A group
		 * whose segments are re-rendered around it (a server view
		 * repainting a status control) would otherwise go quietly
		 * unreachable.
		 */
		this._segmentObserver = new MutationObserver( () => this.requestUpdate() );
		this._segmentObserver.observe( this, { childList: true } );
	}

	disconnectedCallback(): void {
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;
		this._segmentObserver?.disconnect();
		this._segmentObserver = null;
		this.removeEventListener( 'keydown', this._onKeyDown );
	}

	/**
	 * Arrow-key roving, which a radiogroup owes the keyboard.
	 *
	 * The group is ONE tab stop (`tabindex="0"` on the checked segment,
	 * `-1` on the rest), so without this the other segments cannot be
	 * reached at all. A radiogroup takes both axes: Left/Right because
	 * the control is drawn as a horizontal bar, Up/Down because that is
	 * what the role conventionally answers and what a screen reader's
	 * own radio navigation sends. Both wrap, and Home/End jump the ends.
	 *
	 * Selection follows focus, which is what a radiogroup does and what
	 * the pointer already does here: there is no separate commit step,
	 * and arriving on a segment without picking it would leave the thumb
	 * behind the focus ring saying two different things.
	 */
	private _onKeyDown = ( e: KeyboardEvent ): void => {
		if (
			e.key !== 'ArrowRight' &&
			e.key !== 'ArrowDown' &&
			e.key !== 'ArrowLeft' &&
			e.key !== 'ArrowUp' &&
			e.key !== 'Home' &&
			e.key !== 'End'
		) {
			return;
		}
		const segs = Array.from(
			this.querySelectorAll< HTMLElement >( ':scope > os-segment' ),
		);
		if ( segs.length === 0 ) {
			return;
		}
		const current = ( this as unknown as { value: string | null } ).value;
		const at = segs.findIndex(
			( seg ) => seg.getAttribute( 'value' ) === current,
		);
		let target = 0;
		if ( e.key === 'End' ) {
			target = segs.length - 1;
		} else if ( e.key !== 'Home' ) {
			const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
			// `at` is -1 when `value` names no segment; stepping from
			// there lands on the first segment either way.
			target = ( at + step + segs.length ) % segs.length;
		}
		const value = segs[ target ]?.getAttribute( 'value' );
		if ( ! value ) {
			return;
		}
		// Claimed even when the value is unchanged (Home on the first
		// segment): the group owns these keys either way, and letting
		// Arrow through would scroll the pane behind it.
		e.preventDefault();
		if ( value === current ) {
			return;
		}
		( this as unknown as { value: string } ).value = value;
		this.emit( 'os-pick', { value } );
		// After the microtask that moves the roving tabindex, or focus
		// lands on an element the browser has just made unfocusable.
		queueMicrotask( () => {
			segs[ target ]?.focus();
		} );
	};

	/**
	 * Put the thumb under the selected segment.
	 *
	 * Measured with `getBoundingClientRect()` rather than `offsetLeft`:
	 * the segments are light-DOM children whose `offsetParent` is this
	 * host, and `offsetLeft` is quoted from the offset parent's BORDER
	 * box while an absolutely-positioned element in the shadow root is
	 * placed against its PADDING box. With a border on the group those
	 * two differ, and the pill would sit a border-width off — visible
	 * on exactly the themes that add one.
	 *
	 * `offsetWidth` is the not-laid-out test rather than a zero-width
	 * rect (display:none, a collapsed panel, a tab that has never been
	 * opened). It is transform-immune, so a group measured under a
	 * near-zero scale is not mistaken for one of those and hidden for
	 * good — a transform change does not wake the ResizeObserver.
	 */
	private _placeThumb(): void {
		const thumb = this.shadowRoot?.querySelector(
			'.os-segmented__thumb',
		) as HTMLElement | null;
		if ( ! thumb ) {
			return;
		}
		const current = ( this as unknown as { value: string | null } ).value;
		const selected = Array.from(
			this.querySelectorAll( ':scope > os-segment' ),
		).find( ( el ) => el.getAttribute( 'value' ) === current );
		if ( ! selected || this.offsetWidth === 0 ) {
			this.removeAttribute( 'data-thumb' );
			return;
		}
		const host = this.getBoundingClientRect();
		// Rects come back through every ancestor transform, and a group
		// is routinely measured inside one: a window plays
		// `os-window--opening` (scale 0.92 to 1) while the panel renders.
		// `offsetWidth` is the untransformed border box, so their ratio
		// maps the reading back into the group's own coordinates, which
		// is the space the thumb is positioned in. A transform never
		// resizes the border box, so the ResizeObserver would not fix
		// this up when the animation lands.
		const raw = host.width / this.offsetWidth;
		// offsetWidth is integer-rounded and the group is content-sized,
		// so its laid-out width is nearly always fractional and the ratio
		// lands a hair off 1 with no transform in play at all. Treat that
		// band as 1: 0.02 sits above the rounding error for any realistic
		// group width and well below the animation's 0.08.
		const scale = Math.abs( raw - 1 ) < 0.02 ? 1 : raw;
		if ( ! ( scale > 0 ) ) {
			// A fully collapsed ancestor. There is nothing to divide by,
			// and no event will bring us back, so keep the last good
			// placement rather than hide a thumb that would never return.
			return;
		}
		const box = selected.getBoundingClientRect();
		// Two decimals keeps the pill on the sub-pixel edge the browser
		// laid the segment on, without the float noise the division
		// leaves behind (65.00000000000001px).
		const px = ( v: number ) => `${ Math.round( v * 100 ) / 100 }px`;
		this.style.setProperty( '--_thumb-x', px( ( box.left - host.left ) / scale ) );
		this.style.setProperty( '--_thumb-w', px( box.width / scale ) );
		this.setAttribute( 'data-thumb', '' );
		// One frame later than the first placement, so the pill does
		// not animate in from the origin on page load. See the note on
		// the two flags in the stylesheet.
		if ( ! this.hasAttribute( 'data-thumb-ready' ) ) {
			requestAnimationFrame( () =>
				this.setAttribute( 'data-thumb-ready', '' ),
			);
		}
	}

	/**
	 * Declarative item-list setter. Replaces the existing
	 * `<os-segment>` children with a fresh set built from a
	 * `{ value, label }` array; preserves the current selection
	 * when the value still matches an entry, otherwise falls back
	 * to the first item.
	 *
	 * Collapses the imperative dance (clear children,
	 * `createElement`, set `textContent`, `appendChild`, then
	 * `setAttribute('value', …)` on the group — order matters) to
	 * a single assignment:
	 *
	 * ```js
	 * segmented.items = [
	 *   { value: 'm',  label: 'm' },
	 *   { value: 'km', label: 'km' },
	 * ];
	 * ```
	 */
	set items( list: ReadonlyArray<{ value: string; label: string }> ) {
		const existing = this.querySelectorAll( ':scope > os-segment' );
		for ( const el of Array.from( existing ) ) {
			el.remove();
		}
		for ( const item of list ) {
			const seg = document.createElement( 'os-segment' );
			seg.setAttribute( 'value', item.value );
			seg.textContent = item.label;
			this.appendChild( seg );
		}
		const current =
			( this as unknown as { value: string | null } ).value;
		const stillValid =
			current !== null && list.some( ( i ) => i.value === current );
		if ( ! stillValid && list.length > 0 ) {
			( this as unknown as { value: string } ).value = list[ 0 ].value;
		} else {
			this.requestUpdate();
		}
	}

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		if ( label ) {
			this.setAttribute( 'aria-label', label );
		}
		this.setAttribute( 'role', 'radiogroup' );
		// Mirror the current `value` onto each child segment via
		// aria-checked. Children live in LIGHT DOM (caller places
		// them inside the tag), so we reach them via a simple
		// querySelectorAll. Deferred one microtask so the children
		// have upgraded before we read them.
		const current = ( this as unknown as { value: string | null } ).value;
		queueMicrotask( () => {
			const segs = Array.from( this.querySelectorAll( 'os-segment' ) );
			// A group whose `value` names no segment would stamp -1 on
			// every one and drop out of the tab order entirely, so the
			// first segment holds the stop until a selection exists.
			const roving = segs.some(
				( seg ) => seg.getAttribute( 'value' ) === current,
			)
				? current
				: segs[ 0 ]?.getAttribute( 'value' ) ?? null;
			for ( const seg of segs ) {
				const v = seg.getAttribute( 'value' );
				seg.setAttribute(
					'aria-checked',
					v === current ? 'true' : 'false',
				);
				seg.setAttribute( 'tabindex', v === roving ? '0' : '-1' );
			}
			this._placeThumb();
		} );
		// The thumb before the slot, so it paints under the labels
		// without either side needing a z-index.
		return html`<span class="os-segmented__thumb" aria-hidden="true"></span
			><slot></slot>`;
	}
}
defineComponent( 'os-segmented', OsSegmented );
