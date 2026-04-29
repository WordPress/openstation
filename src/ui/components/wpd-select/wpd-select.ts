/**
 * `<wpd-select>` + `<wpd-option>` — dropdown picker.
 *
 * Mirrors the `<wpd-segmented>` contract — set `value`, listen for
 * `wpd-pick` — so callers can swap the tag name when a list grows
 * past the handful of items a pill bar can host comfortably
 * (currencies, timezones, long enumerations).
 *
 * ```html
 * <wpd-select value="eur" label="Currency">
 *     <wpd-option value="eur">Euro</wpd-option>
 *     <wpd-option value="usd">US Dollar</wpd-option>
 *     <wpd-option value="jpy">Japanese Yen</wpd-option>
 * </wpd-select>
 * ```
 *
 * Under the hood the chrome wraps a native `<select>`. The browser
 * owns keyboard navigation, type-ahead, focus management, and the
 * open/close popover — on mobile that's the OS's native picker
 * sheet, on desktop the usual dropdown. We only style the closed
 * state so the visual language matches `<wpd-segmented>` while the
 * interactive behaviour stays OS-correct.
 *
 * @since 0.11.0
 */

import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
import { optionStyles, selectStyles } from './wpd-select.styles';

/**
 * Opaque data carrier. The parent `<wpd-select>` reads its `value`
 * attribute + `textContent` to populate the native `<select>`.
 * Rendered `display: none` so the raw light markup doesn't flash
 * before the parent upgrades.
 */
export class WpdOption extends Component {
	static props = [ 'value', 'disabled' ] as const;
	static styles = [ optionStyles ];

	static help = {
		title: 'Option',
		summary:
			'Opaque data carrier for <wpd-select>. Carries its identifier in `value` and its visible label in textContent. Not rendered directly — the parent reads these and builds a native <select>.',
		status: 'stable',
		since: '0.11.0',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Option identifier read by the parent <wpd-select>.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Renders the option disabled in the parent <select>.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Label text read from textContent.' },
		],
	} as const;

	protected render() {
		// Intentionally empty — the option is a data carrier. Its
		// label lives in its light-DOM textContent, which the parent
		// reads directly.
		return html``;
	}
}
defineComponent( 'wpd-option', WpdOption );

export class WpdSelect extends Component {
	static props = [
		'value',
		'label',
		'placeholder',
		'disabled',
		'name',
	] as const;
	static styles = [ selectStyles ];

