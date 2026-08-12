/**
 * OpenStation — AI Assistant spotlight overlay.
 *
 * A conversational assistant panel opened with Cmd+K. The user types any
 * natural-language request — "find my post about Málaga", "where can I
 * see categories?", "do I have any spam comments?" — and the server-side
 * agent loop picks the right tools and returns one of three answer types:
 *
 *   - entity:     a matching post / page / comment; opens in a legacy
 *                 (iframe) window via wp.os.windowManager.open().
 *   - navigation: 1-3 wp-admin destinations; each opens in a legacy
 *                 window on click.
 *   - chat:       a plain conversational message; just rendered as text.
 *
 * The overlay stays open until the user explicitly closes it with the ×
 * button, the Escape key, or Cmd+K again.
 */

import { HOOKS, doAction, applyFilters } from '../hooks';
import { __, sprintf } from '../i18n';
import { osConfirm } from '../os-confirm';
import { trackedFetch } from '../tracked-fetch';
import { decodeHTML } from '../utils';
import {
	filterCommands,
	findCommand,
	listCommands,
	listEagerCommands,
	parseCommandInput,
	subscribeCommands,
	type CommandContext,
	type CommandResult,
	type CommandSuggestion,
	type DesktopCommand,
} from '../commands';

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

const ICON_SPINNER = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="os-ai__spinner-icon">
	<circle cx="10" cy="10" r="7" stroke-opacity="0.25"/>
	<path d="M10 3 A7 7 0 0 1 17 10" stroke-opacity="1"/>
</svg>`;

const ICON_ARROW = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<polyline points="6,3 11,8 6,13"/>
</svg>`;

// Magnifier shown in Commands mode where the sparkle would read as "AI".
const ICON_SEARCH = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<circle cx="9" cy="9" r="6"/>
	<line x1="13.5" y1="13.5" x2="18" y2="18"/>
</svg>`;

// `siteLogo` from @wordpress/icons — the modal's title glyph.
const ICON_SITE_LOGO = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
	<path d="M12 4c-4.4 0-8 3.6-8 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8Zm0 1.5c3.4 0 6.2 2.7 6.5 6l-1.2-.6-.8-.4c-.1 0-.2 0-.3-.1H16c-.1-.2-.4-.2-.7 0l-2.9 2.1L9 11.3h-.7L5.5 13v-1.1c0-3.6 2.9-6.5 6.5-6.5Zm0 13c-2.7 0-5-1.7-6-4l2.8-1.7 3.5 1.2h.4s.2 0 .4-.2l2.9-2.1.4.2c.6.3 1.4.7 2.1 1.1-.5 3.1-3.2 5.4-6.4 5.4Z"/>
</svg>`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { AiAssistantApi, AiAssistantConfig } from './types';
import type { AiAssistantApi, AiAssistantConfig } from './types';
import type { AskFn } from '../ai/ask';
import { renderMarkdown } from '../markdown';

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
		id: string;
		url: string;
		title: string;
		icon?: string;
		native?: boolean;
	} ): unknown;
}

// Subset of `wp.os.*` we read at runtime. Both `windowManager` and
// `deriveWindowId` ship together (initialised by the shell bundle's
// `setupOpenStation()`), so when one is present the other is too.
interface DesktopShellLite {
	windowManager?: WindowManagerLite;
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;
	openOsSettings?: ( opts?: { tabId?: string } ) => void;
}

// ---------------------------------------------------------------------------
// Suggested prompts — shown under the input when there's no result yet.
// Kept short so the panel stays compact.
// ---------------------------------------------------------------------------

/**
 * A function rather than a const array so the `__()` calls run at render
 * time (and so the extract-pot pass still sees plain string literals).
 */
