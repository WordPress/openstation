/**
 * `<os-select>` + `<os-option>` — dropdown picker.
 *
 * Mirrors the `<os-segmented>` contract — set `value`, listen for
 * `os-pick` — so callers can swap the tag name when a list grows
 * past the handful of items a pill bar can host comfortably
 * (currencies, timezones, long enumerations).
 *
 * ```html
 * <os-select value="eur" label="Currency">
 *     <os-option value="eur">Euro</os-option>
 *     <os-option value="usd">US Dollar</os-option>
 *     <os-option value="jpy">Japanese Yen</os-option>
 * </os-select>
 * ```
 *
 * ## One visual language, so the popup is ours
 *
 * The closed control used to wrap a native `<select>`, which meant
 * the open popup was the operating system's: a styled OpenStation
 * field that dropped a stock blue macOS menu. Half custom, half
 * native reads as neither, so the whole control is custom now — a
 * combobox button plus a listbox popup rendered in the top layer via
 * the Popover API. The top layer escapes every `overflow: hidden`
 * between here and the viewport AND ignores ancestor transforms,
 * which matters because every OpenStation window is a transformed,
 * clipped container.
 *
 * Where the Popover API is missing (jsdom, older engines) the popup
 * falls back to an absolutely positioned block under the trigger:
 * same DOM, same events, just without top-layer escape.
 *
 * ## Keyboard
 *
 * Focus stays on the trigger the whole time (the APG select-only
 * combobox pattern): ArrowUp/Down/Home/End move the active option
 * via aria-activedescendant, Enter and Space commit, Escape and
 * outside clicks dismiss, printable characters type ahead.
 */

import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
import { osIcon } from '../../icons';
import { optionStyles, selectStyles } from './os-select.styles';

/**
 * Opaque data carrier. The parent `<os-select>` reads its `value`
 * attribute + `textContent` to build the listbox. Rendered
 * `display: none` so the raw light markup doesn't flash before the
 * parent upgrades.
 */
export class OsOption extends Component {
	static props = [ 'value', 'disabled' ] as const;
	static styles = [ optionStyles ];

	static help = {
		title: 'Option',
		summary:
			'Opaque data carrier for <os-select>. Carries its identifier in `value` and its visible label in textContent. Not rendered directly — the parent reads these and builds its listbox.',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Option identifier read by the parent <os-select>.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Renders the option disabled in the listbox.',
			},
		],
		slots: [
			{ name: '(default)', description: 'Label text read from textContent.' },
		],
		/*
		 * This component paints nothing — `:host { display: none }`,
		 * by design. So the example shows the only thing there is to
		 * see: what the parent builds out of it. A blank Example
		 * section here would look like a bug rather than like the
		 * deliberate choice it is.
		 */
		example: html`
			<os-select value="md" label="Dock size (built from os-option children)">
				<os-option value="sm">Small</os-option>
				<os-option value="md">Medium</os-option>
				<os-option value="lg">Large</os-option>
				<os-option value="xl" disabled>Extra large (disabled)</os-option>
			</os-select>
		`,
	} as const;

	protected render() {
		// Intentionally empty — the option is a data carrier. Its
		// label lives in its light-DOM textContent, which the parent
		// reads directly.
		return html``;
	}
}
defineComponent( 'os-option', OsOption );

interface ReadOption {
	value: string;
	label: string;
	disabled: boolean;
}

