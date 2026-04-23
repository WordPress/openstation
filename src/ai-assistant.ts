/**
 * Desktop Mode — AI Assistant spotlight overlay.
 *
 * A conversational assistant panel opened with Cmd+K. The user types any
 * natural-language request — "find my post about Málaga", "where can I
 * see categories?", "do I have any spam comments?" — and the server-side
 * agent loop picks the right tools and returns one of three answer types:
 *
 *   - entity:     a matching post / page / comment; opens in a legacy
 *                 (iframe) window via wp.desktop.windowManager.open().
 *   - navigation: 1-3 wp-admin destinations; each opens in a legacy
 *                 window on click.
 *   - chat:       a plain conversational message; just rendered as text.
 *
 * The overlay stays open until the user explicitly closes it with the ×
 * button, the Escape key, or Cmd+K again.
 *
 * @since 0.14.0
 */

import { HOOKS, doAction, applyFilters } from './hooks';
import {
	filterCommands,
	findCommand,
	parseCommandInput,
	subscribeCommands,
	type CommandContext,
	type CommandResult,
	type CommandSuggestion,
	type DesktopCommand,
} from './commands';

// ---------------------------------------------------------------------------
// Minimal Markdown renderer
// ---------------------------------------------------------------------------
//
// AI responses arrive with basic markdown — **bold**, *italic*, `code`,
// bullet / ordered lists, and [link](url) tokens. WordPress has no
// built-in JS markdown parser and pulling in a library just for this
// would add ~40 kB, so we hand-roll a minimal subset that covers the
// shapes the agent actually emits.
//
// Safety: every input passes through HTML escaping FIRST, then markdown
// tokens are re-interpreted into safe HTML. URLs are filtered to
// http/https only — no javascript:, data:, or vbscript: links reach
// the DOM. Result is safe to set as innerHTML.
//
// Intentionally NOT supported (to keep it minimal):
//   - fenced code blocks (```)
//   - headings (# ## ###)
//   - tables, blockquotes, images, nested lists
//
// If the agent produces any of those they'll appear as literal text —
// harmless. The system prompt steers toward short, conversational
// responses where these don't typically appear.

