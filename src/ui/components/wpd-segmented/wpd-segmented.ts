/**
 * `<wpd-segmented>` + `<wpd-segment>` — iOS-style segmented radio
 * group. Visually a pill-shaped bar of equal-width buttons; only
 * one is "on" at a time. Used in OS Settings for Dock size.
 *
 * The parent `<wpd-segmented>` owns the `value` prop. Whenever it
 * changes (via property, attribute, or a child segment clicked),
 * every `<wpd-segment>` child reflects selection state via
 * `aria-checked`. Clicking a segment emits `wpd-pick` with
 * `{ value }` on the group.
 */

import { Component, defineComponent, html } from '../../core';
import { segmentStyles, segmentedStyles } from './wpd-segmented.styles';

export class WpdSegment extends Component {
	static props = [ 'value' ] as const;
	static styles = [ segmentStyles ];

	static help = {
		title: 'Segment',
		summary:
			'Single pill inside a <wpd-segmented> group. Value identifies it for selection; aria-checked is mirrored by the parent.',
		status: 'stable',
		since: '0.9.0',
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
				name: 'wpd-segment-pick',
				description: 'Internal event bubbled to the parent <wpd-segmented>. Consumers should listen for wpd-pick on the group instead.',
				detail: '{ value: string }',
			},
		],
	} as const;

	protected render() {
		this.setAttribute( 'role', 'radio' );
		return html`
			<button type="button" @click=${ () => this._onPick() }>
				<slot></slot>
			</button>
		`;
	}

	private _onPick(): void {
		this.emit( 'wpd-segment-pick', {
			value: ( this as unknown as { value: string | null } ).value,
		} );
	}
}
defineComponent( 'wpd-segment', WpdSegment );

export class WpdSegmented extends Component {
	static props = [ 'value', 'label' ] as const;
	static styles = [ segmentedStyles ];

	static help = {
		title: 'Segmented',
		summary:
			'iOS-style segmented radio group. Pill-shaped bar of equal-width <wpd-segment> children where exactly one is active.',
		status: 'stable',
		since: '0.9.0',
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
			{ name: '(default)', description: '<wpd-segment value="…"> children.' },
		],
		events: [
			{
				name: 'wpd-pick',
				description: 'Fires when the selected segment changes.',
				detail: '{ value: string }',
			},
		],
		cssProps: [
			{ name: '--wp-desktop-window-bg', description: 'Pill background.' },
			{ name: '--wp-desktop-text', description: 'Active label colour.' },
			{ name: '--wp-desktop-muted', description: 'Inactive label colour.' },
		],
		example: html`
			<wpd-segmented value="md" label="Dock size">
				<wpd-segment value="sm">Small</wpd-segment>
				<wpd-segment value="md">Medium</wpd-segment>
				<wpd-segment value="lg">Large</wpd-segment>
			</wpd-segmented>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		// Delegated pick handler — children bubble
		// `wpd-segment-pick` up to us, we update our own `value`
		// (which cascades back into re-rendering child aria-
		// checked), then re-emit as `wpd-pick` for the user.
		this.addEventListener( 'wpd-segment-pick', ( e: Event ) => {
			const detail = ( e as CustomEvent ).detail as { value: string };
			e.stopPropagation();
			( this as unknown as { value: string } ).value = detail.value;
			this.emit( 'wpd-pick', { value: detail.value } );
		} );
	}

	/**
	 * Declarative item-list setter. Replaces the existing
	 * `<wpd-segment>` children with a fresh set built from a
	 * `{ value, label }` array; preserves the current selection
	 * when the value still matches an entry, otherwise falls back
	 * to the first item.
	 *
	 * Collapses the pre-0.11 imperative dance (clear children,
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
	 *
	 * @since 0.11.0
	 */
	set items( list: ReadonlyArray<{ value: string; label: string }> ) {
		const existing = this.querySelectorAll( ':scope > wpd-segment' );
		for ( const el of Array.from( existing ) ) {
			el.remove();
		}
		for ( const item of list ) {
			const seg = document.createElement( 'wpd-segment' );
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
			const segs = this.querySelectorAll( 'wpd-segment' );
			for ( const seg of Array.from( segs ) ) {
				const v = seg.getAttribute( 'value' );
				seg.setAttribute(
					'aria-checked',
					v === current ? 'true' : 'false',
				);
			}
		} );
		return html`<slot></slot>`;
	}
}
defineComponent( 'wpd-segmented', WpdSegmented );