export class OsSelect extends Component {
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
			'Dropdown picker: a combobox trigger plus a custom top-layer listbox, so the popup wears the station instead of the operating system. Mirrors the <os-segmented> contract (set value, listen for os-pick).',
		status: 'stable',
		props: [
			{
				name: 'value',
				type: 'string',
				description: 'Currently selected option value.',
			},
			{
				name: 'label',
				type: 'string',
				description:
					'Visible label rendered above the trigger and used as the accessible name.',
			},
			{
				name: 'placeholder',
				type: 'string',
				description: 'Trigger text shown when no value is set.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Disables the trigger and dims the chrome.',
			},
			{
				name: 'name',
				type: 'string',
				description:
					'Accepted for compatibility. Shadow-DOM controls never participated in light-DOM form submission, so nothing is lost by the native select being gone; read `value` off the host instead.',
			},
		],
		slots: [
			{ name: '(default)', description: '<os-option value="…"> children.' },
		],
		events: [
			{
				name: 'os-pick',
				description: 'Fires when the user picks a new option.',
				detail: '{ value: string }',
			},
		],
		cssProps: [
			{ name: '--os-ui-fg', description: 'Label + value colour.' },
			{ name: '--os-ui-fg-muted', description: 'Placeholder + chevron colour.' },
			{
				name: '--os-ui-accent',
				description: 'Active option row + selected check.',
			},
		],
		example: html`
			<os-select value="eur" label="Currency">
				<os-option value="eur">Euro</os-option>
				<os-option value="usd">US Dollar</os-option>
				<os-option value="jpy">Japanese Yen</os-option>
			</os-select>
		`,
	} as const;

	/**
	 * Declarative item-list setter. Replaces the existing
	 * `<os-option>` children with a fresh set; preserves `value`
	 * when it still matches, otherwise clears to the first entry.
	 *
	 * Same shape as the setter on `<os-segmented>` so callers can
	 * swap tag names (segmented ↔ select) without touching the
	 * populate code when an option list outgrows the pill bar.
	 *
	 * ```js
	 * select.items = [
	 *   { value: 'eur', label: 'Euro' },
	 *   { value: 'usd', label: 'US Dollar' },
	 * ];
	 * ```
	 */
	set items( list: ReadonlyArray< { value: string; label: string } > ) {
		const existing = this.querySelectorAll( ':scope > os-option' );
		for ( const el of Array.from( existing ) ) {
			el.remove();
		}
		for ( const item of list ) {
			const opt = document.createElement( 'os-option' );
			opt.setAttribute( 'value', item.value );
			opt.textContent = item.label;
			this.appendChild( opt );
		}
		// Fall back to the first entry when the previous value is
		// no longer in the list so the visible selection doesn't
		// stay stuck on a removed option.
		const current = ( this as unknown as { value: string | null } ).value;
		const stillValid =
			current !== null && list.some( ( i ) => i.value === current );
		if ( ! stillValid && list.length > 0 ) {
			( this as unknown as { value: string } ).value = list[ 0 ].value;
		}
		// Explicit re-render request. The MutationObserver wired in
		// connectedCallback() also notices the appendChilds above,
		// but MO microtasks race the connect-time render in real
		// browsers — see the note in the old native implementation;
		// the setter stays the source of truth.
		this.requestUpdate();
	}

	private _optionObserver: MutationObserver | null = null;

	/** Whether the listbox is showing. */
	private _open = false;

	/** Index into _readOptions() of the keyboard-active option. */
	private _activeIndex = -1;

	/** Type-ahead buffer + its reset timer. */
	private _typed = '';
	/**
	 * When the popover last light-dismissed itself, so a click on the
	 * trigger that was part of the same gesture does not reopen it.
	 */
	private _dismissedAt = 0;
	private _typedTimer: ReturnType< typeof setTimeout > | null = null;

	/**
	 * Bound dismiss handlers, added while open, removed on close.
	 *
	 * The scroll listener is on `window` in the CAPTURE phase, because
	 * a scroll inside some ancestor's own overflow container never
	 * bubbles to `window` and that is exactly the scroll that moves the
	 * trigger out from under the panel. Capture sees all of them —
	 * including the panel's OWN scroll, which is why this one checks.
	 * The list is capped at `min( 320px, 60vh )` and scrolls itself, so
	 * without the guard any list past about ten options closed the
	 * instant the user reached for it.
	 */
	private _onWindowScroll = ( e: Event ): void => {
		const target = e.target;
		const popup = this._popup();
		if (
			popup &&
			target instanceof Node &&
			( target === popup || popup.contains( target ) )
		) {
			return;
		}
		this._hide();
	};
	private _onWindowResize = (): void => this._hide();

	connectedCallback(): void {
		super.connectedCallback();
		// Deterministic auto-id based on native-window + tab
		// ancestry + label. Plugin authors that want a custom id
		// pass `id="…"` and skip this branch.
		ensureAutoId( this );
		// Watch for late-added / removed / mutated `<os-option>`
		// children so a caller that programmatically populates the
		// list after mount gets an up-to-date listbox. Matches the
		// `<os-segmented>` late-children contract.
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
		this._teardownDismiss();
		/*
		 * Leave detached CLOSED. The listeners went with
		 * `_teardownDismiss()` and the popup left the top layer with the
		 * node, so a lingering `_open` describes nothing that is still
		 * on screen — but `_show()` early-returns on it, so the next
		 * click after a re-attach only got as far as closing something
		 * already closed. Two clicks to open a select, once.
		 */
		this._open = false;
		if ( this._typedTimer ) {
			clearTimeout( this._typedTimer );
			this._typedTimer = null;
		}
	}

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const current = ( this as unknown as { value: string | null } ).value;
		const placeholder =
			( this as unknown as { placeholder: string | null } ).placeholder || '';
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;

		// A11y: `aria-label` on the host lets screen readers announce
		// the group name when focus reaches the shell.
		if ( label ) {
			this.setAttribute( 'aria-label', label );
		}
		const hostAriaLabel = this.getAttribute( 'aria-label' ) || '';
		const triggerAriaLabel = label || hostAriaLabel || placeholder;

		const options = this._readOptions();
		const currentOption = options.find( ( o ) => o.value === current );
		const triggerText = currentOption
			? currentOption.label
			: placeholder;

		const hostId = this.id || 'os-unnamed';
		const listboxId = `${ hostId }__listbox`;
		const triggerId = `${ hostId }__trigger`;
		const activeId =
			this._open && this._activeIndex >= 0
				? `${ hostId }__opt-${ this._activeIndex }`
				: '';

		return html`
			${ label
				? html`<label
						class="os-select__label"
						for=${ triggerId }
					>${ label }</label>`
				: html`` }
			<button
				type="button"
				class="os-select__trigger"
				id=${ triggerId }
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded=${ this._open ? 'true' : 'false' }
				aria-controls=${ listboxId }
				aria-label=${ triggerAriaLabel }
				aria-activedescendant=${ activeId }
				?disabled=${ disabled }
				@click=${ () => this._toggle() }
				@keydown=${ ( e: KeyboardEvent ) => this._onTriggerKeydown( e ) }
			>
				<span
					class="os-select__value${ currentOption
						? ''
						: ' os-select__value--placeholder' }"
					>${ triggerText }</span
				>
				${ osIcon( 'chevron-right', {
					size: 16,
					rotate: 90,
					className: 'os-select__chevron',
				} ) }
			</button>
			<div
				class="os-select__popup"
				id=${ listboxId }
				role="listbox"
				popover="auto"
				aria-label=${ triggerAriaLabel }
				@toggle=${ ( e: Event ) => this._onPopoverToggle( e ) }
			>
				${ options.map(
					( o, i ) => html`
						<div
							class="os-select__option"
							id=${ `${ hostId }__opt-${ i }` }
							role="option"
							data-value=${ o.value }
							aria-selected=${ o.value === current
								? 'true'
								: 'false' }
							aria-disabled=${ o.disabled ? 'true' : 'false' }
							?data-active=${ this._open &&
							i === this._activeIndex }
							@click=${ () => this._onOptionClick( o ) }
							@pointermove=${ () => this._setActive( i ) }
						>
							${ osIcon( 'check', {
								size: 16,
								className: 'os-select__check',
							} ) }
							<span class="os-select__option-label"
								>${ o.label }</span
							>
						</div>
					`,
				) }
			</div>
		`;
	}

	private _readOptions(): ReadOption[] {
		const out: ReadOption[] = [];
		// Direct-child scope so nested `<os-option>` inside a
		// plugin's own layout (rare, but possible when plugins wrap
		// their content) can't pollute the picker. Matches the
		// `.items` setter's `:scope > os-option` selector.
		const children = this.querySelectorAll( ':scope > os-option' );
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

	private _popup(): HTMLElement | null {
		return this.shadowRoot?.querySelector( '.os-select__popup' ) ?? null;
	}

	private _trigger(): HTMLElement | null {
		return this.shadowRoot?.querySelector( '.os-select__trigger' ) ?? null;
	}

	/**
	 * Trigger click.
	 *
	 * The guard is for the light dismiss. `popover="auto"` closes on
	 * pointerdown, before this click lands, and it reports that through
	 * a `toggle` event queued as a task — so by the time the click runs
	 * `_open` may already be `false` and a plain toggle would reopen
	 * what the user just dismissed, leaving a menu its own trigger
	 * cannot close. Task ordering is not guaranteed across engines, so
	 * this does not depend on it: a close that happened within a frame
	 * of this click was the same gesture, and the click is spent.
	 */
	private _toggle(): void {
		if ( this._open ) {
			this._hide();
			return;
		}
		if ( performance.now() - this._dismissedAt < 250 ) {
			return;
		}
		this._show();
	}

	/*
	 * Positioning happens against the viewport because a top-layer
	 * popover positions against the viewport, full stop: ancestor
	 * transforms (every dragged window has one) and clipping do not
	 * reach it, and getBoundingClientRect speaks the same coordinate
	 * space. Measured at open time; while open, any scroll or resize
	 * dismisses rather than tracks, which is also what the native
	 * menu did.
	 */
	private _show(): void {
		const popup = this._popup();
		const trigger = this._trigger();
		if ( ! popup || ! trigger || this._open ) {
			return;
		}
		this._open = true;
		const options = this._readOptions();
		const current = ( this as unknown as { value: string | null } ).value;
		const selected = options.findIndex(
			( o ) => o.value === current && ! o.disabled,
		);
		this._activeIndex =
			selected >= 0
				? selected
				: options.findIndex( ( o ) => ! o.disabled );

		const rect = trigger.getBoundingClientRect();
		popup.style.minWidth = `${ rect.width }px`;
		if ( typeof popup.showPopover === 'function' ) {
			popup.style.left = `${ rect.left }px`;
			popup.style.top = `${ rect.bottom + 4 }px`;
			popup.showPopover();
			// Flip above the trigger when there is no room below.
			// Measured after showPopover, because a closed popover
			// has no box to measure.
			const overflow =
				rect.bottom + 4 + popup.offsetHeight >
				window.innerHeight - 8;
			if ( overflow ) {
				popup.style.top = `${ Math.max(
					8,
					rect.top - 4 - popup.offsetHeight,
				) }px`;
			}
		} else {
			// Fallback for engines without the Popover API: an
			// absolutely positioned block under the trigger. Same
			// DOM and events, no top-layer escape.
			popup.setAttribute( 'data-open', '' );
		}
		window.addEventListener( 'scroll', this._onWindowScroll, {
			capture: true,
			passive: true,
		} );
		window.addEventListener( 'resize', this._onWindowResize );
		this.requestUpdate();
		this._scrollActiveIntoView();
	}

	private _hide(): void {
		if ( ! this._open ) {
			return;
		}
		this._open = false;
		const popup = this._popup();
		if ( popup ) {
			if ( typeof popup.hidePopover === 'function' ) {
				try {
					popup.hidePopover();
				} catch {
					// Already closed by light dismiss: fine.
				}
			}
			popup.removeAttribute( 'data-open' );
		}
		this._teardownDismiss();
		this.requestUpdate();
	}

	private _teardownDismiss(): void {
		window.removeEventListener( 'scroll', this._onWindowScroll, {
			capture: true,
		} );
		window.removeEventListener( 'resize', this._onWindowResize );
	}

	/**
	 * Light dismiss (Esc, outside click) closes the popover without
	 *  going through _hide(); this keeps the component state honest.
	 */
	private _onPopoverToggle( e: Event ): void {
		const state = ( e as unknown as { newState?: string } ).newState;
		if ( state === 'closed' && this._open ) {
			// Stamped for `_toggle()`: see the note there about the
			// light dismiss racing the trigger's own click.
			this._dismissedAt = performance.now();
			this._open = false;
			this._teardownDismiss();
			this.requestUpdate();
		}
	}

	private _onOptionClick( option: ReadOption ): void {
		if ( option.disabled ) {
			return;
		}
		this._commit( option.value );
	}

	private _commit( next: string ): void {
		this._hide();
		// Reflect into `value` so repeated reads + aria state stay
		// in sync, then emit the public `os-pick` event — same
		// shape `<os-segmented>` uses so callers can swap tags.
		( this as unknown as { value: string } ).value = next;
		this.emit( 'os-pick', { value: next } );
	}

	private _setActive( index: number ): void {
		if ( index === this._activeIndex ) {
			return;
		}
		const options = this._readOptions();
		if ( ! options[ index ] || options[ index ].disabled ) {
			return;
		}
		this._activeIndex = index;
		this.requestUpdate();
	}

	private _moveActive( delta: number ): void {
		const options = this._readOptions();
		let i = this._activeIndex;
		for ( let step = 0; step < options.length; step++ ) {
			i = Math.min( Math.max( i + delta, 0 ), options.length - 1 );
			if ( ! options[ i ]?.disabled ) {
				break;
			}
			if ( i === 0 || i === options.length - 1 ) {
				break;
			}
		}
		if ( i !== this._activeIndex && options[ i ] && ! options[ i ].disabled ) {
			this._activeIndex = i;
			this.requestUpdate();
			this._scrollActiveIntoView();
		}
	}

	private _scrollActiveIntoView(): void {
		// The render that stamps data-active runs on a microtask;
		// ride the next one so the element exists before scrolling.
		// The optional CALL is for jsdom, which has no scrollIntoView.
		queueMicrotask( () => {
			this.shadowRoot
				?.querySelector( '.os-select__option[data-active]' )
				?.scrollIntoView?.( { block: 'nearest' } );
		} );
	}

	private _typeAhead( char: string ): void {
		if ( this._typedTimer ) {
			clearTimeout( this._typedTimer );
		}
		this._typed += char.toLowerCase();
		this._typedTimer = setTimeout( () => {
			this._typed = '';
		}, 500 );
		const options = this._readOptions();
		const match = options.findIndex(
			( o ) =>
				! o.disabled &&
				o.label.toLowerCase().startsWith( this._typed ),
		);
		if ( match >= 0 ) {
			this._activeIndex = match;
			this.requestUpdate();
			this._scrollActiveIntoView();
		}
	}

	private _onTriggerKeydown( e: KeyboardEvent ): void {
		const options = this._readOptions();
		if ( options.length === 0 ) {
			return;
		}
		if ( ! this._open ) {
			if (
				[ 'ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End' ].includes(
					e.key,
				)
			) {
				e.preventDefault();
				this._show();
				if ( e.key === 'Home' ) {
					this._activeIndex = options.findIndex(
						( o ) => ! o.disabled,
					);
				}
				if ( e.key === 'End' ) {
					for ( let i = options.length - 1; i >= 0; i-- ) {
						if ( ! options[ i ].disabled ) {
							this._activeIndex = i;
							break;
						}
					}
				}
				this.requestUpdate();
			} else if ( e.key.length === 1 && e.key.trim() !== '' ) {
				this._show();
				this._typeAhead( e.key );
			}
			return;
		}
		switch ( e.key ) {
			case 'ArrowDown':
				e.preventDefault();
				this._moveActive( 1 );
				break;
			case 'ArrowUp':
				e.preventDefault();
				this._moveActive( -1 );
				break;
			case 'Home':
				e.preventDefault();
				this._activeIndex = options.findIndex( ( o ) => ! o.disabled );
				this.requestUpdate();
				this._scrollActiveIntoView();
				break;
			case 'End':
				e.preventDefault();
				for ( let i = options.length - 1; i >= 0; i-- ) {
					if ( ! options[ i ].disabled ) {
						this._activeIndex = i;
						this.requestUpdate();
						this._scrollActiveIntoView();
						break;
					}
				}
				break;
			case 'Enter':
			case ' ': {
				e.preventDefault();
				const active = options[ this._activeIndex ];
				if ( active && ! active.disabled ) {
					this._commit( active.value );
				}
				break;
			}
			case 'Tab': {
				// Commit-and-move-on, the way a native select behaves.
				const active = options[ this._activeIndex ];
				if ( active && ! active.disabled ) {
					this._commit( active.value );
				} else {
					this._hide();
				}
				break;
			}
			case 'Escape':
				e.preventDefault();
				this._hide();
				break;
			default:
				if ( e.key.length === 1 && e.key.trim() !== '' ) {
					this._typeAhead( e.key );
				}
		}
	}
}
defineComponent( 'os-select', OsSelect );
