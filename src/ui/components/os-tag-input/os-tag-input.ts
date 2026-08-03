/**
 * `<os-tag-input>` — multi-tag picker with autocomplete and free-form
 * creation.
 *
 * The component is **purely presentational + event-driven**. It owns
 * the visual layout (chip row + "+ Add" trigger + inline input +
 * suggestions popover) and the keyboard model (Enter/Backspace/
 * Escape/ArrowUp/ArrowDown). Mutations — fetching suggestions,
 * creating tags, persisting to a REST endpoint — are the consumer's
 * job, dispatched via well-typed events:
 *
 *   - `os-tag-suggest` `{ query }` — user typed in the input. The
 *     consumer should fetch suggestions and assign them back via
 *     `el.suggestions = [...]`.
 *   - `os-tag-add` `{ tag, isNew }` — user picked a suggestion or,
 *     when `creatable`, pressed Enter on a query that didn't match
 *     any suggestion (`isNew: true`). The component does NOT mutate
 *     its own `value` — the consumer is the source of truth, and is
 *     expected to update `value` (optimistically) and persist in the
 *     background.
 *   - `os-tag-remove` `{ tag }` — user clicked × on a chip. Same
 *     contract: consumer mutates `value`, runs REST.
 *   - `os-tag-open` / `os-tag-close` — lifecycle of the inline
 *     input. Useful for prefetching the empty-query suggestion list,
 *     or for restoring focus to the parent toolbar on close.
 *
 * The `value` and `suggestions` properties are JS-only (not
 * attribute-mirrored) because they carry structured data with ids.
 *
 * Optimistic UX is supported via `pending: true` on individual tag
 * items — they render with a soft pulse so the user can see "this
 * one's still landing" without us blocking interaction.
 *
 * ```js
 * const picker = document.querySelector( 'os-tag-input' );
 * picker.value = [ { id: 1, label: 'WordPress' } ];
 * picker.creatable = true;
 *
 * picker.addEventListener( 'os-tag-suggest', async ( e ) => {
 *     const list = await searchTags( e.detail.query );
 *     picker.suggestions = list;
 * } );
 * picker.addEventListener( 'os-tag-add', async ( e ) => {
 *     // Optimistic: append + mark pending.
 *     picker.value = [
 *         ...picker.value,
 *         { ...e.detail.tag, pending: true },
 *     ];
 *     try {
 *         const saved = await persistTag( e.detail.tag, e.detail.isNew );
 *         picker.value = picker.value.map( ( t ) =>
 *             t.label === saved.label ? saved : t );
 *     } catch ( err ) {
 *         picker.value = picker.value.filter( ( t ) => t.label !== e.detail.tag.label );
 *         showToast( err.message );
 *     }
 * } );
 * ```
 *
 * @public
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-tag-input.styles';
// Side-effect import — registers `<os-chip>` so callers don't need
// to remember to import it separately.
import '../os-chip/os-chip';

/**
 * One row in the picker. The `id` is opaque to the component — most
 * consumers map it to a server-side id (term id, taxonomy term).
 * Items without an `id` are typically "to be created" entries; the
 * component doesn't care either way.
 */
export interface OsTagItem {
	/** Stable id (term id, etc.). Optional. */
	id?: number | string;
	/** Visible text. Required. */
	label: string;
	/** Render the chip in a "in flight" pulsed state. */
	pending?: boolean;
	/**
	 * Optional `tone` forwarded to the chip. Lets a consumer color
	 * tags by taxonomy / status without knowing the chip API.
	 */
	tone?: 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';
}

