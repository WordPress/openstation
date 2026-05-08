/**
 * `<wpd-multiselect>` — multi-select dropdown picker.
 *
 * The multi-select sibling of `<wpd-select>`. Same `<wpd-option>`
 * data-carrier children, same compact-trigger visual language; the
 * difference is that the popover lists checkboxes instead of a
 * native `<select>`, multiple options can be checked at once, and
 * `value` is a comma-joined id list (e.g. `"1,4,7"`) so it round-
 * trips through plain `string` attributes the same way every other
 * `wpd-*` value does.
 *
 * ```html
 * <wpd-multiselect value="1,4" label="Authors">
 *     <wpd-option value="1">Daniel</wpd-option>
 *     <wpd-option value="4">Peter</wpd-option>
 *     <wpd-option value="9">Pat</wpd-option>
 * </wpd-multiselect>
 * ```
 *
 * The popover is appended to `document.body` with `position: fixed`
 * so it escapes any overflow / clip ancestor — required for filter
 * cells inside scrolling tables, kebab menus inside windows, etc.
 *
 * Emits `wpd-pick` with `{ value, values }` on every change.
 *
 * @public
 * @since 0.8.0
 */

import {
	Component,
	defineComponent,
	ensureAutoId,
	html,
} from '../../core';
// `<wpd-option>` is already defined by `<wpd-select>`. Side-effect
// import wires it in environments that load multiselect without
// touching select first (third-party bundles).
import '../wpd-select/wpd-select';
import { multiselectStyles } from './wpd-multiselect.styles';

export class WpdMultiselect extends Component {
	static props = [
		'value',
		'label',
		'placeholder',
		'disabled',
		'name',
		'open',
	] as const;
	static styles = [ multiselectStyles ];

	static help = {
		title: 'Multi-select',
		summary:
			'Multi-select dropdown picker that mirrors <wpd-select> ergonomically. Trigger button shows a one-line summary; clicking opens a checkbox popover. value is a comma-joined id list so it round-trips through plain string attributes.',
		status: 'experimental',
		since: '0.8.0',
		props: [
			{
				name: 'value',
				type: 'string (comma-joined ids)',
				description:
					'Currently selected option values, joined by commas (e.g. "1,4"). Empty string means no selection.',
			},
			{
				name: 'label',
				type: 'string',
				description:
					'Visible label rendered above the trigger and forwarded as aria-label to the trigger button.',
			},
			{
				name: 'placeholder',
				type: 'string',
				description:
					'Trigger summary when no option is checked. Defaults to "All".',
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
					'Forwarded to the hidden form-field for HTML form submission.',
			},
			{
				name: 'open',
				type: 'boolean attribute',
				description:
					'Reflects the open state of the popover. Toggle programmatically to open/close, or read from a CSS selector.',
			},
		],
		slots: [
			{ name: '(default)', description: '<wpd-option value="…"> children.' },
		],
		events: [
			{
				name: 'wpd-pick',
				description:
					'Fires when the user toggles any option. Detail carries both shapes — `value` is the comma-joined attribute round-trip, `values` is the parsed array.',
				detail: '{ value: string; values: string[] }',
			},
			{
				name: 'wpd-multiselect-open',
				description: 'Fires when the popover opens.',
				detail: '{}',
			},
			{
				name: 'wpd-multiselect-close',
				description: 'Fires when the popover closes.',
				detail: '{}',
			},
			{
				name: 'wpd-multiselect-load-more',
				description:
					'Fires when the user scrolls near the bottom of the popover and `hasMore` is true. Consumer fetches the next page and calls `picker.appendItems(...)` to extend the list. While the fetch is in flight, set `picker.loadingMore = true` to show the spinner row and prevent re-firing.',
				detail: '{}',
			},
		],
		cssProps: [
			{ name: '--desktop-mode-text', description: 'Label + value colour.' },
			{ name: '--desktop-mode-muted', description: 'Placeholder + chevron colour.' },
		],
		example: html`
			<wpd-multiselect value="1,4" label="Authors">
				<wpd-option value="1">Daniel</wpd-option>
				<wpd-option value="4">Peter</wpd-option>
				<wpd-option value="9">Pat</wpd-option>
			</wpd-multiselect>
		`,
	} as const;

