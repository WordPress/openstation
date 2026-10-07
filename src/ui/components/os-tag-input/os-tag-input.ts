import { Component, defineComponent, html } from '../../core';
import { osIcon } from '../../icons';
import { styles } from './os-tag-input.styles';

import '../os-chip/os-chip';

export interface OsTagItem {

	id?: number | string;

	label: string;

	pending?: boolean;

	tone?: 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';
}

export class OsTagInput extends Component {
	static props = [
		'name',
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
		status: 'stable',
		props: [
			{ name: 'name', type: 'string', description: 'Key used by an enclosing os-form to collect, populate and reset this field.' },
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
				description:
					'Label of the trigger button. The button draws its own plus icon, so this is text only — passing "+ Add" puts two pluses on screen.',
				default: 'Add',
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

	private _value: OsTagItem[] = [];
	private _suggestions: OsTagItem[] = [];
	private _suggestionsLoading = false;
	private _query = '';
	private _highlight = -1;
	private _focusedChip = -1;

	private get _input(): HTMLInputElement | null {
		const root = this.shadowRoot;
		return root ? root.querySelector< HTMLInputElement >( '.os-tag-input__input' ) : null;
	}

	get value(): OsTagItem[] {
		return this._value;
	}
	set value( next: readonly OsTagItem[] | null | undefined ) {
		this._value = Array.isArray( next ) ? next.slice() : [];

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

	public openInput(): void {
		if ( this.isOpen ) {
			return;
		}
		( this as unknown as { open: string } ).open = '';
		this._query = '';
		this._highlight = -1;
		this.emit( 'os-tag-open', {} );

		queueMicrotask( () => {
			this._input?.focus();
			this._emitSuggest( '' );
		} );
	}

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

	connectedCallback(): void {
		super.connectedCallback();

		document.addEventListener( 'pointerdown', this._onDocumentPointerDown, true );
	}

	disconnectedCallback(): void {
		document.removeEventListener( 'pointerdown', this._onDocumentPointerDown, true );
	}

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
			'Add';
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
						this.emit( 'os-tag-remove', {
							tag: this._value[ lastIdx ],
						} );
						this._focusedChip = -1;
					} else {
						this._focusedChip = lastIdx;
						this.requestUpdate();
					}
				}
				return;
			}
			default:

				if ( this._focusedChip !== -1 ) {
					this._focusedChip = -1;
				}
		}
	}

	private _onInputBlur( _e: FocusEvent ): void {
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
	return osIcon( 'plus', { size: 14 } );
}