export class OsTagInput extends Component {
	static props = [
		'label',
		'placeholder',
		'add-label',
		'creatable',
		'removable',
		'disabled',
		'readonly',
		'size',
		'min-query',
		'open',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Tag input',
		summary:
			'Multi-tag picker with autocomplete and free-form creation. Purely presentational — emits os-tag-suggest / os-tag-add / os-tag-remove and lets the consumer drive REST + optimistic UI.',
		status: 'experimental',
		since: '0.8.0',
		props: [
			{
				name: 'label',
				type: 'string',
				description: 'Accessible label for the inline input.',
			},
			{
				name: 'placeholder',
				type: 'string',
				description: 'Native placeholder for the inline input.',
				default: 'Add a tag…',
			},
			{
				name: 'add-label',
				type: 'string',
				description: 'Label of the "+" trigger button.',
				default: '+ Add',
			},
			{
				name: 'creatable',
				type: 'boolean attribute',
				description:
					'Allow Enter on a non-matching query to emit `os-tag-add` with `isNew: true`. Off by default — opt in for taxonomies the user is allowed to extend.',
			},
			{
				name: 'removable',
				type: 'boolean attribute',
				description:
					'Show × on every chip and emit `os-tag-remove` on click. On by default; switch off for read-only views.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description:
					'Disables the entire control. Chips render but the trigger / input / dismiss buttons are inert.',
			},
			{
				name: 'readonly',
				type: 'boolean attribute',
				description:
					'Hides the "+" trigger and chip × buttons. Same as setting `creatable=false` and `removable=false` together.',
			},
			{
				name: 'size',
				type: "'default' | 'compact'",
				default: 'default',
				description: 'Density preset. Compact suits dense table cells.',
			},
			{
				name: 'min-query',
				type: 'integer (string)',
				default: '0',
				description:
					'Minimum query length before `os-tag-suggest` fires. Set to 1 or 2 for taxonomies with thousands of terms.',
			},
			{
				name: 'open',
				type: 'boolean attribute',
				description:
					'Two-way reflected: present while the inline input is showing. Setting it externally opens / closes the picker.',
			},
		],
		events: [
			{
				name: 'os-tag-suggest',
				description:
					'Fires when the user types in the input. Consumer fetches suggestions and assigns them back via `el.suggestions = […]`.',
				detail: '{ query: string }',
			},
			{
				name: 'os-tag-add',
				description:
					'Fires when the user picks a suggestion or, with `creatable`, presses Enter on a free-form value. Consumer mutates `value`.',
				detail: '{ tag: OsTagItem; isNew: boolean }',
			},
			{
				name: 'os-tag-remove',
				description:
					'Fires when × on a chip is activated. Consumer mutates `value`.',
				detail: '{ tag: OsTagItem }',
			},
			{
				name: 'os-tag-open',
				description: 'Fires when the inline input opens.',
				detail: '{}',
			},
			{
				name: 'os-tag-close',
				description: 'Fires when the inline input closes.',
				detail: '{}',
			},
		],
		cssProps: [
			{
				name: '--os-ui-tag-input-gap',
				description: 'Gap between chips / between chips and trigger.',
				default: '4px',
			},
			{
				name: '--os-ui-tag-input-padding',
				description: 'Padding around the chip row.',
				default: '2px',
			},
			{
				name: '--os-ui-tag-input-add-fg',
				description: 'Foreground color of the "+ Add" trigger.',
			},
			{ name: '--os-ui-tag-input-pop-bg', description: 'Suggestions popover background.' },
		],
		example: html`
			<os-tag-input
				label="Tags"
				placeholder="Add a tag…"
				creatable
			></os-tag-input>
		`,
	} as const;

	// --- Private state ----------------------------------------------------

	private _value: OsTagItem[] = [];
	private _suggestions: OsTagItem[] = [];
	private _suggestionsLoading = false;
	private _query = '';
	private _highlight = -1;
	private _focusedChip = -1;

	// Resolves to the inline input AFTER each render. Re-queried on
	// every `requestUpdate` because the shadow tree builds fresh
	// nodes per render.
	private get _input(): HTMLInputElement | null {
		const root = this.shadowRoot;
		return root ? root.querySelector< HTMLInputElement >( '.os-tag-input__input' ) : null;
	}

	// --- Public properties (JS-only) -------------------------------------

	get value(): OsTagItem[] {
		return this._value;
	}
	set value( next: readonly OsTagItem[] | null | undefined ) {
		this._value = Array.isArray( next ) ? next.slice() : [];
		// Selection invariant: stop "deleting backwards" pointing at a
		// chip that no longer exists.
		if ( this._focusedChip >= this._value.length ) {
			this._focusedChip = -1;
		}
		this.requestUpdate();
	}

	get suggestions(): OsTagItem[] {
		return this._suggestions;
	}
	set suggestions( next: readonly OsTagItem[] | null | undefined ) {
		this._suggestions = Array.isArray( next ) ? next.slice() : [];
		// Reset highlight to first match on every fresh batch.
		this._highlight = this._suggestions.length > 0 ? 0 : -1;
		this._suggestionsLoading = false;
		this.requestUpdate();
	}

	get suggestionsLoading(): boolean {
		return this._suggestionsLoading;
	}
	set suggestionsLoading( next: boolean ) {
		this._suggestionsLoading = !! next;
		this.requestUpdate();
	}

	get query(): string {
		return this._query;
	}