	/**
	 * Declarative item-list setter. Replaces the existing
	 * `<wpd-option>` children with a fresh set; preserves any values
	 * that still match.
	 *
	 * @since 0.8.0
	 */
	set items( list: ReadonlyArray< { value: string; label: string } > ) {
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
		// A full bulk replacement also concludes any in-flight
		// load-more cycle — the consumer effectively just re-seeded
		// the option list, so we should drop the spinner row.
		this._loadingMore = false;
		const validSet = new Set( list.map( ( i ) => i.value ) );
		const next = this._readValues().filter( ( v ) => validSet.has( v ) );
		this._writeValueAttribute( next );
		this.requestUpdate();
		this._refreshPopover();
	}

	/** Programmatic getter for the parsed selection. */
	get values(): string[] {
		return this._readValues();
	}

	/**
	 * Programmatic setter — accepts an array of values; serialises
	 * back to the `value` attribute as a comma-joined string.
	 */
	set values( next: readonly string[] | null | undefined ) {
		const arr = Array.isArray( next )
			? next.map( ( v ) => String( v ) ).filter( ( v ) => v !== '' )
			: [];
		this._writeValueAttribute( arr );
		this.requestUpdate();
		this._refreshPopover();
	}

	private _optionObserver: MutationObserver | null = null;
	private _popover: HTMLDivElement | null = null;
	private _teardownOpen: ( () => void ) | null = null;
	/**
	 * Pagination state for the infinite-scroll mode. Set
	 * `picker.hasMore = true` to opt in; the popover then watches its
	 * scroll position and emits `wpd-multiselect-load-more` near the
	 * bottom. The consumer calls `picker.appendItems(more)` when the
	 * fetch lands and toggles `picker.hasMore` off when no more pages
	 * remain.
	 */
	private _hasMore = false;
	private _loadingMore = false;

	/** Whether more pages are available (drives the load-more emit). */
	get hasMore(): boolean {
		return this._hasMore;
	}
	set hasMore( next: boolean ) {
		this._hasMore = !! next;
		this._refreshPopover();
	}

	/**
	 * Whether a load-more fetch is currently in flight. While true,
	 * the popover paints a small spinner row and suppresses further
	 * `wpd-multiselect-load-more` emits.
	 */
	get loadingMore(): boolean {
		return this._loadingMore;
	}
	set loadingMore( next: boolean ) {
		this._loadingMore = !! next;
		this._refreshPopover();
	}

	/**
	 * Append additional options without dropping any already in the
	 * tree. Used by infinite-scroll consumers — call when the next
	 * page lands, then set `loadingMore = false` and update
	 * `hasMore` based on whether more pages remain.
	 *
	 * @since 0.8.0
	 */
	appendItems(
		more: ReadonlyArray< { value: string; label: string } >,
	): void {
		// Clear the in-flight flag whenever a load-more landing
		// surface comes in, even if the page was empty — that's how
		// the consumer signals "fetch finished, you can ask again".
		this._loadingMore = false;
		if ( ! more || more.length === 0 ) {
			this._refreshPopover();
			return;
		}
		const existing = new Set(
			Array.from( this.querySelectorAll( ':scope > wpd-option' ) ).map(
				( el ) => el.getAttribute( 'value' ),
			),
		);
		for ( const item of more ) {
			if ( existing.has( item.value ) ) {
				continue;
			}
			const opt = document.createElement( 'wpd-option' );
			opt.setAttribute( 'value', item.value );
			opt.textContent = item.label;
			this.appendChild( opt );
		}
		this.requestUpdate();
		this._refreshPopover();
	}

	connectedCallback(): void {
		super.connectedCallback();
		ensureAutoId( this );
		this._optionObserver = new MutationObserver( () => {
			this.requestUpdate();
			this._refreshPopover();
		} );
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
		this._closePopover();
	}

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const placeholder =
			( this as unknown as { placeholder: string | null } ).placeholder ||
			'All';
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;

		if ( label ) {
			this.setAttribute( 'aria-label', label );
		} else {
			this.removeAttribute( 'aria-label' );
		}

		const triggerAriaLabel = label || placeholder;
		const summary = this._summarize( placeholder );
		const isActive = this._readValues().length > 0;
		const hostId = this.id || 'wpd-unnamed';
		const triggerId = `${ hostId }__trigger`;