/** HTML-escape text for safe interpolation into innerHTML contexts. */
function escapeHtmlForMd( s: string ): string {
	return s
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

/** Apply inline markdown tokens to an already-escaped string. */
function renderInlineMd( s: string ): string {
	return s
		// Links [text](url) — must run first so URLs don't get
		// interpreted as other tokens. Reject non-http(s) schemes.
		.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			( _m, label: string, url: string ) => {
				if ( ! /^https?:\/\//i.test( url.trim() ) ) {
					return label;
				}
				return `<a href="${ url.trim() }" target="_blank" rel="noopener noreferrer">${ label }</a>`;
			},
		)
		// Bold **text** — run before italic so ** doesn't partially match *.
		.replace( /\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>' )
		// Italic *text* (single asterisk, word-boundary guarded).
		.replace( /(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, '<em>$1</em>' )
		// Italic _text_.
		.replace( /(?<![_\w])_([^_\n]+?)_(?![_\w])/g, '<em>$1</em>' )
		// Inline code `snippet`.
		.replace( /`([^`\n]+?)`/g, '<code>$1</code>' );
}

/**
 * Render a short markdown string to safe HTML.
 *
 * @param md Raw markdown-ish text (typically an AI response).
 * @return HTML string, safe to set via innerHTML.
 */
function renderMarkdown( md: string ): string {
	if ( ! md ) {
		return '';
	}

	// Escape first so user / model text can't inject markup.
	const safe = escapeHtmlForMd( md );

	// Split into paragraph blocks on blank lines.
	const blocks = safe.split( /\n\s*\n/ );
	const out: string[] = [];

	for ( const raw of blocks ) {
		const lines = raw.split( /\n/ ).map( ( l ) => l.trim() ).filter( ( l ) => l !== '' );
		if ( lines.length === 0 ) {
			continue;
		}

		const isUL = lines.every( ( l ) => /^[-*]\s+/.test( l ) );
		const isOL = lines.every( ( l ) => /^\d+\.\s+/.test( l ) );

		if ( isUL ) {
			const items = lines.map(
				( l ) => `<li>${ renderInlineMd( l.replace( /^[-*]\s+/, '' ) ) }</li>`,
			);
			out.push( `<ul>${ items.join( '' ) }</ul>` );
		} else if ( isOL ) {
			const items = lines.map(
				( l ) => `<li>${ renderInlineMd( l.replace( /^\d+\.\s+/, '' ) ) }</li>`,
			);
			out.push( `<ol>${ items.join( '' ) }</ol>` );
		} else {
			// Paragraph. Single \n inside a paragraph becomes <br>.
			out.push( `<p>${ renderInlineMd( lines.join( '<br>' ) ) }</p>` );
		}
	}

	return out.join( '' );
}

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

const ICON_SPARKLE = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false" fill="currentColor">
	<path d="M10 2 L11.8 7.8 L17.5 9.5 L11.8 11.2 L10 17 L8.2 11.2 L2.5 9.5 L8.2 7.8 Z"/>
</svg>`;

const ICON_CLOSE = `<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">
	<line x1="2" y1="2" x2="12" y2="12"/>
	<line x1="12" y1="2" x2="2" y2="12"/>
</svg>`;

const ICON_RETURN = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<polyline points="14,4 14,10 3,10"/>
	<polyline points="6,7 3,10 6,13"/>
</svg>`;

const ICON_SPINNER = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="wp-desktop-ai__spinner-icon">
	<circle cx="10" cy="10" r="7" stroke-opacity="0.25"/>
	<path d="M10 3 A7 7 0 0 1 17 10" stroke-opacity="1"/>
</svg>`;

const ICON_ARROW = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<polyline points="6,3 11,8 6,13"/>
</svg>`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiAssistantApi {
	open(): void;
	close(): void;
	toggle(): void;
	readonly isOpen: boolean;
}

type AnswerType = 'entity' | 'navigation' | 'chat';

interface SearchResult {
	answer_type: AnswerType;
	message: string;
	entity: EntityDetail | null;
	admin_links: AdminLink[] | null;
	iterations: number;
	exhausted: boolean;
	continue: ContinueHint | null;
}

interface EntityDetail {
	id: number;
	type: 'post' | 'page' | 'comment';
	title?: string;
	excerpt?: string;
	post_title?: string;
	post_url?: string;
	ai_summary: string;
	topic: string;
	url: string;
	edit_url: string;
	date?: string;
	harmful?: boolean;
	spam?: boolean;
}

interface AdminLink {
	title: string;
	url: string;
	description: string;
	icon: string;
}

interface ContinueHint {
	tool: string;
	entity_type: string;
	offset: number;
	label: string;
}

// Minimal shape of the window manager we use — avoids pulling full types.
interface WindowManagerLite {
	open( cfg: {
		id?: string;
		url: string;
		title: string;
		icon?: string;
		native?: boolean;
	} ): unknown;
}

// ---------------------------------------------------------------------------
// Suggested prompts — shown under the input when there's no result yet.
// Kept short so the panel stays compact.
// ---------------------------------------------------------------------------

const SUGGESTED_PROMPTS = [
	'Find my post about…',
	'Where can I see categories?',
	'Do I have any spam comments?',
	'Take me to plugin settings',
];

// ---------------------------------------------------------------------------
// AiAssistant class
// ---------------------------------------------------------------------------

export class AiAssistant implements AiAssistantApi {
	private _el: HTMLElement;
	private _input: HTMLInputElement;
	private _submitBtn: HTMLButtonElement;
	private _closeBtn: HTMLButtonElement;
	private _resultsEl: HTMLElement;
	private _isOpen = false;
	private _isSearching = false;
	private _previousFocus: Element | null = null;
	private _aiSearchUrl: string;
	private _aiSearchStreamUrl: string;
	private _restNonce: string;
	private _currentStream: EventSource | null = null;

	/** Index of the highlighted command in the filtered list (keyboard nav). */
	private _selectedCommand = 0;
	/** Highlighted index in the per-command argument suggestion list. */
	private _selectedSuggestion = 0;
	/** Cached latest suggestion list so keyboard nav can read it without re-calling suggest(). */
	private _currentSuggestions: CommandSuggestion[] = [];
	/** Monotonic counter to discard stale async suggest() results. */
	private _suggestToken = 0;

	constructor( config: { aiSearchUrl: string; aiSearchStreamUrl: string; restNonce: string } ) {
		this._aiSearchUrl = config.aiSearchUrl;
		this._aiSearchStreamUrl = config.aiSearchStreamUrl;
		this._restNonce = config.restNonce;

		this._el = this._buildDOM();
		document.body.appendChild( this._el );

		this._input = this._el.querySelector( '.wp-desktop-ai__input' )!;
		this._submitBtn = this._el.querySelector( '.wp-desktop-ai__submit' )!;
		this._closeBtn = this._el.querySelector( '.wp-desktop-ai__close' )!;
		this._resultsEl = this._el.querySelector( '.wp-desktop-ai__results' )!;

		this._bindEvents();
		this._renderSuggestions();

		// Re-render the command list when plugins register commands
		// after the panel has mounted. If the palette is currently in
		// command mode, refresh it so the new item appears live. The
		// panel is a page-lifetime singleton, so we don't capture the
		// unsubscribe handle — the subscription dies with the page.
		subscribeCommands( () => {
			if ( this._isOpen && this._input.value.startsWith( '/' ) ) {
				this._renderCommandMode();
			}
		} );
	}

	// ------------------------------------------------------------------
	// Public API
	// ------------------------------------------------------------------

	open(): void {
		if ( this._isOpen ) {
			this._input.focus();
			this._input.select();
			return;
		}
		this._isOpen = true;
		this._previousFocus = this._el.ownerDocument.activeElement;

		// Reset the input, keyboard-selection, and the results area so
		// every open feels like a fresh conversation — no stale query,
		// no leftover command highlight.
		this._input.value = '';
		this._selectedCommand = 0;
		this._submitBtn.classList.remove( 'has-value' );
		this._renderSuggestions();

		this._el.removeAttribute( 'hidden' );
		void this._el.offsetHeight;
		this._el.classList.add( 'is-open' );
		this._el.setAttribute( 'aria-hidden', 'false' );

		requestAnimationFrame( () => this._input.focus() );
	}

	close(): void {
		if ( ! this._isOpen ) {
			return;
		}
		this._isOpen = false;
		this._el.classList.remove( 'is-open' );
		this._el.setAttribute( 'aria-hidden', 'true' );
		// Abort any in-flight streaming request so we don't keep an open
		// HTTP connection to the server after the user closes the panel.
		this._closeStream();
		this._isSearching = false;
		this._submitBtn.disabled = false;
		this._input.disabled = false;

		const onEnd = ( e: TransitionEvent ) => {
			if ( e.target !== this._el || e.propertyName !== 'opacity' ) {
				return;
			}
			this._el.setAttribute( 'hidden', '' );
			this._el.removeEventListener( 'transitionend', onEnd );
			if ( this._previousFocus instanceof HTMLElement ) {
				this._previousFocus.focus();
			}
		};
		this._el.addEventListener( 'transitionend', onEnd );
	}

	toggle(): void {
		if ( this._isOpen ) {
			this.close();
		} else {
			this.open();
		}
	}

	get isOpen(): boolean {
		return this._isOpen;
	}

	// ------------------------------------------------------------------
	// Events
	// ------------------------------------------------------------------

	private _bindEvents(): void {
		// NOTE: Cmd/Ctrl+K is NOT handled here anymore — the shell owns a
		// single global shortcut that cycles through every registered
		// palette (see `src/palette-registry.ts`). This class registers
		// itself as a palette in `desktop.ts`; pressing Cmd+K with
		// another palette open will close the other one and open the
		// AI Assistant only when its turn comes in the cycle.

		// Escape closes.
		this._el.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			if ( e.key === 'Escape' ) {
				e.stopPropagation();
				this.close();
			}
		} );

		// Tab focus trap.
		this._el.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			if ( e.key !== 'Tab' ) {
				return;
			}
			const focusable = [ this._closeBtn, this._input, this._submitBtn ]
				.filter( ( el ) => ! el.disabled );
			const first = focusable[ 0 ];
			const last = focusable[ focusable.length - 1 ];
			const active = this._el.ownerDocument.activeElement;
			if ( e.shiftKey && active === first ) {
				e.preventDefault();
				last.focus();
			} else if ( ! e.shiftKey && active === last ) {
				e.preventDefault();
				first.focus();
			}
		} );

		// Admin-bar "Ask AI" button signal. We fire a document-level
		// custom event here (not the registry's openPaletteOnly) so the
		// assistant stays independent of the registry module's import
		// graph — the shell wires up the real close-others-first
		// routing in desktop.ts via openPalette.
		document.addEventListener( 'wp-desktop-open-ai', () => this.open() );

		// Close button.
		this._closeBtn.addEventListener( 'click', () => this.close() );

		// Submit.
		this._submitBtn.addEventListener( 'click', () => this._onSubmit() );

		// Keyboard handling — arrows navigate whichever list is currently
		// visible (command picker in pick mode; argument-suggestion list
		// in args mode if the command defines suggest()). Tab
		// autocompletes. Enter submits or locks in a selection depending
		// on state.
		this._input.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			const parsed = parseCommandInput( this._input.value );

			// -----------------------------------------------------------
			// PICK MODE — user is still typing the slug after "/".
			// -----------------------------------------------------------
			if ( parsed.isCommand && ! parsed.hasArgsPart ) {
				const matches = filterCommands( parsed.slug );
				if ( e.key === 'ArrowDown' ) {
					e.preventDefault();
					this._selectedCommand = Math.min(
						this._selectedCommand + 1,
						Math.max( 0, matches.length - 1 ),
					);
					this._renderCommandMode();
					return;
				}
				if ( e.key === 'ArrowUp' ) {
					e.preventDefault();
					this._selectedCommand = Math.max( 0, this._selectedCommand - 1 );
					this._renderCommandMode();
					return;
				}
				if ( e.key === 'Tab' && matches.length > 0 ) {
					e.preventDefault();
					const pick = matches[ this._selectedCommand ] ?? matches[ 0 ];
					this._input.value = `/${ pick.slug } `;
					this._submitBtn.classList.add( 'has-value' );
					this._selectedSuggestion = 0;
					this._renderCommandMode();
					return;
				}
				if ( e.key === 'Enter' && ! e.shiftKey ) {
					e.preventDefault();
					if ( matches.length === 0 ) {
						this._showError( `Unknown command: /${ parsed.slug }` );
						return;
					}
					const pick = matches[ this._selectedCommand ] ?? matches[ 0 ];
					this._runCommand( pick, '' );
					return;
				}
			}

			// -----------------------------------------------------------
			// ARGS MODE — command is locked in; user is typing arguments.
			// If the command defines suggest(), we navigate its output.
			// -----------------------------------------------------------
			if ( parsed.isCommand && parsed.hasArgsPart ) {
				const cmd = findCommand( parsed.slug );
				const hasSuggest = !! cmd && typeof cmd.suggest === 'function';

				if ( hasSuggest && this._currentSuggestions.length > 0 ) {
					if ( e.key === 'ArrowDown' ) {
						e.preventDefault();
						this._selectedSuggestion = Math.min(
							this._selectedSuggestion + 1,
							this._currentSuggestions.length - 1,
						);
						this._paintSuggestionSelection();
						return;
					}
					if ( e.key === 'ArrowUp' ) {
						e.preventDefault();
						this._selectedSuggestion = Math.max( 0, this._selectedSuggestion - 1 );
						this._paintSuggestionSelection();
						return;
					}
					if ( e.key === 'Tab' ) {
						e.preventDefault();
						const pick = this._currentSuggestions[ this._selectedSuggestion ];
						if ( pick ) {
							this._input.value = `/${ parsed.slug } ${ pick.value }`;
						}
						return;
					}
					if ( e.key === 'Enter' && ! e.shiftKey && cmd ) {
						// Enter while a suggestion is highlighted uses
						// that suggestion's value as the command args.
						// Raw typed text (if different) is ignored in
						// favour of the structured pick — mirrors how
						// autocomplete behaves in most palette UIs.
						e.preventDefault();
						const pick = this._currentSuggestions[ this._selectedSuggestion ];
						const finalArgs = pick ? pick.value : parsed.args;
						this._runCommand( cmd, finalArgs );
						return;
					}
				}
			}

			// Default: Enter submits (AI query or free-text command).
			if ( e.key === 'Enter' && ! e.shiftKey ) {
				e.preventDefault();
				this._onSubmit();
			}
		} );

		// Toggle submit arrow based on input content; also re-render
		// the appropriate list (command palette or suggestions).
		this._input.addEventListener( 'input', () => {
			const hasValue = this._input.value.trim().length > 0;
			this._submitBtn.classList.toggle( 'has-value', hasValue );
			// Reset both selection cursors whenever the filter text
			// changes — typing resets you to the top of the list.
			this._selectedCommand = 0;
			this._selectedSuggestion = 0;

			if ( this._input.value.startsWith( '/' ) ) {
				this._renderCommandMode();
			} else if ( ! hasValue ) {
				this._renderSuggestions();
			} else {
				// User is typing a regular AI query and had results from
				// a prior run; leave them visible so they can keep editing.
			}
		} );
	}

	// ------------------------------------------------------------------
	// Flow
	// ------------------------------------------------------------------

	private async _onSubmit(): Promise<void> {
		const raw = this._input.value.trim();
		if ( ! raw || this._isSearching ) {
			return;
		}

		// Slash-command dispatch. Anything starting with `/` is treated
		// as a plugin-contributed command — we look up the slug and
		// invoke its handler. Non-command input falls through to the
		// AI search path as before.
		const parsed = parseCommandInput( this._input.value );
		if ( parsed.isCommand ) {
			const cmd = findCommand( parsed.slug );
			if ( ! cmd ) {
				this._showError( `Unknown command: /${ parsed.slug }` );
				return;
			}
			await this._runCommand( cmd, parsed.args );
			return;
		}

		await this._runSearch( raw, null, 0 );
	}

	/**
	 * Invoke a plugin-registered command. Handles both sync and async
	 * handlers, renders the return value the same way we render an AI
	 * answer, and surfaces thrown errors as an error-state bubble.
	 */
	private async _runCommand( cmd: DesktopCommand, args: string ): Promise<void> {
		if ( this._isSearching ) {
			return;
		}

		// ----- before-run filter ----------------------------------------
		// Plugins can subscribe to wp-desktop.command.before-run and
		// return `{ proceed: false, reason }` to short-circuit
		// destructive or gated commands. Useful for capability checks
		// the command author shouldn't have to repeat in every handler.
		const gate = applyFilters<
			{ proceed: boolean; reason?: string; slug: string; args: string; command: DesktopCommand },
			[]
		>( HOOKS.COMMAND_BEFORE_RUN, {
			proceed: true,
			slug: cmd.slug,
			args,
			command: cmd,
		} );
		if ( gate && gate.proceed === false ) {
			this._showError(
				gate.reason ?? `Command /${ cmd.slug } was cancelled.`,
			);
			return;
		}

		this._isSearching = true;
		this._submitBtn.disabled = true;
		this._input.disabled = true;
		this._showThinking( `Running /${ cmd.slug }…` );

		const ctx: CommandContext = {
			close: () => this.close(),
			openInWindow: ( url, title, icon ) => this._openInLegacyWindow( url, title, icon ),
			confirm: ( msg, details ) => this._confirm( msg, details ),
		};

		try {
			const result = await Promise.resolve( cmd.run( args, ctx ) );
			this._renderCommandResult( cmd, result );
			doAction( HOOKS.COMMAND_AFTER_RUN, {
				slug: cmd.slug,
				args,
				command: cmd,
				result,
			} );
		} catch ( err ) {
			const msg = err instanceof Error ? err.message : String( err );
			this._showError( `Command /${ cmd.slug } failed: ${ msg }` );
			doAction( HOOKS.COMMAND_ERROR, {
				slug: cmd.slug,
				args,
				command: cmd,
				error: err,
			} );
		} finally {
			this._isSearching = false;
			this._submitBtn.disabled = false;
			this._input.disabled = false;
			this._input.focus();
		}
	}

	/**
	 * Default `ctx.confirm()` — uses the browser's native confirm
	 * dialog. Combined message + details into one string because
	 * window.confirm() only takes one. The shell can swap a custom
	 * dialog in later (the Promise<boolean> contract is stable).
	 */
	private _confirm( message: string, details?: string ): Promise< boolean > {
		const text = details ? `${ message }\n\n${ details }` : message;
		// eslint-disable-next-line no-alert -- default impl uses the native dialog; the shell can swap in a custom one via the stable Promise<boolean> contract.
		return Promise.resolve( window.confirm( text ) );
	}

	/**
	 * Render the value returned by a command. A `void` return means
	 * the command performed a side-effect (e.g. opened a window) and
	 * doesn't need a bubble; in that case we clear the results area.
	 * A plain string is shorthand for `{ message: string }`.
	 */
	private _renderCommandResult( _cmd: DesktopCommand, result: CommandResult ): void {
		if ( result === undefined || result === null ) {
			// Silent success — clear any prior bubble.
			this._resultsEl.innerHTML = '';
			this._resultsEl.hidden = true;
			return;
		}

		const answer: SearchResult =
			typeof result === 'string'
				? {
					answer_type: 'chat',
					message: result,
					entity: null,
					admin_links: null,
					iterations: 0,
					exhausted: true,
					continue: null,
				}
				: {
					answer_type: result.answer_type ?? 'chat',
					message: result.message,
					entity: ( result.entity as EntityDetail | null ) ?? null,
					admin_links: ( result.admin_links as AdminLink[] | null ) ?? null,
					iterations: 0,
					exhausted: true,
					continue: null,
				};

		this._showResult( '', answer );
	}

	private _runSearch(
		query: string,
		resumeTool: string | null,
		startOffset: number,
	): void {
		if ( this._isSearching ) {
			return;
		}
		this._isSearching = true;
		this._submitBtn.disabled = true;
		this._input.disabled = true;
		this._showThinking( 'Thinking…' );

		// Prefer SSE streaming so the user sees real-time progress ticks
		// ("Looking through your posts…"). Falls back to a plain fetch
		// against the REST endpoint if EventSource is unavailable or the
		// stream URL wasn't provisioned by PHP.
		if ( typeof EventSource !== 'undefined' && this._aiSearchStreamUrl ) {
			this._runSearchStream( query, resumeTool, startOffset );
		} else {
			this._runSearchFetch( query, resumeTool, startOffset );
		}
	}

	/**
	 * EventSource-based streaming — the preferred path. Shows real-time
	 * progress messages as the agent picks tools and runs them.
	 */
	private _runSearchStream(
		query: string,
		resumeTool: string | null,
		startOffset: number,
	): void {
		const url = new URL( this._aiSearchStreamUrl, window.location.origin );
		url.searchParams.set( 'nonce', this._restNonce );
		url.searchParams.set( 'query', query );
		if ( resumeTool ) {
			url.searchParams.set( 'resume_tool', resumeTool );
			url.searchParams.set( 'start_offset', String( startOffset ) );
		}

		this._closeStream();
		const es = new EventSource( url.toString() );
		this._currentStream = es;

		const finish = () => {
			es.close();
			this._currentStream = null;
			this._isSearching = false;
			this._submitBtn.disabled = false;
			this._input.disabled = false;
			this._input.focus();
		};

		es.onmessage = ( ev ) => {
			let data: { event?: string; message?: string; result?: SearchResult };
			try {
				data = JSON.parse( ev.data );
			} catch {
				return;
			}
			if ( ! data || typeof data !== 'object' ) {
				return;
			}

			switch ( data.event ) {
				case 'open':
					// Connection established — keep the initial "Thinking…".
					break;
				case 'progress':
					if ( typeof data.message === 'string' ) {
						this._showThinking( data.message );
					}
					break;
				case 'done':
					if ( data.result ) {
						this._showResult( query, data.result );
					}
					finish();
					break;
				case 'error':
					this._showError( data.message ?? 'Something went wrong.' );
					finish();
					break;
			}
		};

		es.onerror = () => {
			// Connection dropped mid-stream. If we never received 'done'
			// we need to show a user-visible error, otherwise the user
			// would stare at a stale "Thinking…".
			if ( this._currentStream === es ) {
				this._showError( 'Lost connection to the assistant. Please try again.' );
				finish();
			}
		};
	}

	/**
	 * Legacy fetch path — used when EventSource is not available.
	 */
	private async _runSearchFetch(
		query: string,
		resumeTool: string | null,
		startOffset: number,
	): Promise<void> {
		try {
			const body: Record<string, unknown> = { query };
			if ( resumeTool ) {
				body.resume_tool = resumeTool;
				body.start_offset = startOffset;
			}

			const res = await fetch( this._aiSearchUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': this._restNonce,
				},
				body: JSON.stringify( body ),
			} );

			if ( ! res.ok ) {
				const err = await res.json().catch( () => ( {} ) );
				this._showError( ( err as { message?: string } ).message ?? `Server returned ${ res.status }` );
				return;
			}

			this._showResult( query, await res.json() as SearchResult );
		} catch {
			this._showError( 'Network error — please check your connection and try again.' );
		} finally {
			this._isSearching = false;
			this._submitBtn.disabled = false;
			this._input.disabled = false;
			this._input.focus();
		}
	}

	private _closeStream(): void {
		if ( this._currentStream ) {
			this._currentStream.close();
			this._currentStream = null;
		}
	}

	// ------------------------------------------------------------------
	// Open helpers — everything opens as a legacy iframe window, not a
	// new browser tab, so the admin experience stays inside the desktop.
	// ------------------------------------------------------------------

	private _getWindowManager(): WindowManagerLite | null {
		const wm = ( window as unknown as {
			wp?: { desktop?: { windowManager?: WindowManagerLite } };
		} ).wp?.desktop?.windowManager;
		return wm ?? null;
	}

	private _openInLegacyWindow( url: string, title: string, icon?: string ): void {
		const wm = this._getWindowManager();
		if ( ! wm ) {
			// Graceful fallback — if the shell isn't initialised yet,
			// just open in a new tab rather than silently doing nothing.
			window.open( url, '_blank', 'noopener' );
			return;
		}
		wm.open( { url, title, icon: icon ?? 'dashicons-admin-generic' } );
		this.close();
	}

	// ------------------------------------------------------------------
	// Rendering
	// ------------------------------------------------------------------

	/**
	 * Render the slash-command palette — filtered list of commands
	 * matching the current input. If the user has typed a slug followed
	 * by a space, we're in "args" mode so we only show the one locked-in
	 * command with a hint rather than a filterable list.
	 */
	private _renderCommandMode(): void {
		this._resultsEl.hidden = false;
		const parsed = parseCommandInput( this._input.value );

		// Args mode: one locked-in command. If it defines suggest(), we
		// fetch and render the suggestion list; otherwise just show the
		// command header with a "Press Enter to run" hint.
		if ( parsed.hasArgsPart ) {
			const cmd = findCommand( parsed.slug );
			if ( cmd ) {
				this._renderArgsMode( cmd, parsed.args );
				return;
			}
			// Fall through to picking mode when the slug doesn't match.
		}

		// Picking mode: show filtered command list.
		const matches = filterCommands( parsed.slug );

		if ( matches.length === 0 ) {
			this._resultsEl.innerHTML = `
				<div class="wp-desktop-ai__state wp-desktop-ai__state--empty">
					<span>No commands matching <strong>/${ this._esc( parsed.slug ) }</strong>.</span>
				</div>
			`;
			return;
		}

		// Clamp selection so it doesn't outrun the filtered set.
		if ( this._selectedCommand >= matches.length ) {
			this._selectedCommand = 0;
		}

		const items = matches
			.map( ( c, i ) => {
				const selected = i === this._selectedCommand ? ' is-selected' : '';
				return `
					<button
						type="button"
						class="wp-desktop-ai__cmd-item${ selected }"
						data-slug="${ this._esc( c.slug ) }"
						data-index="${ i }"
					>
						<span class="wp-desktop-ai__cmd-icon dashicons ${ this._esc(
							c.icon ?? 'dashicons-arrow-right-alt',
						) }" aria-hidden="true"></span>
						<span class="wp-desktop-ai__cmd-body">
							<span class="wp-desktop-ai__cmd-title">
								/${ this._esc( c.slug ) }
								${ c.hint ? `<span class="wp-desktop-ai__cmd-hint">${ this._esc( c.hint ) }</span>` : '' }
							</span>
							${ c.description
								? `<span class="wp-desktop-ai__cmd-desc">${ this._esc( c.description ) }</span>`
								: '' }
						</span>
					</button>
				`;
			} )
			.join( '' );

		this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__cmd-list">
				<p class="wp-desktop-ai__suggestions-label">Commands</p>
				${ items }
			</div>
		`;

		// Click handlers — clicking a row autocompletes and locks the
		// command in, ready for args. If the command takes no args the
		// user can just press Enter right after.
		this._resultsEl
			.querySelectorAll< HTMLButtonElement >( '.wp-desktop-ai__cmd-item' )
			.forEach( ( btn ) => {
				btn.addEventListener( 'click', () => {
					const slug = btn.dataset.slug ?? '';
					this._input.value = `/${ slug } `;
					this._submitBtn.classList.add( 'has-value' );
					this._input.focus();
					this._renderCommandMode();
				} );
				btn.addEventListener( 'mouseenter', () => {
					const idx = parseInt( btn.dataset.index ?? '0', 10 );
					if ( ! Number.isNaN( idx ) ) {
						this._selectedCommand = idx;
						this._resultsEl
							.querySelectorAll( '.wp-desktop-ai__cmd-item' )
							.forEach( ( el, i ) => el.classList.toggle( 'is-selected', i === idx ) );
					}
				} );
			} );
	}

	/**
	 * Render args-mode UI for a locked-in command. If the command has a
	 * `suggest()` handler, fetch it (sync or async) and render the
	 * returned list. Otherwise fall back to a single-row "Press Enter
	 * to run" card.
	 */
	private _renderArgsMode( cmd: DesktopCommand, args: string ): void {
		// No suggest() → static header, nothing more to do.
		if ( typeof cmd.suggest !== 'function' ) {
			this._currentSuggestions = [];
			this._resultsEl.innerHTML = this._renderCommandHeader( cmd, true );
			return;
		}

		// Increment the token — any in-flight suggest() whose result
		// arrives AFTER a later keystroke (or different command) will
		// be discarded on arrival.
		const myToken = ++this._suggestToken;

		const ctx: CommandContext = {
			close: () => this.close(),
			openInWindow: ( url, title, icon ) => this._openInLegacyWindow( url, title, icon ),
			confirm: ( msg, details ) => this._confirm( msg, details ),
		};

		let result: CommandSuggestion[] | Promise< CommandSuggestion[] >;
		try {
			result = cmd.suggest( args, ctx );
		} catch {
			result = [];
		}

		const render = ( suggestions: CommandSuggestion[] ) => {
			if ( myToken !== this._suggestToken ) {
				// A later keystroke has superseded us — drop the result.
				return;
			}
			this._currentSuggestions = suggestions;
			if ( this._selectedSuggestion >= suggestions.length ) {
				this._selectedSuggestion = 0;
			}
			this._resultsEl.innerHTML =
				this._renderCommandHeader( cmd, false ) +
				this._renderSuggestionList( suggestions );

			// Wire mouse interactions on the suggestion rows.
			this._resultsEl
				.querySelectorAll< HTMLButtonElement >( '.wp-desktop-ai__cmd-suggest-item' )
				.forEach( ( btn ) => {
					btn.addEventListener( 'click', () => {
						const idx = parseInt( btn.dataset.index ?? '0', 10 );
						const pick = suggestions[ idx ];
						if ( pick ) {
							// Click = fill and run. Matches the palette
							// convention where a mouse click is a commit,
							// Tab is fill-only.
							this._input.value = `/${ cmd.slug } ${ pick.value }`;
							this._runCommand( cmd, pick.value );
						}
					} );
					btn.addEventListener( 'mouseenter', () => {
						const idx = parseInt( btn.dataset.index ?? '0', 10 );
						if ( ! Number.isNaN( idx ) ) {
							this._selectedSuggestion = idx;
							this._paintSuggestionSelection();
						}
					} );
				} );
		};

		if ( result && typeof ( result as Promise< unknown > ).then === 'function' ) {
			// Async — show the header immediately so the user has feedback,
			// then render the list when it resolves.
			this._resultsEl.innerHTML = this._renderCommandHeader( cmd, false );
			( result as Promise< CommandSuggestion[] > )
				.then( ( r ) => render( Array.isArray( r ) ? r : [] ) )
				.catch( () => render( [] ) );
		} else {
			render( Array.isArray( result ) ? ( result as CommandSuggestion[] ) : [] );
		}
	}

	/** Render the command banner used at the top of args-mode. */
	private _renderCommandHeader( cmd: DesktopCommand, standalone: boolean ): string {
		return `
			<div class="wp-desktop-ai__cmd-active">
				<span class="wp-desktop-ai__cmd-icon dashicons ${ this._esc(
					cmd.icon ?? 'dashicons-arrow-right-alt',
				) }" aria-hidden="true"></span>
				<div class="wp-desktop-ai__cmd-body">
					<span class="wp-desktop-ai__cmd-title">
						/${ this._esc( cmd.slug ) }
						${ cmd.hint ? `<span class="wp-desktop-ai__cmd-hint">${ this._esc( cmd.hint ) }</span>` : '' }
					</span>
					${ cmd.description
						? `<span class="wp-desktop-ai__cmd-desc">${ this._esc( cmd.description ) }</span>`
						: '' }
					${ standalone
						? '<span class="wp-desktop-ai__cmd-enter-hint">Press <kbd>↵</kbd> to run</span>'
						: '' }
				</div>
			</div>
		`;
	}

	/** Render the list of suggestions under the command header. */
	private _renderSuggestionList( suggestions: CommandSuggestion[] ): string {
		if ( suggestions.length === 0 ) {
			return `
				<div class="wp-desktop-ai__state wp-desktop-ai__state--empty">
					<span>No suggestions — press <kbd>↵</kbd> to run with the text you typed.</span>
				</div>
			`;
		}
		const items = suggestions
			.map( ( s, i ) => {
				const selected = i === this._selectedSuggestion ? ' is-selected' : '';
				return `
					<button
						type="button"
						class="wp-desktop-ai__cmd-suggest-item${ selected }"
						data-index="${ i }"
					>
						<span class="wp-desktop-ai__cmd-icon dashicons ${ this._esc(
							s.icon ?? 'dashicons-arrow-right-alt',
						) }" aria-hidden="true"></span>
						<span class="wp-desktop-ai__cmd-body">
							<span class="wp-desktop-ai__cmd-suggest-label">${ this._esc( s.label ) }</span>
							${ s.description
								? `<span class="wp-desktop-ai__cmd-desc">${ this._esc( s.description ) }</span>`
								: '' }
						</span>
					</button>
				`;
			} )
			.join( '' );
		return `<div class="wp-desktop-ai__cmd-suggest-list">${ items }</div>`;
	}

	/** Flip the is-selected class on the suggestion rows without re-rendering the whole list. */
	private _paintSuggestionSelection(): void {
		this._resultsEl
			.querySelectorAll( '.wp-desktop-ai__cmd-suggest-item' )
			.forEach( ( el, i ) => {
				el.classList.toggle( 'is-selected', i === this._selectedSuggestion );
			} );
	}

	private _renderSuggestions(): void {
		this._resultsEl.hidden = false;
		this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__suggestions">
				<p class="wp-desktop-ai__suggestions-label">${ this._esc( 'Try asking' ) }</p>
				<div class="wp-desktop-ai__suggestions-list">
					${ SUGGESTED_PROMPTS.map(
						( p ) => `<button type="button" class="wp-desktop-ai__suggestion" data-prompt="${ this._esc( p ) }">
							${ this._esc( p ) }
						</button>`,
					).join( '' ) }
				</div>
			</div>
		`;

		// Wire suggestion clicks — fill the input and submit.
		this._resultsEl
			.querySelectorAll<HTMLButtonElement>( '.wp-desktop-ai__suggestion' )
			.forEach( ( btn ) => {
				btn.addEventListener( 'click', () => {
					const prompt = btn.dataset.prompt ?? '';
					this._input.value = prompt;
					this._submitBtn.classList.add( 'has-value' );
					this._input.focus();
				} );
			} );
	}

	private _showThinking( message: string = 'Thinking…' ): void {
		this._resultsEl.hidden = false;
		this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__state wp-desktop-ai__state--thinking">
				${ ICON_SPINNER }
				<span>${ this._esc( message ) }</span>
			</div>
		`;
	}

	private _showError( message: string ): void {
		this._resultsEl.hidden = false;
		this._resultsEl.innerHTML = `
			<div class="wp-desktop-ai__state wp-desktop-ai__state--error">
				<span>${ this._esc( message ) }</span>
			</div>
		`;
	}

	private _showResult( query: string, data: SearchResult ): void {
		this._resultsEl.hidden = false;

		// Assistant-styled message bubble appears at the top of every
		// answer regardless of answer_type — so the UX always feels like
		// a reply from the assistant.
		const messageHtml = `
			<div class="wp-desktop-ai__bubble">
				<span class="wp-desktop-ai__bubble-icon">${ ICON_SPARKLE }</span>
				<div class="wp-desktop-ai__bubble-text">${ renderMarkdown( data.message || '' ) }</div>
			</div>
		`;

		let bodyHtml = '';
		if ( data.answer_type === 'entity' && data.entity ) {
			bodyHtml = this._renderEntityCard( data.entity );
		} else if ( data.answer_type === 'navigation' && data.admin_links && data.admin_links.length > 0 ) {
			bodyHtml = this._renderAdminLinks( data.admin_links );
		}

		// Continue-search hint (only appears after budget exhaustion).
		if ( data.continue ) {
			bodyHtml += `
				<button type="button" class="wp-desktop-ai__continue-btn"
					data-tool="${ this._esc( data.continue.tool ) }"
					data-offset="${ data.continue.offset }"
					data-query="${ this._esc( query ) }">
					${ this._esc( data.continue.label ) }
				</button>
			`;
		}

		this._resultsEl.innerHTML = messageHtml + bodyHtml;

		// Wire entity "Open" button.
		this._resultsEl.querySelectorAll<HTMLButtonElement>(
			'.wp-desktop-ai__entity-open',
		).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				const url = btn.dataset.url ?? '';
				const title = btn.dataset.title ?? '';
				const icon = btn.dataset.icon ?? 'dashicons-admin-generic';
				if ( url ) {
					this._openInLegacyWindow( url, title, icon );
				}
			} );
		} );

		// Wire admin-link clicks.
		this._resultsEl.querySelectorAll<HTMLButtonElement>(
			'.wp-desktop-ai__admin-link',
		).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				const url = btn.dataset.url ?? '';
				const title = btn.dataset.title ?? '';
				const icon = btn.dataset.icon ?? 'dashicons-admin-generic';
				if ( url ) {
					this._openInLegacyWindow( url, title, icon );
				}
			} );
		} );

		// Wire continue button.
		const cont = this._resultsEl.querySelector<HTMLButtonElement>( '.wp-desktop-ai__continue-btn' );
		if ( cont ) {
			cont.addEventListener( 'click', () => {
				const tool = cont.dataset.tool ?? null;
				const offset = parseInt( cont.dataset.offset ?? '0', 10 );
				const q = cont.dataset.query ?? query;
				this._runSearch( q, tool, offset );
			} );
		}
	}

	private _renderEntityCard( e: EntityDetail ): string {
		const isComment = e.type === 'comment';
		const title = isComment
			? `Comment on “${ this._esc( e.post_title ?? 'post' ) }”`
			: this._esc( e.title ?? 'Untitled' );
		const summary = this._esc( e.ai_summary || e.excerpt || '' );
		const typeLabel = e.type.charAt( 0 ).toUpperCase() + e.type.slice( 1 );
		const topicChip = e.topic ? `<span class="wp-desktop-ai__entity-topic">${ this._esc( e.topic ) }</span>` : '';

		// Pick a Dashicon for the window icon based on entity type.
		let icon: string;
		if ( isComment ) {
			icon = 'dashicons-admin-comments';
		} else if ( e.type === 'page' ) {
			icon = 'dashicons-admin-page';
		} else {
			icon = 'dashicons-admin-post';
		}

		return `
			<div class="wp-desktop-ai__entity">
				<div class="wp-desktop-ai__entity-header">
					${ topicChip }
					<span class="wp-desktop-ai__entity-type">${ this._esc( typeLabel ) }</span>
				</div>
				<h3 class="wp-desktop-ai__entity-title">${ title }</h3>
				<p class="wp-desktop-ai__entity-summary">${ summary }</p>
				<button type="button"
					class="wp-desktop-ai__entity-open"
					data-url="${ this._esc( e.edit_url ) }"
					data-title="${ this._esc( e.title ?? e.post_title ?? typeLabel ) }"
					data-icon="${ icon }">
					<span>${ this._esc( `Open ${ typeLabel.toLowerCase() } in desktop` ) }</span>
					${ ICON_ARROW }
				</button>
			</div>
		`;
	}

	private _renderAdminLinks( links: AdminLink[] ): string {
		const items = links.map( ( link ) => `
			<button type="button"
				class="wp-desktop-ai__admin-link"
				data-url="${ this._esc( link.url ) }"
				data-title="${ this._esc( link.title ) }"
				data-icon="${ this._esc( link.icon ) }">
				<span class="wp-desktop-ai__admin-link-icon dashicons ${ this._esc( link.icon ) }" aria-hidden="true"></span>
				<span class="wp-desktop-ai__admin-link-body">
					<span class="wp-desktop-ai__admin-link-title">${ this._esc( link.title ) }</span>
					<span class="wp-desktop-ai__admin-link-desc">${ this._esc( link.description ) }</span>
				</span>
				<span class="wp-desktop-ai__admin-link-arrow">${ ICON_ARROW }</span>
			</button>
		` ).join( '' );

		return `<div class="wp-desktop-ai__admin-links">${ items }</div>`;
	}

	/** Minimal HTML escaping for text interpolated into innerHTML. */
	private _esc( str: string ): string {
		return str
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' );
	}

	// ------------------------------------------------------------------
	// DOM scaffold
	// ------------------------------------------------------------------

	private _buildDOM(): HTMLElement {
		const el = document.createElement( 'div' );
		el.id = 'wp-desktop-ai-assistant';
		el.className = 'wp-desktop-ai';
		el.setAttribute( 'role', 'dialog' );
		el.setAttribute( 'aria-modal', 'true' );
		el.setAttribute( 'aria-label', 'AI Assistant' );
		el.setAttribute( 'aria-hidden', 'true' );
		el.setAttribute( 'hidden', '' );

		el.innerHTML = `
			<div class="wp-desktop-ai__backdrop" aria-hidden="true"></div>
			<div class="wp-desktop-ai__panel">
				<div class="wp-desktop-ai__header">
					<span class="wp-desktop-ai__header-icon">${ ICON_SPARKLE }</span>
					<span class="wp-desktop-ai__header-label">AI Assistant</span>
					<button type="button" class="wp-desktop-ai__close" aria-label="Close">
						${ ICON_CLOSE }
					</button>
				</div>
				<div class="wp-desktop-ai__input-wrap">
					<span class="wp-desktop-ai__input-icon">${ ICON_SPARKLE }</span>
					<input
						class="wp-desktop-ai__input"
						type="text"
						placeholder="How can I help?"
						autocomplete="off"
						spellcheck="false"
						aria-label="Ask the AI assistant"
					/>
					<button type="button" class="wp-desktop-ai__submit" aria-label="Send">
						${ ICON_RETURN }
					</button>
				</div>
				<div class="wp-desktop-ai__results" hidden></div>
				<div class="wp-desktop-ai__footer">
					<span class="wp-desktop-ai__footer-hint">
						Your assistant for finding content and navigating wp-admin
					</span>
					<span class="wp-desktop-ai__footer-keys" aria-hidden="true">
						<kbd>&#8629;</kbd> ask
					</span>
				</div>
			</div>
		`;

		return el;
	}
}
