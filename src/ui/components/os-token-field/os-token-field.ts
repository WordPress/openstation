/**
 * `<os-token-field>` — a text field whose value contains tokens, and
 * a catalogue for discovering them.
 *
 * Anything templated has this problem. An email body accepts
 * `{field:f2}`, a webhook payload accepts `{all_fields}`, a filename
 * pattern accepts `{date}` — and the syntax is undiscoverable, so
 * every plugin that has one grows the same three things: a picker
 * listing what's available, a note about what each one means, and
 * some way to see what you're actually going to get.
 *
 * ```js
 * const field = document.querySelector( 'os-token-field' );
 * field.value = 'Hi {field:1}, we got your entry.';
 * field.tokens = [
 *     { group: 'Questions', label: 'Full name', token: '{field:1}', sample: 'Ada Lovelace' },
 *     { group: 'Questions', label: 'Email',     token: '{field:2}', sample: 'ada@example.com' },
 *     { group: 'Form',      token: '{all_fields}', label: 'All answers' },
 * ];
 *
 * field.addEventListener( 'os-token-field-input', ( e ) => save( e.detail.value ) );
 * ```
 *
 * **Insertion is at the caret**, not at the end — a token is usually
 * wanted mid-sentence, and a picker that appends to the end makes
 * the user cut and paste it into place. After inserting, focus and
 * selection return to just past the token so typing continues where
 * the user was.
 *
 * **The preview is the discoverability.** Tokens that carry a
 * `sample` render a "reads as" line under the field with the samples
 * substituted, so the user sees the shape of the result before
 * saving. It is deliberately a plain substitution: this component
 * cannot know the server's templating rules, and a preview that
 * pretends to be authoritative is worse than one that is obviously
 * an illustration. Tokens with no `sample` are left as-is in the
 * preview, which reads correctly as "this one resolves elsewhere".
 *
 * The consumer owns `value`. Like `<os-tag-input>`, this component
 * reports intent and never writes to its own value property behind
 * the consumer's back — except through the field's own native
 * editing, which is the user typing and is echoed on
 * `os-token-field-input`.
 *
 * @public
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './os-token-field.styles';
import '../os-button/os-button';
import '../os-icon/os-icon';

/** One row in the catalogue. */
export interface OsTokenDefinition {
	/**
	 * The literal inserted into the value — `{field:2}`,
	 * `%%first_name%%`, `${order.total}`. Opaque to the component.
	 */
	token: string;
	/** Human name shown in the picker. */
	label: string;
	/** Section heading. Rows with no group sort last, ungrouped. */
	group?: string;
	/**
	 * What this resolves to on this site — used for the "reads as"
	 * preview and shown next to the label. Omit for a token whose
	 * value can't be known up front; the preview then leaves the
	 * token visible.
	 */
	sample?: string;
	/** Longer explanation shown under the label in the picker. */
	description?: string;
}

export class OsTokenField extends Component {
	static props = [
		'label',
		'placeholder',
		'hint',
		'multiline',
		'rows',
		'disabled',
		'readonly',
		'insert-label',
		'preview-label',
		'open',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Token field',
		summary:
			'A text or multiline field whose value contains tokens, with a grouped catalogue that inserts at the caret and a live "reads as" preview built from each token\'s sample.',
		status: 'stable',
		props: [
			{
				name: 'tokens',
				type: 'OsTokenDefinition[] (JS property)',
				description:
					'The catalogue: `{ token, label, group?, sample?, description? }`.',
			},
			{
				name: 'value',
				type: 'string (JS property)',
				description: 'Field contents. The consumer owns it.',
			},
			{
				name: 'label',
				type: 'string',
				description: 'Field label.',
			},
			{
				name: 'multiline',
				type: 'boolean',
				default: 'false',
				description: 'Render a textarea instead of an input.',
			},
			{
				name: 'rows',
				type: 'number',
				default: '4',
				description: 'Textarea height, when `multiline`.',
			},
			{
				name: 'insert-label',
				type: 'string',
				default: 'Insert a value',
				description: 'Label on the catalogue trigger.',
			},
			{
				name: 'preview-label',
				type: 'string',
				default: 'Reads as',
				description:
					'Lead-in for the preview line. The preview is hidden when no token in the value carries a sample.',
			},
			{
				name: 'hint',
				type: 'string',
				description: 'Help text under the field, above the preview.',
			},
			{ name: 'disabled', type: 'boolean', default: 'false' },
			{ name: 'readonly', type: 'boolean', default: 'false' },
		],
		events: [
			{
				name: 'os-token-field-input',
				description:
					'Value changed, by typing or by insertion. Detail: `{ value }`.',
			},
			{
				name: 'os-token-insert',
				description:
					'A token was picked from the catalogue. Detail: `{ token, value }` — fires alongside the input event, for consumers that want to count or log usage.',
			},
		],
		slots: [
			{
				name: 'action',
				description: 'Extra controls on the toolbar, beside the trigger.',
			},
		],
		cssProps: [
			{ name: '--os-ui-field-bg' },
			{ name: '--os-ui-field-border' },
			{ name: '--os-ui-field-fg' },
			{ name: '--os-ui-token-field-chip-bg', description: 'Token pill in the preview.' },
		],
		example: html`
			<os-token-field
				label="Notification body"
				multiline
				placeholder="Hi {field:1}…"
			></os-token-field>
		`,
	} as const;