		return html`
			${ label
				? html`<label
						class="wpd-multiselect__label"
						for=${ triggerId }
					>${ label }</label>`
				: html`` }
			<button
				id=${ triggerId }
				type="button"
				class="wpd-multiselect__trigger"
				aria-haspopup="listbox"
				aria-expanded=${ this._isOpen() ? 'true' : 'false' }
				aria-label=${ triggerAriaLabel }
				?disabled=${ disabled }
				data-active=${ isActive ? 'true' : 'false' }
				@click=${ ( e: Event ) => this._onTriggerClick( e ) }
			>
				<span class="wpd-multiselect__summary">${ summary }</span>
				<svg
					class="wpd-multiselect__chevron"
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
					/>
				</svg>
			</button>
		`;
	}

	private _readOptions(): Array< {
		value: string;
		label: string;
		disabled: boolean;
	} > {
		const out: Array< { value: string; label: string; disabled: boolean } > =
			[];
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

	private _readValues(): string[] {
		const raw =
			( this as unknown as { value: string | null } ).value ?? '';
		return raw
			.split( ',' )
			.map( ( s ) => s.trim() )
			.filter( ( s ) => s !== '' );
	}

	private _writeValueAttribute( vals: readonly string[] ): void {
		const next = vals.join( ',' );
		( this as unknown as { value: string } ).value = next;
	}

	private _summarize( placeholder: string ): string {
		const vals = this._readValues();
		if ( vals.length === 0 ) {
			return placeholder;
		}
		const opts = this._readOptions();
		const byValue = new Map( opts.map( ( o ) => [ o.value, o.label ] ) );
		if ( vals.length === 1 ) {
			return byValue.get( vals[ 0 ] ) ?? vals[ 0 ];
		}
		// "N selected" — wpd-* components stay i18n-agnostic at the
		// component level (consumers that want a custom summary can
		// listen for `wpd-pick` and paint their own trigger label
		// outside the component).
		return `${ vals.length } selected`;
	}

	private _isOpen(): boolean {
		return ( this as unknown as { open: string | null } ).open !== null;
	}

	private _onTriggerClick( e: Event ): void {
		e.stopPropagation();
		e.preventDefault();
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		if ( disabled ) {
			return;
		}
		if ( this._popover ) {
			this._closePopover();
		} else {
			this._openPopover();
		}
	}

	private _openPopover(): void {
		if ( this._popover ) {
			return;
		}
		const popover = document.createElement( 'div' );
		popover.className = 'wpd-multiselect__popover';
		popover.setAttribute( 'role', 'listbox' );
		popover.setAttribute( 'aria-multiselectable', 'true' );
		// Inherit the host's CSS custom-property scope so accent /
		// admin-theme-color resolve the same as the trigger does.
		popover.style.setProperty(
			'--wp-admin-theme-color',
			getComputedStyle( this ).getPropertyValue(
				'--wp-admin-theme-color',
			) || '#2271b1',
		);
		document.body.appendChild( popover );
		this._popover = popover;

		this._refreshPopover();
		this._placePopover();

		const onDocPointer = ( ev: PointerEvent ): void => {
			const target = ev.target as Node | null;
			if ( ! target ) {
				return;
			}
			const trigger = this.shadowRoot?.querySelector(
				'.wpd-multiselect__trigger',
			);
			if ( popover.contains( target ) ) {
				return;
			}
			if ( trigger && trigger.contains( target ) ) {
				return;
			}
			this._closePopover();
		};
		const onKey = ( ev: KeyboardEvent ): void => {
			if ( ev.key === 'Escape' ) {
				ev.stopPropagation();
				this._closePopover();
				const trigger = this.shadowRoot?.querySelector< HTMLElement >(
					'.wpd-multiselect__trigger',
				);
				trigger?.focus();
			}
		};
		const onResizeScroll = (): void => this._placePopover();

		// Infinite-scroll: when the popover is itself scrolled past
		// ~80% of its content, ask the consumer for the next page.
		// `loadingMore` and `hasMore` flags gate the emit so we don't
		// re-fire while a fetch is in flight or after the consumer
		// has indicated no more pages remain.
		const onPopoverScroll = (): void => {
			if ( ! this._hasMore || this._loadingMore ) {
				return;
			}
			const sh = popover.scrollHeight;
			const ch = popover.clientHeight;
			const st = popover.scrollTop;
			if ( sh - ( st + ch ) < 64 ) {
				this.emit( 'wpd-multiselect-load-more', {} );
			}
		};

		setTimeout( () => {
			document.addEventListener( 'pointerdown', onDocPointer, true );
		}, 0 );
		document.addEventListener( 'keydown', onKey, true );
		window.addEventListener( 'resize', onResizeScroll );
		window.addEventListener( 'scroll', onResizeScroll, true );
		popover.addEventListener( 'scroll', onPopoverScroll );

		this._teardownOpen = () => {
			document.removeEventListener( 'pointerdown', onDocPointer, true );
			document.removeEventListener( 'keydown', onKey, true );
			window.removeEventListener( 'resize', onResizeScroll );
			window.removeEventListener( 'scroll', onResizeScroll, true );
			popover.removeEventListener( 'scroll', onPopoverScroll );
		};

		this.setAttribute( 'open', '' );
		this.requestUpdate();
		this.emit( 'wpd-multiselect-open', {} );
	}

	private _closePopover(): void {
		if ( this._teardownOpen ) {
			this._teardownOpen();
			this._teardownOpen = null;
		}
		if ( this._popover ) {
			this._popover.remove();
			this._popover = null;
			this.removeAttribute( 'open' );
			this.requestUpdate();
			this.emit( 'wpd-multiselect-close', {} );
		}
	}

	private _refreshPopover(): void {
		const popover = this._popover;
		if ( ! popover ) {
			return;
		}
		const options = this._readOptions();
		const selected = new Set( this._readValues() );
		popover.replaceChildren();

		if ( options.length === 0 ) {
			const empty = document.createElement( 'div' );
			empty.className = 'wpd-multiselect__empty';
			empty.textContent = 'No options';
			popover.appendChild( empty );
			return;
		}

		if ( selected.size > 0 ) {
			const clear = document.createElement( 'button' );
			clear.type = 'button';
			clear.className = 'wpd-multiselect__clear';
			clear.textContent = 'Clear';
			clear.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				e.stopPropagation();
				this._writeValueAttribute( [] );
				this.requestUpdate();
				this._refreshPopover();
				this._emitPick();
			} );
			popover.appendChild( clear );
		}

		for ( const opt of options ) {
			const row = document.createElement( 'label' );
			row.className = 'wpd-multiselect__option';
			row.setAttribute( 'role', 'option' );
			row.setAttribute(
				'aria-selected',
				selected.has( opt.value ) ? 'true' : 'false',
			);
			if ( opt.disabled ) {
				row.setAttribute( 'aria-disabled', 'true' );
				row.dataset.disabled = 'true';
			}
			const cb = document.createElement( 'input' );
			cb.type = 'checkbox';
			cb.checked = selected.has( opt.value );
			cb.disabled = opt.disabled;
			cb.addEventListener( 'change', () => {
				const cur = new Set( this._readValues() );
				if ( cb.checked ) {
					cur.add( opt.value );
				} else {
					cur.delete( opt.value );
				}
				const ordered = options
					.map( ( o ) => o.value )
					.filter( ( v ) => cur.has( v ) );
				this._writeValueAttribute( ordered );
				row.setAttribute(
					'aria-selected',
					cb.checked ? 'true' : 'false',
				);
				this.requestUpdate();
				this._refreshPopover();
				this._emitPick();
			} );
			const labelText = document.createElement( 'span' );
			labelText.textContent = opt.label;
			row.appendChild( cb );
			row.appendChild( labelText );
			popover.appendChild( row );
		}

		// Loading row + a sentinel so the user sees the next-page
		// fetch land on a recognisable surface and the
		// IntersectionObserver / scroll heuristic has a node to
		// anchor to.
		if ( this._loadingMore ) {
			const loading = document.createElement( 'div' );
			loading.className = 'wpd-multiselect__loading';
			const spinner = document.createElement( 'span' );
			spinner.className = 'wpd-multiselect__spinner';
			spinner.setAttribute( 'aria-hidden', 'true' );
			const text = document.createElement( 'span' );
			text.textContent = 'Loading…';
			loading.appendChild( spinner );
			loading.appendChild( text );
			popover.appendChild( loading );
		}
	}

	private _placePopover(): void {
		const popover = this._popover;
		const trigger = this.shadowRoot?.querySelector< HTMLElement >(
			'.wpd-multiselect__trigger',
		);
		if ( ! popover || ! trigger ) {
			return;
		}
		const rect = trigger.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const minW = Math.max( rect.width, 200 );
		popover.style.minWidth = `${ minW }px`;
		let left = rect.left;
		if ( left + minW > vw - 8 ) {
			left = Math.max( 8, vw - minW - 8 );
		}
		popover.style.left = `${ left }px`;
		popover.style.top = `${ rect.bottom + 4 }px`;
		const popH = popover.offsetHeight || 200;
		if ( rect.bottom + 4 + popH > vh - 8 ) {
			popover.style.top = `${ Math.max( 8, rect.top - popH - 4 ) }px`;
		}
	}

	private _emitPick(): void {
		const values = this._readValues();
		this.emit( 'wpd-pick', {
			value: values.join( ',' ),
			values,
		} );
	}
}
defineComponent( 'wpd-multiselect', WpdMultiselect );
