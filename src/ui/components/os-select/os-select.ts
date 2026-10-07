import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
import { osIcon } from '../../icons';
import { optionStyles, selectStyles } from './os-select.styles';

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
				name: 'plain',
				type: 'boolean attribute',
				description:
					'Drops the field chrome and shrinks to the value, for a picker that is a list row’s trailing control rather than a field of its own. The container already draws the box; use with no `label`.',
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

		const current = ( this as unknown as { value: string | null } ).value;
		const stillValid =
			current !== null && list.some( ( i ) => i.value === current );
		if ( ! stillValid && list.length > 0 ) {
			( this as unknown as { value: string } ).value = list[ 0 ].value;
		}

		this.requestUpdate();
	}

	private _optionObserver: MutationObserver | null = null;

	private _open = false;

	private _activeIndex = -1;

	private _typed = '';

	private _dismissedAt = 0;
	private _typedTimer: ReturnType< typeof setTimeout > | null = null;

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

		ensureAutoId( this );

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

	private _onPopoverToggle( e: Event ): void {
		const state = ( e as unknown as { newState?: string } ).newState;
		if ( state === 'closed' && this._open ) {
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