	get isOpen(): boolean {
		return ( this as unknown as { open: string | null } ).open !== null;
	}

	/**
	 * Open the inline input + suggestions popover. Equivalent to
	 * clicking the "+" trigger. Call from the parent to start tag
	 * entry programmatically (e.g. paste interception).
	 */
	public openInput(): void {
		if ( this.isOpen ) {
			return;
		}
		( this as unknown as { open: string } ).open = '';
		this._query = '';
		this._highlight = -1;
		this.emit( 'os-tag-open', {} );
		// Move focus + emit the empty-query suggest so the consumer
		// can prime the popover with recent / popular tags.
		queueMicrotask( () => {
			this._input?.focus();
			this._emitSuggest( '' );
		} );
	}

	/**
	 * Close the inline input. Use from a parent to dismiss after a
	 * background save resolves.
	 */
	public closeInput(): void {
		if ( ! this.isOpen ) {
			return;
		}
		( this as unknown as { open: null } ).open = null;
		this._query = '';
		this._suggestions = [];
		this._highlight = -1;
		this._suggestionsLoading = false;
		this.emit( 'os-tag-close', {} );
		this.requestUpdate();
	}

	// --- Lifecycle --------------------------------------------------------

	connectedCallback(): void {
		super.connectedCallback();
		// Click-outside closes the input. We listen on the document
		// (capture so we beat any stopPropagation()) and consult
		// composedPath() to see if the click crossed our shadow
		// boundary.
		document.addEventListener( 'pointerdown', this._onDocumentPointerDown, true );
	}

	disconnectedCallback(): void {
		document.removeEventListener( 'pointerdown', this._onDocumentPointerDown, true );
	}

	// --- Render -----------------------------------------------------------

	protected render() {
		const isOpen = this.isOpen;
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const readonly =
			( this as unknown as { readonly: string | null } ).readonly !== null;
		const removable =
			( this as unknown as { removable: string | null } ).removable !== null ||
			( ( this as unknown as { removable: string | null } ).removable === null &&
				! readonly );
		const creatable =
			( this as unknown as { creatable: string | null } ).creatable !== null;
		const addLabel =
			( this as unknown as { 'add-label': string | null } )[ 'add-label' ] ||
			'+ Add';
		const placeholder =
			( this as unknown as { placeholder: string | null } ).placeholder ||
			'Add a tag…';

		return html`
			<span
				class="os-tag-input"
				role="group"
				aria-label=${ ( this as unknown as { label: string | null } ).label ?? '' }
			>
				${ this._renderChips( removable, disabled ) }
				${ this._renderTrailing( {
					isOpen,
					readonly,
					disabled,
					placeholder,
					creatable,
					addLabel,
				} ) }
			</span>
		`;
	}

	private _renderTrailing( opts: {
		isOpen: boolean;
		readonly: boolean;
		disabled: boolean;
		placeholder: string;
		creatable: boolean;
		addLabel: string;
	} ) {
		if ( opts.isOpen ) {
			return this._renderEditor( opts.placeholder, opts.creatable );
		}
		if ( opts.readonly || opts.disabled ) {
			return html``;
		}
		return this._renderTrigger( opts.addLabel );
	}

	private _renderChips( removable: boolean, disabled: boolean ) {
		const tags = this._value;
		if ( tags.length === 0 ) {
			return html``;
		}
		return html`
			<span class="os-tag-input__chips" role="list">
				${ tags.map( ( tag, idx ) => {
					const tone = tag.tone ?? 'neutral';
					return html`
						<os-chip
							role="listitem"
							size="compact"
							tone=${ tone }
							label=${ tag.label }
							?dismissible=${ removable && ! disabled }
							?disabled=${ disabled }
							?pending=${ !! tag.pending }
							tabindex=${ idx === this._focusedChip ? '0' : '-1' }
							data-idx=${ String( idx ) }
							@os-chip-dismiss=${ ( e: Event ) => this._onChipDismiss( e, tag ) }
							@focus=${ () => ( this._focusedChip = idx ) }
						></os-chip>
					`;
				} ) }
			</span>
		`;
	}

	private _renderTrigger( addLabel: string ) {
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		return html`
			<button
				type="button"
				class="os-tag-input__add"
				aria-label=${ addLabel }
				aria-haspopup="listbox"
				aria-expanded="false"
				?disabled=${ disabled }
				@click=${ () => this.openInput() }
			>
				${ _iconPlus() }
				<span>${ addLabel }</span>
			</button>
		`;
	}