	static help = {
		title: 'Select',
		summary:
			'Dropdown picker that wraps a native <select>. Mirrors the <wpd-segmented> contract (set value, listen for wpd-pick) so callers can swap tag names when a list outgrows a pill bar.',
		status: 'stable',
		since: '0.11.0',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Currently selected option value.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'Visible label rendered above the select and forwarded to the native control as aria-label.',
			},
			{
				name: 'placeholder',
				type: 'string',
				description: 'Disabled leading option shown when no value is set.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Disables the native select and dims the chrome.',
			},
			{
				name: 'name',
				type: 'string',
				description: 'Forwarded to the native <select name=…> for form submission.',
			},
		],
		slots: [
			{ name: '(default)', description: '<wpd-option value="…"> children.' },
		],
		events: [
			{
				name: 'wpd-pick',
				description: 'Fires when the user picks a new option.',
				detail: '{ value: string }',
			},
		],
		cssProps: [
			{ name: '--wp-desktop-text', description: 'Label + value colour.' },
			{ name: '--wp-desktop-muted', description: 'Placeholder + chevron colour.' },
		],
		example: html`
			<wpd-select value="eur" label="Currency">
				<wpd-option value="eur">Euro</wpd-option>
				<wpd-option value="usd">US Dollar</wpd-option>
				<wpd-option value="jpy">Japanese Yen</wpd-option>
			</wpd-select>
		`,
	} as const;

	/**
	 * Declarative item-list setter. Replaces the existing
	 * `<wpd-option>` children with a fresh set; preserves `value`
	 * when it still matches, otherwise clears to the placeholder.
	 *
	 * Same shape as the setter on `<wpd-segmented>` so callers can
	 * swap tag names (segmented ↔ select) without touching the
	 * populate code when an option list outgrows the pill bar.
	 *
	 * ```js
	 * select.items = [
	 *   { value: 'eur', label: 'Euro' },
	 *   { value: 'usd', label: 'US Dollar' },
	 * ];
	 * ```
	 *
	 * @since 0.11.0
	 */
	set items( list: ReadonlyArray<{ value: string; label: string }> ) {
		const existing = this.querySelectorAll( ':scope > wpd-option' );
		for ( const el of Array.from( existing ) ) {
			el.remove();
		}
		for ( const item of list ) {
			const opt = document.createElement( 'wpd-option' );
			opt.setAttribute( 'value', item.value );
			opt.textContent = item.label;
			this.appendChild( opt );
		}
		// Fall back to the first entry when the previous value is
		// no longer in the list so the visible selection doesn't
		// stay stuck on a removed option. Setting `value` flows
		// through the property accessor, which reflects to the
		// attribute and calls `_scheduleRender()` — usually a
		// no-op if a render is already pending.
		const current =
			( this as unknown as { value: string | null } ).value;
		const stillValid =
			current !== null && list.some( ( i ) => i.value === current );
		if ( ! stillValid && list.length > 0 ) {
			( this as unknown as { value: string } ).value = list[ 0 ].value;
		}
		// Explicit re-render request. The MutationObserver wired in
		// connectedCallback() also notices the appendChilds above
		// and calls `requestUpdate()`, but MO microtasks race the
		// connect-time render in real browsers — plugin authors
		// that assign `.items` synchronously inside a native-window
		// render callback (i.e. before any microtask has run since
		// the element upgraded) were seeing an empty `<select>`.
		// Calling `requestUpdate()` here makes the setter the
		// source of truth and removes the MO-timing dependency.
		this.requestUpdate();
	}

	private _optionObserver: MutationObserver | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		// Deterministic auto-id based on native-window + tab
		// ancestry + label. Plugin authors that want a custom id
		// pass `id="…"` and skip this branch.
		ensureAutoId( this );
		// Watch for late-added / removed / mutated `<wpd-option>`
		// children so a caller that programmatically populates the
		// list after mount gets an up-to-date rendered select.
		// Matches the `<wpd-segmented>` late-children contract.
		this._optionObserver = new MutationObserver( () => this.requestUpdate() );
		this._optionObserver.observe( this, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [ 'value', 'disabled' ],
			characterData: true,
		} );
	}

	disconnectedCallback(): void {
		this._optionObserver?.disconnect();
		this._optionObserver = null;
	}

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const current = ( this as unknown as { value: string | null } ).value;
		const placeholder =
			( this as unknown as { placeholder: string | null } ).placeholder || '';
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const name =
			( this as unknown as { name: string | null } ).name || '';

		// A11y: `aria-label` on the host lets screen readers announce
		// the group name when focus reaches the shell; forwarding
		// the same label to the native `<select>` below is what
		// silences the Chrome DevTools "form field needs an id or
		// name" warning — the native interactive element is the
		// thing browsers audit.
		if ( label ) {
			this.setAttribute( 'aria-label', label );
		} else {
			this.removeAttribute( 'aria-label' );
		}

		// Pick the best accessible-name string for the inner
		// `<select>`: explicit `label` wins, otherwise the
		// `placeholder`. When neither is set the select is still
		// labelless — that's the plugin author's responsibility to
		// wire up with an external `<label for>` or `aria-labelledby`.
		const selectAriaLabel = label || placeholder;

		const options = this._readOptions();
		const hasEmptyOption = options.some( ( o ) => o.value === '' );
		// Shadow-DOM <label for=…> pairing — the inner id is
		// derived from the host's auto-id (or explicit id) so
		// label-click focuses the select.
		const hostId = this.id || 'wpd-unnamed';
		const selectId = `${ hostId }__input`;

		return html`
			${ label
				? html`<label
						class="wpd-select__label"
						for=${ selectId }
					>${ label }</label>`
				: html`` }
			<span class="wpd-select__wrap">
				<select
					id=${ selectId }
					?disabled=${ disabled }
					aria-label=${ selectAriaLabel }
					name=${ name }
					@change=${ ( e: Event ) => this._onChange( e ) }
				>
					${ placeholder && ! current && ! hasEmptyOption
						? html`<option value="" disabled selected>
								${ placeholder }
						  </option>`
						: html`` }
					${ options.map(
						( o ) => html`
							<option
								.value=${ o.value }
								?disabled=${ o.disabled }
								?selected=${ o.value === current }
							>
								${ o.label }
							</option>
						`,
					) }
				</select>
				<!--
					Inline SVG — the previous dashicons-classed span
					never painted because the global Dashicons font
					stylesheet cannot cross the shadow-root boundary.
					An inline SVG lives inside the shadow tree, inherits
					currentColor via the stroke attribute, and needs
					no external CSS.
				-->
				<svg
					class="wpd-select__chevron"
					viewBox="0 0 12 12"
					width="12"
					height="12"
					aria-hidden="true"
					focusable="false"
				>
					<path
						d="M3 5l3 3 3-3"
						stroke="currentColor"
						stroke-width="1.4"
						stroke-linecap="round"
						stroke-linejoin="round"
						fill="none"
					></path>
				</svg>
			</span>
		`;
	}

	private _readOptions(): Array< {
		value: string;
		label: string;
		disabled: boolean;
	} > {
		const out: Array< { value: string; label: string; disabled: boolean } > =
			[];
		// Direct-child scope so nested `<wpd-option>` inside a
		// plugin's own layout (rare, but possible when plugins wrap
		// their content) can't pollute the picker. Matches the
		// `.items` setter's `:scope > wpd-option` selector.
		const children = this.querySelectorAll( ':scope > wpd-option' );
		for ( const child of Array.from( children ) ) {
			const value = child.getAttribute( 'value' );
			if ( value === null ) {
				continue;
			}
			out.push( {
				value,
				label: ( child.textContent || value ).trim(),
				disabled: child.hasAttribute( 'disabled' ),
			} );
		}
		return out;
	}

	private _onChange( e: Event ): void {
		const sel = e.target as HTMLSelectElement;
		const next = sel.value;
		// Reflect into `value` so repeated reads + aria state stay
		// in sync, then emit the public `wpd-pick` event — same
		// shape `<wpd-segmented>` uses so callers can swap tags.
		( this as unknown as { value: string } ).value = next;
		this.emit( 'wpd-pick', { value: next } );
	}
}
defineComponent( 'wpd-select', WpdSelect );