	private _tokens: OsTokenDefinition[] = [];
	private _value = '';
	/** Caret at the moment the catalogue opened — insertion point. */
	private caret: { start: number; end: number } | null = null;

	/** The catalogue. */
	public get tokens(): OsTokenDefinition[] {
		return this._tokens;
	}
	public set tokens( next: readonly OsTokenDefinition[] ) {
		this._tokens = Array.isArray( next ) ? [ ...next ] : [];
		this.requestUpdate();
	}

	/** Field contents. */
	public get value(): string {
		return this._value;
	}
	public set value( next: string ) {
		this._value = typeof next === 'string' ? next : '';
		const field = this.field;
		// Keep the live control in step when the consumer assigns
		// while the user is elsewhere. Guarded so an assignment that
		// echoes what the user just typed doesn't reset their caret.
		if ( field && field.value !== this._value ) {
			field.value = this._value;
		}
		this.requestUpdate();
	}

	private get field(): HTMLInputElement | HTMLTextAreaElement | null {
		return (
			this.shadowRoot?.querySelector< HTMLInputElement | HTMLTextAreaElement >(
				'.os-token-field__input',
			) ?? null
		);
	}

	private get isOpen(): boolean {
		return this.hasAttribute( 'open' );
	}

	/** Catalogue rows in group order, ungrouped last. */
	private grouped(): Array< [ string, OsTokenDefinition[] ] > {
		const groups = new Map< string, OsTokenDefinition[] >();
		for ( const def of this._tokens ) {
			const key = def.group ?? '';
			const bucket = groups.get( key );
			if ( bucket ) {
				bucket.push( def );
			} else {
				groups.set( key, [ def ] );
			}
		}
		return [ ...groups.entries() ].sort( ( a, b ) => {
			if ( a[ 0 ] === '' ) {
				return 1;
			}
			if ( b[ 0 ] === '' ) {
				return -1;
			}
			return 0;
		} );
	}

	/**
	 * The value with every token that has a sample replaced by it.
	 *
	 * Returns `null` when nothing would change — no tokens present,
	 * or none of the present ones carry a sample — which is the
	 * signal to hide the preview rather than echo the input back at
	 * the user.
	 */
	private preview(): string | null {
		let out = this._value;
		let substituted = false;
		for ( const def of this._tokens ) {
			if ( ! def.sample || ! out.includes( def.token ) ) {
				continue;
			}
			out = out.split( def.token ).join( def.sample );
			substituted = true;
		}
		return substituted ? out : null;
	}

	private onInput = ( e: Event ): void => {
		const field = e.target as HTMLInputElement | HTMLTextAreaElement;
		this._value = field.value;
		this.emit( 'os-token-field-input', { value: this._value } );
		this.requestUpdate();
	};

	/**
	 * Remember where the caret is on every interaction, because by
	 * the time a token is picked the field has lost focus to the
	 * catalogue and `selectionStart` reads 0 — which would insert
	 * every token at the very beginning.
	 */
	private rememberCaret = (): void => {
		const field = this.field;
		if ( ! field ) {
			return;
		}
		this.caret = {
			start: field.selectionStart ?? field.value.length,
			end: field.selectionEnd ?? field.value.length,
		};
	};

	private toggleCatalogue = (): void => {
		// Guarded here and not only on the trigger: `disabled` on a
		// custom element is an attribute, not the native semantics,
		// so the click still arrives. A readonly field must not offer
		// insertion either — the catalogue's only purpose is to write
		// into a value the user isn't allowed to change.
		if ( this.hasAttribute( 'disabled' ) || this.hasAttribute( 'readonly' ) ) {
			return;
		}
		if ( this.isOpen ) {
			this.removeAttribute( 'open' );
			return;
		}
		this.rememberCaret();
		this.setAttribute( 'open', '' );
	};