	private _renderEditor( placeholder: string, creatable: boolean ) {
		const showSuggestions =
			this._suggestions.length > 0 ||
			this._suggestionsLoading ||
			( creatable && this._query.trim().length > 0 );

		return html`
			<span class="os-tag-input__editor">
				<input
					class="os-tag-input__input"
					type="text"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					placeholder=${ placeholder }
					.value=${ this._query }
					aria-autocomplete="list"
					aria-expanded=${ showSuggestions ? 'true' : 'false' }
					aria-activedescendant=${ this._highlight >= 0
						? `os-tag-suggestion-${ this._highlight }`
						: '' }
					@input=${ ( e: Event ) => this._onInput( e ) }
					@keydown=${ ( e: KeyboardEvent ) => this._onInputKeyDown( e ) }
					@blur=${ ( e: FocusEvent ) => this._onInputBlur( e ) }
				/>
				${ showSuggestions
					? this._renderSuggestions( creatable )
					: html`` }
			</span>
		`;
	}

	private _renderSuggestions( creatable: boolean ) {
		const trimmed = this._query.trim();
		const items = this._suggestions;
		const showCreate =
			creatable &&
			trimmed.length > 0 &&
			! items.some( ( s ) => s.label.toLowerCase() === trimmed.toLowerCase() ) &&
			! this._value.some( ( v ) => v.label.toLowerCase() === trimmed.toLowerCase() );

		return html`
			<div
				class="os-tag-input__suggestions"
				role="listbox"
			>
				${ this._suggestionsLoading
					? html`
							<div class="os-tag-input__suggestion-loading">
								<span class="os-tag-input__suggestion-spinner" aria-hidden="true"></span>
								<span>Searching…</span>
							</div>
					  `
					: html`` }
				${ items.length === 0 && ! this._suggestionsLoading && ! showCreate
					? html`
							<div class="os-tag-input__suggestion-empty">
								${ trimmed.length > 0 ? 'No matches.' : 'Type to search.' }
							</div>
					  `
					: html`` }
				${ items.map( ( item, idx ) => {
					const selected = idx === this._highlight;
					return html`
						<div
							id=${ `os-tag-suggestion-${ idx }` }
							role="option"
							aria-selected=${ selected ? 'true' : 'false' }
							class="os-tag-input__suggestion-item"
							@mousedown=${ ( e: MouseEvent ) => {
								// `mousedown` (not `click`) so the input
								// doesn't blur out from under us before the
								// click resolves.
								e.preventDefault();
								this._addSuggestion( item, false );
							} }
							@mouseenter=${ () => {
								this._highlight = idx;
								this.requestUpdate();
							} }
						>
							<span>${ item.label }</span>
						</div>
					`;
				} ) }
				${ showCreate
					? html`
							<div
								id=${ `os-tag-suggestion-${ items.length }` }
								role="option"
								aria-selected=${ this._highlight === items.length ? 'true' : 'false' }
								class="os-tag-input__suggestion-item os-tag-input__suggestion-create"
								@mousedown=${ ( e: MouseEvent ) => {
									e.preventDefault();
									this._addSuggestion(
										{ label: trimmed },
										true,
									);
								} }
								@mouseenter=${ () => {
									this._highlight = items.length;
									this.requestUpdate();
								} }
							>
								Create "${ trimmed }"
							</div>
					  `
					: html`` }
			</div>
		`;
	}

	// --- Event handlers ---------------------------------------------------

	private _onChipDismiss( e: Event, tag: OsTagItem ): void {
		e.stopPropagation();
		this.emit( 'os-tag-remove', { tag } );
	}

	private _onInput( e: Event ): void {
		const value = ( e.target as HTMLInputElement ).value;
		this._query = value;
		this._emitSuggest( value );
	}

	private _emitSuggest( query: string ): void {
		const minQuery =
			parseInt(
				( this as unknown as { 'min-query': string | null } )[ 'min-query' ] || '0',
				10,
			) || 0;
		if ( query.length < minQuery ) {
			this._suggestions = [];
			this._suggestionsLoading = false;
			this.requestUpdate();
			return;
		}
		this._suggestionsLoading = true;
		this.requestUpdate();
		this.emit( 'os-tag-suggest', { query } );
	}