function suggestedPrompts(): string[] {
	return [
		__( 'Find my post about…' ),
		__( 'Where can I see categories?' ),
		__( 'Do I have any spam comments?' ),
		__( 'Take me to plugin settings' ),
	];
}

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
	private _adminUrl: string;
	private _currentStream: EventSource | null = null;
	/**
	 * Reads the user's preferred live-progress transport from OpenStation Preferences.
	 * Defaults to `'off'` when the shell hasn't wired one in — the
	 * conservative choice for hosts that may block SSE.
	 */
	private _getTransport: () => 'sse' | 'off';

	/** Live: is AI mode usable (APIs present + provider configured)? */
	private _isAiAvailable: () => boolean;
	/** Live: is the "Override…" toggle on (default to AI mode)? */
	private _isOverrideEnabled: () => boolean;
	/**
	 * Current surface. `commands` = a command palette (always available);
	 * `ai` = natural-language questions (only when AI is available).
	 */
	private _mode: 'commands' | 'ai' = 'commands';
	/** Per-mode input drafts so switching modes preserves each mode's text. */
	private _modeInput: { commands: string; ai: string } = {
		commands: '',
		ai: '',
	};
	/**
	 * The last AI answer, kept so returning to Ask AI mode re-shows it
	 * (switching to Commands replaces the results DOM).
	 */
	private _lastAiResult: { query: string; data: SearchResult } | null = null;
	private _currentRemoteCommands: DesktopCommand[] = [];
	private _remoteSearchToken = 0;

	/** Index of the highlighted command in the filtered list (keyboard nav). */
	private _selectedCommand = 0;
	/**
	 * Set while an arrow key is driving the command-list cursor.
	 * Blocks the `mouseenter` hover handler from snatching selection
	 * back to whatever item the pointer happens to rest on after the
	 * list re-renders. Cleared on the next real `mousemove` — the user
	 * actually moving the mouse is the signal that they want pointer
	 * control again.
	 */
	private _keyboardNav = false;
	/** Highlighted index in the per-command argument suggestion list. */
	private _selectedSuggestion = 0;
	/** Cached latest suggestion list so keyboard nav can read it without re-calling suggest(). */
	private _currentSuggestions: CommandSuggestion[] = [];
	/** Monotonic counter to discard stale async suggest() results. */
	private _suggestToken = 0;

	constructor( config: AiAssistantConfig ) {
		this._aiSearchUrl = config.aiSearchUrl;
		this._aiSearchStreamUrl = config.aiSearchStreamUrl;
		this._restNonce = config.restNonce;
		this._adminUrl = config.adminUrl;
		this._getTransport = config.getTransport ?? ( () => 'off' );
		this._isAiAvailable = config.isAiAvailable ?? ( () => false );
		this._isOverrideEnabled = config.isOverrideEnabled ?? ( () => false );

		this._el = this._buildDOM();
		document.body.appendChild( this._el );

		this._input = this._el.querySelector( '.os-ai__input' )!;
		this._submitBtn = this._el.querySelector( '.os-ai__submit' )!;
		this._closeBtn = this._el.querySelector( '.os-ai__close' )!;
		this._resultsEl = this._el.querySelector( '.os-ai__results' )!;

		this._bindEvents();
		this._renderSuggestions();

		// Re-render the command list when plugins register commands
		// after the panel has mounted. If the palette is currently in
		// command mode, refresh it so the new item appears live. The
		// panel is a page-lifetime singleton, so we don't capture the
		// unsubscribe handle — the subscription dies with the page.
		subscribeCommands( () => {
			if ( ! this._isOpen ) {
				return;
			}
			// Harvested commands (Gutenberg block actions, plugin commands)
			// arrive asynchronously after the panel opens; refresh the
			// current surface so they appear live. `_renderForMode` is a
			// no-op while the user is typing an AI question, so it won't
			// clobber in-progress results.
			this._renderForMode();
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
		this._modeInput = { commands: '', ai: '' };
		this._lastAiResult = null;
		this._currentRemoteCommands = [];
		this._remoteSearchToken++;
		this._selectedCommand = 0;
		this._submitBtn.classList.remove( 'has-value' );
		// Open in the mode the "Override…" toggle asks for: AI when it's
		// on (and a provider is configured), else the Commands palette.
		// Commands mode on empty input lists every command (contextual
		// ones from the focused iframe pinned first); AI mode pins those
		// contextual commands then invites a question.
		this._mode = this._defaultMode();
		this._updateModeUI();
		this._renderForMode();

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

	/**
	 * Programmatic Copilot entry point. Injected by `desktop.ts` via
	 * {@link attachAsk} after the shell config is ready so plugins
	 * can `wp.os.ai.ask( '…' )` without poking the DOM.
	 */
	public ask: AskFn = () => {
		throw new Error(
			'[openstation] wp.os.ai.ask called before the shell finished booting.',
		);
	};

	/** Late-binding helper used by `desktop.ts`. Not part of the public API. */
	public attachAsk( fn: AskFn ): void {
		this.ask = fn;
	}

	// ------------------------------------------------------------------
	// Modes — Commands (always) + AI (when a provider is configured)
	// ------------------------------------------------------------------

	/**
	 * Is AI mode available at all? Gated on the "Override…" toggle *and* a
	 * configured provider. When off, the assistant is a plain command
	 * palette — no AI, no mode switch.
	 */
	private _aiModeAllowed(): boolean {
		return this._isAiAvailable() && this._isOverrideEnabled();
	}

	/** The mode ⌘K opens in: AI when the override toggle is on, else Commands. */
	private _defaultMode(): 'commands' | 'ai' {
		return this._aiModeAllowed() ? 'ai' : 'commands';
	}

	/** Switch mode, repaint the toggle + list, and refocus the input. */
	private _setMode( mode: 'commands' | 'ai' ): void {
		const next = mode === 'ai' && ! this._aiModeAllowed() ? 'commands' : mode;
		if ( next !== this._mode ) {
			// Each mode keeps its own draft: stash the current one, restore
			// the target's (e.g. an AI question survives a detour into
			// Commands and back).
			this._modeInput[ this._mode ] = this._input.value;
			this._mode = next;
			this._input.value = this._modeInput[ next ];
			this._submitBtn.classList.toggle(
				'has-value',
				this._input.value.trim().length > 0,
			);
		}
		this._selectedCommand = 0;
		this._selectedSuggestion = 0;
		this._updateModeUI();
		// Returning to Ask AI with the same question re-shows its answer;
		// otherwise paint the mode's normal surface.
		if (
			this._mode === 'ai' &&
			this._lastAiResult &&
			this._lastAiResult.query === this._input.value.trim()
		) {
			this._showResult( this._lastAiResult.query, this._lastAiResult.data );
		} else {
			this._renderForMode();
		}
		this._input.focus();
	}

	/** Reflect the active mode on the switch + input placeholder + input icon. */
	private _updateModeUI(): void {
		const showSwitch = this._aiModeAllowed();
		const sw = this._el.querySelector< HTMLElement >( '.os-ai__modes' );
		if ( sw ) {
			sw.hidden = ! showSwitch;
			sw.querySelectorAll< HTMLButtonElement >( '[data-mode]' ).forEach( ( b ) => {
				const active = b.dataset.mode === this._mode;
				b.classList.toggle( 'is-active', active );
				b.setAttribute( 'aria-pressed', String( active ) );
			} );
		}
		this._input.placeholder =
			this._mode === 'ai' ? __( 'How can I help?' ) : __( 'Search commands…' );
		// The input glyph hints the mode: sparkle for AI, magnifier for
		// Commands (where a sparkle would read as "AI").
		const inputIcon = this._el.querySelector< HTMLElement >(
			'.os-ai__input-icon',
		);
		if ( inputIcon ) {
			inputIcon.innerHTML = this._mode === 'ai' ? ICON_SPARKLE : ICON_SEARCH;
		}
	}

	/**
	 * Are we showing the command list (so keyboard arrows drive it)?
	 * True for `/slug` (any mode), for all plain input in Commands mode,
	 * and for empty input with contextual commands in AI mode.
	 */
	private _isPickMode( parsed: ReturnType< typeof parseCommandInput > ): boolean {
		if ( parsed.isCommand && parsed.hasArgsPart ) {
			return false; // args mode
		}
		if ( parsed.isCommand ) {
			return true; // /slug picker
		}
		if ( this._mode === 'commands' ) {
			return true; // Commands mode filters the registry live
		}
		return this._input.value === '' && listEagerCommands().length > 0;
	}

	/** The command list for the current input + mode. */
	private _commandMatches(): DesktopCommand[] {
		const parsed = parseCommandInput( this._input.value );
		if ( parsed.isCommand ) {
			return this._sortCommands(
				filterCommands( parsed.slug ).filter( ( c ) => c.eager !== true ),
			);
		}
		if ( this._mode === 'ai' ) {
			return this._sortCommands( listEagerCommands() );
		}
		const q = this._input.value.trim();
		const local = this._sortCommands( q === '' ? listCommands() : filterCommands( q ) );
		return [ ...local, ...this._currentRemoteCommands ];
	}

	/** Run a picked command, or lock it in for args when it takes them. */
	private _pickCommand( cmd: DesktopCommand ): void {
		if ( typeof cmd.suggest === 'function' ) {
			this._input.value = `/${ cmd.slug } `;
			this._submitBtn.classList.add( 'has-value' );
			this._input.focus();
			this._renderCommandMode();
			return;
		}
		void this._runCommand( cmd, '' );
	}

	/** Paint the right surface for the current mode + input state. */
	private _renderForMode(): void {
		const parsed = parseCommandInput( this._input.value );
		if ( parsed.isCommand || this._mode === 'commands' ) {
			this._renderCommandMode();
			return;
		}
		// AI mode. Contextual commands (Gutenberg block actions, etc.) are a
		// persistent convenience here — pinned on empty input, and kept
		// visible while composing a question (typing shouldn't dismiss them).
		const hasEager = listEagerCommands().length > 0;
		if ( this._input.value.trim() === '' ) {
			if ( hasEager ) {
				this._renderCommandMode();
			} else {
				this._renderSuggestions();
			}
			return;
		}
		// A shown AI answer stays put for follow-up edits.
		if ( this._resultsEl.querySelector( '.os-ai__bubble' ) ) {
			return;
		}
		if ( hasEager ) {
			this._renderCommandMode();
		} else {
			// No pinned commands and no answer — clear a stale suggestions hint.
			const showingSuggestions = this._resultsEl.querySelector(
				'.os-ai__suggestions',
			);
			if ( showingSuggestions ) {
				this._resultsEl.innerHTML = '';
				this._resultsEl.hidden = true;
			}
		}
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

		// Click outside the panel closes. The backdrop is pointer-events:none,
		// so clicks in the dimmed area land on the overlay container (_el);
		// anything inside the panel is ignored. mousedown (not click) so a
		// text selection that starts in the panel and drags out doesn't close.
		this._el.addEventListener( 'mousedown', ( e: MouseEvent ) => {
			const target = e.target;
			if (
				! ( target instanceof Element ) ||
				! target.closest( '.os-ai__panel' )
			) {
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
		document.addEventListener( 'os-open-ai', () => this.open() );

		// Close button.
		this._closeBtn.addEventListener( 'click', () => this.close() );

		// Mode switch (Commands ↔ AI) — replaces the `/` shortcut.
		this._el
			.querySelectorAll< HTMLButtonElement >( '.os-ai__mode' )
			.forEach( ( b ) => {
				b.addEventListener( 'click', () =>
					this._setMode(
						b.dataset.mode === 'ai' ? 'ai' : 'commands',
					),
				);
			} );

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
			// PICK MODE — the command list is showing (Commands mode, a
			// `/slug` picker in either mode, or AI mode's pinned contextual
			// commands on empty input). Arrows/Enter drive that list.
			// -----------------------------------------------------------
			if ( this._isPickMode( parsed ) ) {
				const matches = this._commandMatches();
				if ( e.key === 'ArrowDown' ) {
					e.preventDefault();
					this._selectedCommand = Math.min(
						this._selectedCommand + 1,
						Math.max( 0, matches.length - 1 ),
					);
					this._keyboardNav = true;
					this._paintCommandSelection();
					return;
				}
				if ( e.key === 'ArrowUp' ) {
					e.preventDefault();
					this._selectedCommand = Math.max( 0, this._selectedCommand - 1 );
					this._keyboardNav = true;
					this._paintCommandSelection();
					return;
				}
				if ( e.key === 'Tab' && matches.length > 0 && parsed.isCommand ) {
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
						if ( parsed.isCommand ) {
							/* translators: %s: command slug, without the leading slash. */
							this._showError( sprintf( __( 'Unknown command: /%s' ), parsed.slug ) );
						}
						// Commands mode with no match: nothing to run.
						return;
					}
					const pick = matches[ this._selectedCommand ] ?? matches[ 0 ];
					this._pickCommand( pick );
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

			const parsed = parseCommandInput( this._input.value );
			const q = this._input.value.trim();

			if ( ! parsed.isCommand && this._mode === 'commands' && q.length > 0 ) {
				void this._fetchRemoteCommands( q );
			} else {
				this._currentRemoteCommands = [];
				this._remoteSearchToken++;
			}

			// Commands mode filters the registry live; AI mode keeps prior
			// results while typing a question (see `_renderForMode`).
			this._renderForMode();
		} );

		// Reset the keyboard-nav guard on any real pointer movement.
		// Without this, after pressing ArrowDown the palette stays
		// "keyboard-controlled" forever and `mouseenter` never regains
		// authority — moving the mouse again should clearly hand
		// control back.
		this._resultsEl.addEventListener( 'mousemove', () => {
			if ( this._keyboardNav ) {
				this._keyboardNav = false;
				const list = this._resultsEl.querySelector( '.os-ai__cmd-list' );
				if ( list ) {
					list.classList.remove( 'os-ai__cmd-list--kb-nav' );
				}
			}
		} );
	}

	// ------------------------------------------------------------------
	// Flow
	// ------------------------------------------------------------------

	private async _onSubmit(): Promise<void> {
		if ( this._isSearching ) {
			return;
		}
		const parsed = parseCommandInput( this._input.value );

		// Command list showing (Commands mode, a `/slug` picker, or AI
		// mode's pinned contextual commands): run the highlighted command.
		if ( this._isPickMode( parsed ) ) {
			const matches = this._commandMatches();
			const pick = matches[ this._selectedCommand ] ?? matches[ 0 ];
			if ( pick ) {
				this._pickCommand( pick );
			}
			return;
		}

		const raw = this._input.value.trim();
		if ( ! raw ) {
			return;
		}

		// `/slug args` — dispatch the locked-in command.
		if ( parsed.isCommand ) {
			const cmd = findCommand( parsed.slug );
			if ( ! cmd ) {
				/* translators: %s: command slug, without the leading slash. */
				this._showError( sprintf( __( 'Unknown command: /%s' ), parsed.slug ) );
				return;
			}
			await this._runCommand( cmd, parsed.args );
			return;
		}

		// AI mode: a natural-language question.
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
		// Plugins can subscribe to os.command.before-run and
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
				gate.reason ??
					/* translators: %s: command slug, without the leading slash. */
					sprintf( __( 'Command /%s was cancelled.' ), cmd.slug ),
			);
			return;
		}

		this._isSearching = true;
		this._submitBtn.disabled = true;
		this._input.disabled = true;
		/* translators: %s: command slug, without the leading slash. */
		this._showThinking( sprintf( __( 'Running /%s…' ), cmd.slug ) );

		const ctx: CommandContext = {
			// Command-initiated close: skip the previousFocus restore.
			// The command is responsible for any focus management
			// (e.g. iframe-bridge.runProxy calls `manager.focus(target)`
			// immediately after `ctx.close()`). The default restore
			// fires on the close-transition's `transitionend` ~300ms
			// later, which would otherwise yank focus back to whatever
			// element was active before the palette opened — typically
			// an element inside a sibling window's iframe — dragging
			// that sibling window to the front and undoing the
			// command's focus choice. User-initiated closes (Escape,
			// click outside) still restore previousFocus as before.
			close: () => {
				this._previousFocus = null;
				this.close();
			},
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
			this._showError(
				/* translators: 1: command slug, without the leading slash. 2: error message. */
				sprintf( __( 'Command /%1$s failed: %2$s' ), cmd.slug, msg ),
			);
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
	 * Default `ctx.confirm()` — uses the framework `<os-confirm-dialog>`
	 * so the prompt matches the rest of the desktop visually. Plugins
	 * can swap in their own implementation; the Promise<boolean>
	 * contract is stable.
	 */
	private _confirm( message: string, details?: string ): Promise< boolean > {
		return osConfirm( {
			title: details ? message : undefined,
			message: details ?? message,
		} );
	}

	/**
	 * Render the value returned by a command. A `void` return means
	 * the command performed a side-effect (e.g. opened a window) and
	 * doesn't need a bubble; in that case we clear the results area.
	 * A plain string is shorthand for `{ message: string }`.
	 */
	private _renderCommandResult( _cmd: DesktopCommand, result: CommandResult ): void {
		if ( result === undefined || result === null ) {
			// Silent success (a side-effect command). If it dismissed the
			// palette (called ctx.close), just clear; if it left the palette
			// open (e.g. "View site" opened a new tab), return to the live
			// surface so the command list is usable again.
			if ( this._isOpen ) {
				this._renderForMode();
			} else {
				this._resultsEl.innerHTML = '';
				this._resultsEl.hidden = true;
			}
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
		this._showThinking( __( 'Thinking…' ) );

		// Two transports, picked by the user in OpenStation Preferences → AI Settings:
		//   - 'sse' — real-time progress ticks via EventSource. Preferred
		//     UX, but some hosts (locked-down shared environments,
		//     buffering proxies) drop the stream and surface as "Lost
		//     connection to the assistant". Power users opt in.
		//   - 'off' (default) — single REST request. No progress ticks;
		//     the user sees "Thinking…" until the final answer. Reliable
		//     everywhere.
		// We additionally fall back to fetch when EventSource is missing
		// or PHP didn't provision a stream URL, so an SSE pick on a host
		// that can't actually run it still degrades gracefully.
		const useSse =
			this._getTransport() === 'sse' &&
			typeof EventSource !== 'undefined' &&
			!! this._aiSearchStreamUrl;
		if ( useSse ) {
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
			let data: {
				event?: string;
				message?: string;
				code?: string;
				result?: SearchResult;
			};
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
					this._showError(
						data.message ?? __( 'Something went wrong.' ),
						data.code,
					);
					finish();
					break;
			}
		};

		es.onerror = () => {
			// Connection dropped mid-stream. If we never received 'done'
			// we need to show a user-visible error, otherwise the user
			// would stare at a stale "Thinking…".
			if ( this._currentStream === es ) {
				this._showError(
					__( 'Lost connection to the assistant. Please try again.' ),
				);
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

			const res = await trackedFetch(
				this._aiSearchUrl,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-WP-Nonce': this._restNonce,
					},
					body: JSON.stringify( body ),
				},
				{ source: 'desktop-mode/ai-search' },
			);

			if ( ! res.ok ) {
				const err = await res.json().catch( () => ( {} ) ) as {
					message?: string;
					code?: string;
				};
				this._showError(
					err.message ??
						/* translators: %d: HTTP status code. */
						sprintf( __( 'Server returned %d' ), res.status ),
					err.code,
				);
				return;
			}

			this._showResult( query, await res.json() as SearchResult );
		} catch {
			this._showError(
				__( 'Network error — please check your connection and try again.' ),
			);
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

	/**
	 * Fetch posts/pages via `/wp/v2/search` and store as pickable
	 * command items. 200 ms debounce + token-based staleness guard.
	 * Only fires in Commands mode.
	 */
	private async _fetchRemoteCommands( query: string ): Promise<void> {
		const token = ++this._remoteSearchToken;
		try {
			// Debounce typing
			await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );
			if ( token !== this._remoteSearchToken ) {
				return;
			}

			const res = await trackedFetch(
				`/wp-json/wp/v2/search?search=${ encodeURIComponent( query ) }&subtype=post,page`,
				{
					headers: { 'X-WP-Nonce': this._restNonce },
				},
				{ silent: true },
			);

			if ( ! res.ok ) {
				return;
			}

			const items = ( await res.json().catch( () => [] ) ) as Array<{
				id: number;
				title: string;
				subtype: string;
				url: string;
			}>;

			if ( token !== this._remoteSearchToken ) {
				return;
			}

			this._currentRemoteCommands = items.map( ( item ) => {
				const isPage = item.subtype === 'page';
				const editUrl = new URL( 'post.php', this._adminUrl );
				editUrl.searchParams.set( 'post', String( item.id ) );
				editUrl.searchParams.set( 'action', 'edit' );
				const href = editUrl.toString();
				const title = decodeHTML( item.title || __( '(No title)' ) );
				const icon = isPage ? 'dashicons-admin-page' : 'dashicons-admin-post';

				return {
					slug: `post-${ item.id }`,
					label: title,
					description: this._entityTypeLabel( isPage ? 'page' : 'post' ),
					icon,
					eager: false,
					run: ( _args, ctx ) => {
						ctx.openInWindow( href, title, icon );
					},
				};
			} );

			// Re-render so new matches appear in Commands mode.
			if ( this._isOpen ) {
				this._renderForMode();
			}
		} catch ( err ) {
			// Ignore network errors for background search
		}
	}

	// ------------------------------------------------------------------
	// Open helpers — everything opens as a legacy iframe window, not a
	// new browser tab, so the admin experience stays inside the desktop.
	// ------------------------------------------------------------------

	private _getDesktopShell(): DesktopShellLite | null {
		const shell = ( window as unknown as {
			wp?: { os?: DesktopShellLite };
		} ).wp?.os;
		return shell ?? null;
	}

	/**
	 * Open OpenStation Preferences on the Features tab so the user can turn the
	 * assistant on in one click from the "assistant is off" error state.
	 * Closes the assistant first so the settings window isn't hidden behind
	 * it, and drops the stored focus target so closing doesn't bounce
	 * focus back to the launcher away from the settings window.
	 */
	private _openAssistantSettings(): void {
		const shell = this._getDesktopShell();
		this._previousFocus = null;
		this.close();
		shell?.openOsSettings?.( { tabId: 'features' } );
	}

	private _openInLegacyWindow( url: string, title: string, icon?: string ): void {
		const shell = this._getDesktopShell();
		if ( ! shell || ! shell.windowManager ) {
			// Graceful fallback — if the shell isn't initialised yet,
			// just open in a new tab rather than silently doing nothing.
			window.open( url, '_blank', 'noopener' );
			return;
		}
		// `windowManager.open()` requires a non-empty `id`. Reuse the
		// shell's URL→id helper so the window coalesces with any existing
		// one for the same admin page, matching dock launches. Fall back
		// to a URL-derived synthetic id when the helper isn't available —
		// older shells and test doubles.
		const id = shell.deriveWindowId
			? shell.deriveWindowId( url, this._adminUrl )
			: 'os-ai-' + url.replace( /[^a-z0-9]+/gi, '-' ).slice( 0, 80 );
		shell.windowManager.open( {
			id,
			url,
			title,
			icon: icon ?? 'dashicons-admin-generic',
		} );
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

		// Picking mode. The candidate set depends on mode + input
		// (see `_commandMatches`): Commands mode lists the whole registry
		// (contextual commands pinned first) and filters live; `/<query>`
		// filters the slash-only baseline; AI mode pins only contextual
		// commands on empty input.
		const matches = this._commandMatches();

		if ( matches.length === 0 ) {
			const q = parsed.isCommand ? `/${ parsed.slug }` : this._input.value.trim();
			const message = sprintf(
				/* translators: %s: the text the user typed, wrapped in <strong>. */
				__( 'No commands matching %s.' ),
				`<strong>${ this._esc( q ) }</strong>`,
			);
			this._resultsEl.innerHTML = `
				<div class="os-ai__state os-ai__state--empty">
					<span>${ message }</span>
				</div>
			`;
			return;
		}

		// Clamp selection so it doesn't outrun the filtered set.
		if ( this._selectedCommand >= matches.length ) {
			this._selectedCommand = 0;
		}

		// Only show the selection highlight when the list is keyboard-driven.
		// In AI mode while typing a question the commands are still shown (a
		// convenience) but Enter asks the AI, so a highlighted row would
		// mislead.
		const pickable = this._isPickMode( parsed );

		const items = matches
			.map( ( c, i ) => {
				const selected = pickable && i === this._selectedCommand ? ' is-selected' : '';
				const isEntity = this._isEntityResultCommand( c );
				return `
					<button
						type="button"
						class="os-ai__cmd-item${ selected }${ isEntity ? ' is-entity-result' : '' }"
						data-slug="${ this._esc( c.slug ) }"
						data-index="${ i }"
					>
						${ c.iconSvg
							? `<span class="os-ai__cmd-icon os-ai__cmd-icon--svg" aria-hidden="true">${ c.iconSvg }</span>`
							: `<span class="os-ai__cmd-icon dashicons ${ this._esc( c.icon ?? 'dashicons-arrow-right-alt' ) }" aria-hidden="true"></span>` }
						<span class="os-ai__cmd-body">
							<span class="os-ai__cmd-title">
								${ this._esc( c.label ) }
								${ c.hint ? `<span class="os-ai__cmd-hint">${ this._esc( c.hint ) }</span>` : '' }
							</span>
							${ c.description
								? `<span class="os-ai__cmd-desc">${ this._esc( c.description ) }</span>`
								: '' }
						</span>
					</button>
				`;
			} )
			.join( '' );

		// The "Commands" heading is redundant with the "Command palette" title
		// in Commands mode. Keep it only in AI mode — it labels the
		// contextual (eager) commands section above the assistant input.
		const heading =
			this._mode === 'ai' && listEagerCommands().length > 0
				? `<p class="os-ai__suggestions-label">${ this._esc(
					__( 'Suggested commands' ),
				) }</p>`
				: '';
		this._resultsEl.innerHTML = `
			<div class="os-ai__cmd-list">
				${ heading }
				${ items }
			</div>
		`;

		// Click handlers — clicking a row runs the command (or locks it in
		// for args when it takes them), like a command palette.
		// NOTE: `findCommand()` only searches the command registry, but
		// remote entity-search results from `_fetchRemoteCommands` live
		// in `_currentRemoteCommands` — they're NOT registered. We use
		// `data-index` to look up from the fresh match list instead.
		this._resultsEl
			.querySelectorAll< HTMLButtonElement >( '.os-ai__cmd-item' )
			.forEach( ( btn ) => {
				btn.addEventListener( 'click', () => {
					const idx = parseInt( btn.dataset.index ?? '', 10 );
					if ( ! Number.isNaN( idx ) ) {
						const clickMatches = this._commandMatches();
						const cmd = clickMatches[ idx ];
						if ( cmd ) {
							this._pickCommand( cmd );
						}
					}
				} );
				btn.addEventListener( 'mouseenter', () => {
					// Ignore `mouseenter` fired by the DOM landing under
					// the pointer after a keyboard arrow re-render. A
					// real `mousemove` clears the guard.
					if ( this._keyboardNav ) {
						return;
					}
					const idx = parseInt( btn.dataset.index ?? '0', 10 );
					if ( ! Number.isNaN( idx ) ) {
						this._selectedCommand = idx;
						this._resultsEl
							.querySelectorAll( '.os-ai__cmd-item' )
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
				.querySelectorAll< HTMLButtonElement >( '.os-ai__cmd-suggest-item' )
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
			<div class="os-ai__cmd-active">
				<span class="os-ai__cmd-icon dashicons ${ this._esc(
					cmd.icon ?? 'dashicons-arrow-right-alt',
				) }" aria-hidden="true"></span>
				<div class="os-ai__cmd-body">
					<span class="os-ai__cmd-title">
						/${ this._esc( cmd.slug ) }
						${ cmd.hint ? `<span class="os-ai__cmd-hint">${ this._esc( cmd.hint ) }</span>` : '' }
					</span>
					${ cmd.description
						? `<span class="os-ai__cmd-desc">${ this._esc( cmd.description ) }</span>`
						: '' }
					${ standalone
						? `<span class="os-ai__cmd-enter-hint">${ sprintf(
							/* translators: %s: the Enter key, rendered as a <kbd> glyph. */
							__( 'Press %s to run' ),
							'<kbd>↵</kbd>',
						) }</span>`
						: '' }
				</div>
			</div>
		`;
	}

	/** Render the list of suggestions under the command header. */
	private _renderSuggestionList( suggestions: CommandSuggestion[] ): string {
		if ( suggestions.length === 0 ) {
			const message = sprintf(
				/* translators: %s: the Enter key, rendered as a <kbd> glyph. */
				__( 'No suggestions — press %s to run with the text you typed.' ),
				'<kbd>↵</kbd>',
			);
			return `
				<div class="os-ai__state os-ai__state--empty">
					<span>${ message }</span>
				</div>
			`;
		}
		const items = suggestions
			.map( ( s, i ) => {
				const selected = i === this._selectedSuggestion ? ' is-selected' : '';
				return `
					<button
						type="button"
						class="os-ai__cmd-suggest-item${ selected }"
						data-index="${ i }"
					>
						<span class="os-ai__cmd-icon dashicons ${ this._esc(
							s.icon ?? 'dashicons-arrow-right-alt',
						) }" aria-hidden="true"></span>
						<span class="os-ai__cmd-body">
							<span class="os-ai__cmd-suggest-label">${ this._esc( s.label ) }</span>
							${ s.description
								? `<span class="os-ai__cmd-desc">${ this._esc( s.description ) }</span>`
								: '' }
						</span>
					</button>
				`;
			} )
			.join( '' );
		return `<div class="os-ai__cmd-suggest-list">${ items }</div>`;
	}

	/**
	 * Stable sort used everywhere the palette turns a command list into
	 * UI: iframe-harvested commands (owner prefix `iframe:`) float to
	 * the top so contextual Gutenberg / admin commands from the focused
	 * window read first. Tier-3 loader entries register ahead of tier-2
	 * statics inside the bridge, so "stable" preserves that ordering
	 * within the iframe block.
	 */
	private _sortCommands( list: DesktopCommand[] ): DesktopCommand[] {
		return list.slice().sort( ( a, b ) => {
			const aIframe = typeof a.owner === 'string' && a.owner.startsWith( 'iframe:' ) ? 0 : 1;
			const bIframe = typeof b.owner === 'string' && b.owner.startsWith( 'iframe:' ) ? 0 : 1;
			return aIframe - bIframe;
		} );
	}

	/** Identify remote entity-search results without tying styling to slug naming. */
	private _isEntityResultCommand( cmd: DesktopCommand ): boolean {
		return this._currentRemoteCommands.includes( cmd );
	}

	/**
	 * Flip the is-selected class on the command rows without re-rendering
	 * the whole list. Re-rendering caused two bad effects: (a) fresh DOM
	 * nodes fired `mouseenter` under the pointer and jumped selection
	 * back to wherever the mouse was, (b) focus / scroll state was lost.
	 * Keeping the DOM stable and just flipping a class preserves both.
	 * Also scrolls the newly-selected row into view for long lists.
	 */
	private _paintCommandSelection(): void {
		const items = this._resultsEl.querySelectorAll< HTMLElement >( '.os-ai__cmd-item' );
		items.forEach( ( el, i ) => {
			el.classList.toggle( 'is-selected', i === this._selectedCommand );
		} );
		// Suppress :hover on the list while keyboard nav is active —
		// without this the row under the mouse pointer stays styled as
		// active alongside the new keyboard-selected row.
		const list = this._resultsEl.querySelector< HTMLElement >( '.os-ai__cmd-list' );
		if ( list ) {
			list.classList.toggle( 'os-ai__cmd-list--kb-nav', this._keyboardNav );
		}
		const active = items[ this._selectedCommand ];
		if ( active && typeof active.scrollIntoView === 'function' ) {
			active.scrollIntoView( { block: 'nearest' } );
		}
	}

	/** Flip the is-selected class on the suggestion rows without re-rendering the whole list. */
	private _paintSuggestionSelection(): void {
		this._resultsEl
			.querySelectorAll( '.os-ai__cmd-suggest-item' )
			.forEach( ( el, i ) => {
				el.classList.toggle( 'is-selected', i === this._selectedSuggestion );
			} );
	}

	private _renderSuggestions(): void {
		this._resultsEl.hidden = false;
		this._resultsEl.innerHTML = `
			<div class="os-ai__suggestions">
				<p class="os-ai__suggestions-label">${ this._esc( __( 'Try asking' ) ) }</p>
				<div class="os-ai__suggestions-list">
					${ suggestedPrompts().map(
						( p ) => `<button type="button" class="os-ai__suggestion" data-prompt="${ this._esc( p ) }">
							${ this._esc( p ) }
						</button>`,
					).join( '' ) }
				</div>
			</div>
		`;

		// Wire suggestion clicks — fill the input and submit.
		this._resultsEl
			.querySelectorAll<HTMLButtonElement>( '.os-ai__suggestion' )
			.forEach( ( btn ) => {
				btn.addEventListener( 'click', () => {
					const prompt = btn.dataset.prompt ?? '';
					this._input.value = prompt;
					this._submitBtn.classList.add( 'has-value' );
					this._input.focus();
				} );
			} );
	}

	private _showThinking( message: string = __( 'Thinking…' ) ): void {
		this._resultsEl.hidden = false;
		this._resultsEl.innerHTML = `
			<div class="os-ai__state os-ai__state--thinking">
				${ ICON_SPINNER }
				<span>${ this._esc( message ) }</span>
			</div>
		`;
	}

	private _showError( message: string, code?: string ): void {
		this._resultsEl.hidden = false;

		// The "assistant is off" case is recoverable in one click, so we
		// turn the "OpenStation Preferences → Features" mention in the message into an
		// inline link that opens OpenStation Preferences on the Features tab. Keyed on
		// the server error code, not the wording, so the affordance survives
		// copy tweaks; the regex spans whatever sits between the two anchors
		// (arrow, spacing) and falls back to a trailing link if absent.
		if ( code === 'openstation_ai_disabled' ) {
			const escaped = this._esc( message );
			const linkify = ( text: string ) =>
				`<button type="button" class="os-ai__settings-link">${ text }</button>`;
			const phrase = /OpenStation Preferences.*?Features/;
			const withLink = phrase.test( escaped )
				? escaped.replace( phrase, ( match ) => linkify( match ) )
				: `${ escaped } ${ linkify( this._esc( __( 'Features' ) ) ) }`;
			this._resultsEl.innerHTML = `
				<div class="os-ai__state os-ai__state--error">
					<span>${ withLink }</span>
				</div>
			`;
			this._resultsEl
				.querySelector< HTMLButtonElement >( '.os-ai__settings-link' )
				?.addEventListener( 'click', () => this._openAssistantSettings() );
			return;
		}

		this._resultsEl.innerHTML = `
			<div class="os-ai__state os-ai__state--error">
				<span>${ this._esc( message ) }</span>
			</div>
		`;
	}

	private _showResult( query: string, data: SearchResult ): void {
		// Remember AI answers (command results pass an empty query) so
		// returning to Ask AI mode can re-show them.
		if ( query !== '' ) {
			this._lastAiResult = { query, data };
		}
		this._resultsEl.hidden = false;

		// Assistant-styled message bubble appears at the top of every
		// answer regardless of answer_type — so the UX always feels like
		// a reply from the assistant.
		const messageHtml = `
			<div class="os-ai__bubble">
				<span class="os-ai__bubble-icon">${ ICON_SPARKLE }</span>
				<div class="os-ai__bubble-text">${ renderMarkdown( data.message || '' ) }</div>
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
				<button type="button" class="os-ai__continue-btn"
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
			'.os-ai__entity-open',
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
			'.os-ai__admin-link',
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
		const cont = this._resultsEl.querySelector<HTMLButtonElement>( '.os-ai__continue-btn' );
		if ( cont ) {
			cont.addEventListener( 'click', () => {
				const tool = cont.dataset.tool ?? null;
				const offset = parseInt( cont.dataset.offset ?? '0', 10 );
				const q = cont.dataset.query ?? query;
				this._runSearch( q, tool, offset );
			} );
		}
	}

	/**
	 * Display name for an entity type. A lookup rather than capitalising
	 * the server's type slug — that trick only produces a word in English.
	 */
	private _entityTypeLabel( type: EntityDetail[ 'type' ] ): string {
		switch ( type ) {
			case 'page':
				return __( 'Page' );
			case 'comment':
				return __( 'Comment' );
			default:
				return __( 'Post' );
		}
	}

	/** Label for the entity card's open button, one full sentence per type. */
	private _entityOpenLabel( type: EntityDetail[ 'type' ] ): string {
		switch ( type ) {
			case 'page':
				return __( 'Open page in desktop' );
			case 'comment':
				return __( 'Open comment in desktop' );
			default:
				return __( 'Open post in desktop' );
		}
	}

	private _renderEntityCard( e: EntityDetail ): string {
		const isComment = e.type === 'comment';
		const title = isComment
			? sprintf(
				/* translators: %s: title of the post the comment was left on. */
				__( 'Comment on “%s”' ),
				this._esc( e.post_title ?? __( 'post' ) ),
			)
			: this._esc( e.title ?? __( 'Untitled' ) );
		const summary = this._esc( e.ai_summary || e.excerpt || '' );
		const typeLabel = this._entityTypeLabel( e.type );
		const topicChip = e.topic ? `<span class="os-ai__entity-topic">${ this._esc( e.topic ) }</span>` : '';

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
			<div class="os-ai__entity">
				<div class="os-ai__entity-header">
					${ topicChip }
					<span class="os-ai__entity-type">${ this._esc( typeLabel ) }</span>
				</div>
				<h3 class="os-ai__entity-title">${ title }</h3>
				<p class="os-ai__entity-summary">${ summary }</p>
				<button type="button"
					class="os-ai__entity-open"
					data-url="${ this._esc( e.edit_url ) }"
					data-title="${ this._esc( e.title ?? e.post_title ?? typeLabel ) }"
					data-icon="${ icon }">
					<span>${ this._esc( this._entityOpenLabel( e.type ) ) }</span>
					${ ICON_ARROW }
				</button>
			</div>
		`;
	}

	private _renderAdminLinks( links: AdminLink[] ): string {
		const items = links.map( ( link ) => `
			<button type="button"
				class="os-ai__admin-link"
				data-url="${ this._esc( link.url ) }"
				data-title="${ this._esc( link.title ) }"
				data-icon="${ this._esc( link.icon ) }">
				<span class="os-ai__admin-link-icon dashicons ${ this._esc( link.icon ) }" aria-hidden="true"></span>
				<span class="os-ai__admin-link-body">
					<span class="os-ai__admin-link-title">${ this._esc( link.title ) }</span>
					<span class="os-ai__admin-link-desc">${ this._esc( link.description ) }</span>
				</span>
				<span class="os-ai__admin-link-arrow">${ ICON_ARROW }</span>
			</button>
		` ).join( '' );

		return `<div class="os-ai__admin-links">${ items }</div>`;
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
		el.id = 'desktop-mode-ai-assistant';
		el.className = 'os-ai';
		el.setAttribute( 'role', 'dialog' );
		el.setAttribute( 'aria-modal', 'true' );
		el.setAttribute( 'aria-label', __( 'Site Assistant' ) );
		el.setAttribute( 'aria-hidden', 'true' );
		el.setAttribute( 'hidden', '' );

		el.innerHTML = `
			<div class="os-ai__backdrop" aria-hidden="true"></div>
			<div class="os-ai__panel">
				<div class="os-ai__header">
					<span class="os-ai__header-icon">${ ICON_SITE_LOGO }</span>
					<span class="os-ai__header-label">${ this._esc( __( 'Site Assistant' ) ) }</span>
					<div class="os-ai__modes" role="group" aria-label="${ this._esc(
						__( 'Assistant mode' ),
					) }" hidden>
						<button type="button" class="os-ai__mode" data-mode="ai" aria-pressed="false">${ this._esc(
							__( 'Ask AI' ),
						) }</button>
						<button type="button" class="os-ai__mode" data-mode="commands" aria-pressed="false">${ this._esc(
							__( 'Commands' ),
						) }</button>
					</div>
					<button type="button" class="os-ai__close" aria-label="${ this._esc( __( 'Close' ) ) }">
						${ ICON_CLOSE }
					</button>
				</div>
				<div class="os-ai__input-wrap">
					<span class="os-ai__input-icon">${ ICON_SPARKLE }</span>
					<input
						class="os-ai__input"
						type="text"
						placeholder="${ this._esc( __( 'How can I help?' ) ) }"
						autocomplete="off"
						spellcheck="false"
						aria-label="${ this._esc( __( 'Ask the assistant' ) ) }"
					/>
					<button type="button" class="os-ai__submit" aria-label="${ this._esc( __( 'Send' ) ) }">
						${ ICON_RETURN }
					</button>
				</div>
				<div class="os-ai__results" hidden></div>
				<div class="os-ai__footer">
					<span class="os-ai__footer-hint">
						${ this._esc(
							__(
								'Your assistant to quickly navigate and manage your entire site.',
							),
						) }
					</span>
				</div>
			</div>
		`;

		return el;
	}
}