	private insert( def: OsTokenDefinition ): void {
		const field = this.field;
		const at = this.caret ?? {
			start: this._value.length,
			end: this._value.length,
		};
		const before = this._value.slice( 0, at.start );
		const after = this._value.slice( at.end );
		this._value = `${ before }${ def.token }${ after }`;
		this.removeAttribute( 'open' );

		if ( field ) {
			field.value = this._value;
		}
		this.emit( 'os-token-insert', { token: def.token, value: this._value } );
		this.emit( 'os-token-field-input', { value: this._value } );
		this.requestUpdate();

		// Put the user back where they were, just past what we
		// inserted, on the next frame — the re-render has to land
		// first or the selection is set on a control about to be
		// replaced.
		const caretAt = before.length + def.token.length;
		this.caret = { start: caretAt, end: caretAt };
		queueMicrotask( () => {
			const live = this.field;
			live?.focus();
			live?.setSelectionRange?.( caretAt, caretAt );
		} );
	}

	private onKeydown = ( e: KeyboardEvent ): void => {
		if ( e.key === 'Escape' && this.isOpen ) {
			e.stopPropagation();
			this.removeAttribute( 'open' );
			this.field?.focus();
		}
	};

	protected render() {
		const label = ( this as unknown as { label: string | null } ).label || '';
		const hint = ( this as unknown as { hint: string | null } ).hint || '';
		const placeholder =
			( this as unknown as { placeholder: string | null } ).placeholder || '';
		// Kebab props live under their literal name — the base class
		// defines the accessor from the `static props` string and
		// only kebab-cases the ATTRIBUTE, so `this.insertLabel` would
		// be undefined and quietly fall back to the default.
		const attrs = this as unknown as Record< string, string | null >;
		const insertLabel = attrs[ 'insert-label' ] || 'Insert a value';
		const previewLabel = attrs[ 'preview-label' ] || 'Reads as';
		const multiline = this.hasAttribute( 'multiline' );
		const disabled = this.hasAttribute( 'disabled' );
		const readonly = this.hasAttribute( 'readonly' );
		const rows = Number( this.getAttribute( 'rows' ) ) || 4;
		const preview = this.preview();
		const groups = this.grouped();

		const control = multiline
			? html`<textarea
					class="os-token-field__input"
					rows=${ rows }
					placeholder=${ placeholder }
					?disabled=${ disabled }
					?readonly=${ readonly }
					.value=${ this._value }
					@input=${ this.onInput }
					@keyup=${ this.rememberCaret }
					@click=${ this.rememberCaret }
					@blur=${ this.rememberCaret }
			  ></textarea>`
			: html`<input
					type="text"
					class="os-token-field__input"
					placeholder=${ placeholder }
					?disabled=${ disabled }
					?readonly=${ readonly }
					.value=${ this._value }
					@input=${ this.onInput }
					@keyup=${ this.rememberCaret }
					@click=${ this.rememberCaret }
					@blur=${ this.rememberCaret }
			  />`;

		return html`
			<div class="os-token-field" @keydown=${ this.onKeydown }>
				${ label
		? html`<span class="os-token-field__label">${ label }</span>`
		: null }
				${ control }
				<div class="os-token-field__toolbar">
					<os-button
						variant="ghost"
						size="small"
						?disabled=${ disabled || readonly || groups.length === 0 }
						aria-expanded=${ this.isOpen ? 'true' : 'false' }
						@click=${ this.toggleCatalogue }
					>
						<os-icon name="editor-code" size="14"></os-icon>
						${ insertLabel }
					</os-button>
					<slot name="action"></slot>
				</div>
				${ this.isOpen
		? html`<div
							class="os-token-field__catalogue"
							role="listbox"
							aria-label=${ insertLabel }
					  >
							${ groups.map(
			( [ group, defs ] ) => html`
									${ group
				? html`<p class="os-token-field__group">${ group }</p>`
				: null }
									${ defs.map(
				( def ) => html`
											<button
												type="button"
												role="option"
												class="os-token-field__option"
												@click=${ () => this.insert( def ) }
											>
												<span class="os-token-field__option-label"
													>${ def.label }</span
												>
												<code class="os-token-field__option-token"
													>${ def.token }</code
												>
												${ def.sample
					? html`<span class="os-token-field__option-sample"
															>${ def.sample }</span
													  >`
					: null }
												${ def.description
					? html`<span
															class="os-token-field__option-description"
															>${ def.description }</span
													  >`
					: null }
											</button>
										`,
			) }
								`,
		) }
					  </div>`
		: null }
				${ hint
		? html`<p class="os-token-field__hint">${ hint }</p>`
		: null }
				${ preview !== null
		? html`<p class="os-token-field__preview">
							<span class="os-token-field__preview-label"
								>${ previewLabel }</span
							>
							<span class="os-token-field__preview-body">${ preview }</span>
					  </p>`
		: null }
			</div>
		`;
	}
}
defineComponent( 'os-token-field', OsTokenField );