	private _onInputKeyDown( e: KeyboardEvent ): void {
		const creatable =
			( this as unknown as { creatable: string | null } ).creatable !== null;
		const items = this._suggestions;
		const trimmed = this._query.trim();
		const showCreate =
			creatable &&
			trimmed.length > 0 &&
			! items.some( ( s ) => s.label.toLowerCase() === trimmed.toLowerCase() ) &&
			! this._value.some( ( v ) => v.label.toLowerCase() === trimmed.toLowerCase() );
		const totalSelectable = items.length + ( showCreate ? 1 : 0 );

		switch ( e.key ) {
			case 'ArrowDown': {
				if ( totalSelectable === 0 ) {
					return;
				}
				e.preventDefault();
				this._highlight =
					this._highlight + 1 >= totalSelectable
						? 0
						: this._highlight + 1;
				this.requestUpdate();
				return;
			}
			case 'ArrowUp': {
				if ( totalSelectable === 0 ) {
					return;
				}
				e.preventDefault();
				this._highlight =
					this._highlight <= 0
						? totalSelectable - 1
						: this._highlight - 1;
				this.requestUpdate();
				return;
			}
			case 'Enter': {
				e.preventDefault();
				if ( this._highlight >= 0 && this._highlight < items.length ) {
					this._addSuggestion( items[ this._highlight ], false );
					return;
				}
				if (
					this._highlight === items.length &&
					showCreate
				) {
					this._addSuggestion( { label: trimmed }, true );
					return;
				}
				if ( showCreate && trimmed.length > 0 ) {
					this._addSuggestion( { label: trimmed }, true );
					return;
				}
				return;
			}
			case 'Escape': {
				e.preventDefault();
				this.closeInput();
				return;
			}
			case 'Backspace': {
				if ( this._query === '' && this._value.length > 0 ) {
					e.preventDefault();
					const lastIdx = this._value.length - 1;
					if ( this._focusedChip === lastIdx ) {
						// Second backspace on empty input → remove the
						// already-focused chip. Confirms intent.
						this.emit( 'os-tag-remove', {
							tag: this._value[ lastIdx ],
						} );
						this._focusedChip = -1;
					} else {
						// First backspace on empty input → focus the
						// last chip without removing.
						this._focusedChip = lastIdx;
						this.requestUpdate();
					}
				}
				return;
			}
			default:
				// Any other keypress reverts the chip-focus heuristic so
				// typing after a Backspace doesn't inadvertently remove.
				if ( this._focusedChip !== -1 ) {
					this._focusedChip = -1;
				}
		}
	}

	private _onInputBlur( _e: FocusEvent ): void {
		// Blur usually means the user is done. Close after a tick so
		// a click on a suggestion (which fires `mousedown` first, then
		// blur, then click) still has time to resolve. The
		// `mousedown` handler on suggestions calls `preventDefault`,
		// so a real suggestion-click never blurs. This branch only
		// catches "user tabbed/clicked away".
		queueMicrotask( () => {
			if ( ! this.shadowRoot?.activeElement ) {
				this.closeInput();
			}
		} );
	}

	private _onDocumentPointerDown = ( e: Event ): void => {
		if ( ! this.isOpen ) {
			return;
		}
		const path = ( e as PointerEvent ).composedPath();
		if ( path.includes( this ) ) {
			return;
		}
		this.closeInput();
	};

	private _addSuggestion( tag: OsTagItem, isNew: boolean ): void {
		// De-dupe — a consumer that hasn't refreshed `value` yet would
		// otherwise add the same label twice. Comparison by label
		// (lowercased) handles the "user typed 'WordPress' but the
		// REST term came back as 'wordpress'" case.
		const exists = this._value.some(
			( v ) => v.label.toLowerCase() === tag.label.toLowerCase(),
		);
		if ( exists ) {
			this._query = '';
			this._highlight = -1;
			this._suggestions = [];
			this.requestUpdate();
			this._input?.focus();
			return;
		}

		this.emit( 'os-tag-add', { tag, isNew } );

		// Stay open so the user can keep adding tags. Reset the input
		// + suggestions; the consumer will push the new tag into
		// `value` on the next tick.
		this._query = '';
		this._highlight = -1;
		this._suggestions = [];
		this._suggestionsLoading = false;
		this.requestUpdate();
		queueMicrotask( () => {
			this._input?.focus();
		} );
	}
}
defineComponent( 'os-tag-input', OsTagInput );

function _iconPlus() {
	return html`
		<svg
			viewBox="0 0 12 12"
			width="9"
			height="9"
			aria-hidden="true"
			focusable="false"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<path d="M6 2 L6 10 M2 6 L10 6" />
		</svg>
	`;
}
