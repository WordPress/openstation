import { HOOKS, doAction, applyFilters } from '../hooks';
import { __, _x, sprintf } from '../i18n';
import { osConfirm } from '../os-confirm';
import { trackedFetch } from '../tracked-fetch';
import { decodeHTML } from '../utils';
import { osIconSvg } from '../ui/icons';
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

const ICON_SPARKLE = osIconSvg( 'copilot', { size: 16 } );

const ICON_ARROW = osIconSvg( 'chevron-right', { size: 16 } );

const ICON_SEARCH = osIconSvg( 'search', { size: 16 } );

const ICON_RETURN = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<polyline points="14,4 14,10 3,10"/>
	<polyline points="6,7 3,10 6,13"/>
</svg>`;

const ICON_SPINNER = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="os-ai__spinner-icon">
	<circle cx="10" cy="10" r="7" stroke-opacity="0.25"/>
	<path d="M10 3 A7 7 0 0 1 17 10" stroke-opacity="1"/>
</svg>`;

const WPORG_ICON_URL = /^https:\/\/(?:ps|s)\.w\.org\//;

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

interface WindowManagerLite {
	open( cfg: {
		id: string;
		url: string;
		title: string;
		icon?: string;
		native?: boolean;
	} ): unknown;
}

interface DesktopShellLite {
	windowManager?: WindowManagerLite;
	deriveWindowId?: ( url: string, adminUrl?: string ) => string;
	openOsSettings?: ( opts?: { tabId?: string } ) => void;
}

function suggestedPrompts(): string[] {
	return [
		__( 'Find my post about…' ),
		__( 'Where can I see categories?' ),
		__( 'Do I have any spam comments?' ),
		__( 'Take me to plugin settings' ),
	];
}

export class AiAssistant implements AiAssistantApi {
	private _el: HTMLElement;
	private _input: HTMLInputElement;
	private _submitBtn: HTMLButtonElement;
	private _resultsEl: HTMLElement;
	private _isOpen = false;
	private _isSearching = false;
	private _previousFocus: Element | null = null;

	private _closeFadeCleanup: ( () => void ) | null = null;
	private _aiSearchUrl: string;
	private _restNonce: string;

	private _searchAbort: AbortController | null = null;
	private _adminUrl: string;

	private _isAiSupported: () => boolean;

	private _canConnectProvider: () => boolean;

	private _isAiAvailable: () => boolean;

	private _isOverrideEnabled: () => boolean;

	private _mode: 'commands' | 'ai' = 'commands';

	private _modeInput: { commands: string; ai: string } = {
		commands: '',
		ai: '',
	};

	private _lastAiResult: { query: string; data: SearchResult } | null = null;
	private _currentRemoteCommands: DesktopCommand[] = [];
	private _remoteSearchToken = 0;

	private _baselineLoading = false;

	private _selectedCommand = 0;

	private _keyboardNav = false;

	private _selectedSuggestion = 0;

	private _currentSuggestions: CommandSuggestion[] = [];

	private _suggestToken = 0;

	constructor( config: AiAssistantConfig ) {
		this._aiSearchUrl = config.aiSearchUrl;
		this._restNonce = config.restNonce;
		this._adminUrl = config.adminUrl;
		this._isAiSupported = config.isAiSupported ?? ( () => true );
		this._canConnectProvider = config.canConnectProvider ?? ( () => true );
		this._isAiAvailable = config.isAiAvailable ?? ( () => false );
		this._isOverrideEnabled = config.isOverrideEnabled ?? ( () => false );

		this._el = this._buildDOM();
		document.body.appendChild( this._el );

		this._input = this._el.querySelector( '.os-ai__input' )!;
		this._submitBtn = this._el.querySelector( '.os-ai__submit' )!;
		this._resultsEl = this._el.querySelector( '.os-ai__results' )!;

		this._bindEvents();
		this._renderSuggestions();

		subscribeCommands( () => {
			if ( ! this._isOpen || this._isShowingOutcome() ) {
				return;
			}

			this._renderForMode();
		} );
	}

	private _isShowingOutcome(): boolean {
		return (
			this._isSearching ||
			null !== this._resultsEl.querySelector( '.os-ai__bubble, .os-ai__state--error' )
		);
	}

	open(): void {
		if ( this._isOpen ) {
			this._input.focus();
			this._input.select();
			return;
		}
		this._isOpen = true;
		this._previousFocus = this._el.ownerDocument.activeElement;

		this._input.value = '';
		this._modeInput = { commands: '', ai: '' };
		this._lastAiResult = null;
		this._currentRemoteCommands = [];
		this._remoteSearchToken++;
		this._selectedCommand = 0;
		this._submitBtn.classList.remove( 'has-value' );

		this._mode = this._defaultMode();
		this._updateModeUI();
		this._renderForMode();

		this._closeFadeCleanup?.();

		this._el.removeAttribute( 'hidden' );
		void this._el.offsetHeight;
		this._el.classList.add( 'is-open' );
		this._el.setAttribute( 'aria-hidden', 'false' );

		document.dispatchEvent(
			new CustomEvent( 'os-palette-opened', {
				detail: { id: 'desktop-mode-ai-assistant' },
			} ),
		);

		requestAnimationFrame( () => this._input.focus() );
	}

	close(): void {
		if ( ! this._isOpen ) {
			return;
		}
		this._isOpen = false;
		this._el.classList.remove( 'is-open' );
		this._el.setAttribute( 'aria-hidden', 'true' );
		this._abortSearch();
		this._isSearching = false;
		this._submitBtn.disabled = false;
		this._input.disabled = false;

		document.dispatchEvent(
			new CustomEvent( 'os-palette-closed', {
				detail: { id: 'desktop-mode-ai-assistant' },
			} ),
		);

		this._closeFadeCleanup?.();
		const onEnd = ( e: TransitionEvent ) => {
			if ( e.target !== this._el || e.propertyName !== 'opacity' ) {
				return;
			}
			this._el.removeEventListener( 'transitionend', onEnd );
			this._closeFadeCleanup = null;
			if ( this._isOpen ) {
				return;
			}
			this._el.setAttribute( 'hidden', '' );
			if ( this._previousFocus instanceof HTMLElement ) {
				this._previousFocus.focus();
			}
		};
		this._closeFadeCleanup = () => {
			this._el.removeEventListener( 'transitionend', onEnd );
			this._closeFadeCleanup = null;
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

	public ask: AskFn = () => {
		throw new Error(
			'[openstation] wp.os.ai.ask called before the shell finished booting.',
		);
	};

	public attachAsk( fn: AskFn ): void {
		this.ask = fn;
	}

	public setBaselineLoading( loading: boolean ): void {
		if ( this._baselineLoading === loading ) {
			return;
		}
		this._baselineLoading = loading;
		const row = this._resultsEl.querySelector< HTMLElement >(
			'.os-ai__state--loading',
		);
		if ( row ) {
			row.hidden = ! loading;
		}
	}

	private _aiModeAllowed(): boolean {
		return this._isAiAvailable() && this._isOverrideEnabled();
	}

	private _defaultMode(): 'commands' | 'ai' {
		return this._aiModeAllowed() ? 'ai' : 'commands';
	}

	private _aiNeedsSetup(): boolean {
		return this._mode === 'ai' && ! this._aiModeAllowed();
	}

	private _setMode( next: 'commands' | 'ai' ): void {
		if ( next !== this._mode ) {
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

	private _updateModeUI(): void {
		this._el
			.querySelectorAll< HTMLButtonElement >( '.os-ai__modes [data-mode]' )
			.forEach( ( b ) => {
				const active = b.dataset.mode === this._mode;
				b.classList.toggle( 'is-active', active );
				b.setAttribute( 'aria-pressed', String( active ) );
			} );

		const needsSetup = this._aiNeedsSetup();
		this._input.readOnly = needsSetup;

		if ( needsSetup ) {
			this._input.setAttribute( 'aria-describedby', 'os-ai-setup-message' );
		} else {
			this._input.removeAttribute( 'aria-describedby' );
		}
		if ( needsSetup ) {
			this._input.placeholder = __( 'The AI assistant isn’t set up yet' );
		} else {
			this._input.placeholder =
				this._mode === 'ai' ? __( 'How can I help?' ) : __( 'Search commands…' );
		}

		const inputIcon = this._el.querySelector< HTMLElement >(
			'.os-ai__input-icon',
		);
		if ( inputIcon ) {
			inputIcon.innerHTML = this._mode === 'ai' ? ICON_SPARKLE : ICON_SEARCH;
		}
	}

	private _isPickMode( parsed: ReturnType< typeof parseCommandInput > ): boolean {
		if ( this._aiNeedsSetup() ) {
			return false;
		}
		if ( parsed.isCommand && parsed.hasArgsPart ) {
			return false;
		}
		if ( parsed.isCommand ) {
			return true;
		}
		if ( this._mode === 'commands' ) {
			return true;
		}
		return this._input.value === '' && listEagerCommands().length > 0;
	}

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

	private _renderForMode(): void {
		const parsed = parseCommandInput( this._input.value );
		if ( parsed.isCommand || this._mode === 'commands' ) {
			this._renderCommandMode();
			return;
		}
		if ( this._aiNeedsSetup() ) {
			this._renderAiSetup();
			return;
		}

		const hasEager = listEagerCommands().length > 0;
		if ( this._input.value.trim() === '' ) {
			if ( hasEager ) {
				this._renderCommandMode();
			} else {
				this._renderSuggestions();
			}
			return;
		}

		if ( this._resultsEl.querySelector( '.os-ai__bubble' ) ) {
			return;
		}
		if ( hasEager ) {
			this._renderCommandMode();
		} else {
			const showingSuggestions = this._resultsEl.querySelector(
				'.os-ai__suggestions',
			);
			if ( showingSuggestions ) {
				this._resultsEl.innerHTML = '';
				this._resultsEl.hidden = true;
			}
		}
	}

	private _bindEvents(): void {
		this._el.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			if ( e.key === 'Escape' ) {
				e.stopPropagation();
				this.close();
			}
		} );

		this._el.addEventListener( 'mousedown', ( e: MouseEvent ) => {
			const target = e.target;
			if (
				! ( target instanceof Element ) ||
				! target.closest( '.os-ai__panel' )
			) {
				this.close();
			}
		} );

		this._el.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			if ( e.key !== 'Tab' ) {
				return;
			}

			const focusable = [
				this._input,
				this._submitBtn,
				...this._el.querySelectorAll< HTMLButtonElement >(
					'.os-ai__mode, .os-ai__settings-link',
				),
			].filter( ( el ) => ! el.disabled );
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

		document.addEventListener( 'os-open-ai', () => this.open() );

		this._el
			.querySelectorAll< HTMLButtonElement >( '.os-ai__mode' )
			.forEach( ( b ) => {
				b.addEventListener( 'click', () =>
					this._setMode(
						b.dataset.mode === 'ai' ? 'ai' : 'commands',
					),
				);
			} );

		this._submitBtn.addEventListener( 'click', () => this._onSubmit() );

		this._input.addEventListener( 'keydown', ( e: KeyboardEvent ) => {
			const parsed = parseCommandInput( this._input.value );

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
							this._showError( sprintf( __( 'Unknown command: /%s' ), parsed.slug ) );
						}

						return;
					}
					const pick = matches[ this._selectedCommand ] ?? matches[ 0 ];
					this._pickCommand( pick );
					return;
				}
			}

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
						e.preventDefault();
						const pick = this._currentSuggestions[ this._selectedSuggestion ];
						const finalArgs = pick ? pick.value : parsed.args;
						this._runCommand( cmd, finalArgs );
						return;
					}
				}
			}

			if ( e.key === 'Enter' && ! e.shiftKey ) {
				e.preventDefault();
				this._onSubmit();
			}
		} );

		this._input.addEventListener( 'input', () => {
			const hasValue = this._input.value.trim().length > 0;
			this._submitBtn.classList.toggle( 'has-value', hasValue );

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

			this._renderForMode();
		} );

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

	private async _onSubmit(): Promise<void> {
		if ( this._isSearching ) {
			this._warnBusy( 'submit' );
			return;
		}
		if ( this._aiNeedsSetup() ) {
			if ( this._aiSetupRoute() === 'preferences' ) {
				this._openAssistantSettings( 'features' );
			}
			return;
		}
		const parsed = parseCommandInput( this._input.value );

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

		if ( parsed.isCommand ) {
			const cmd = findCommand( parsed.slug );
			if ( ! cmd ) {
				this._showError( sprintf( __( 'Unknown command: /%s' ), parsed.slug ) );
				return;
			}
			await this._runCommand( cmd, parsed.args );
			return;
		}

		await this._runSearch( raw, null, 0 );
	}

	private async _runCommand( cmd: DesktopCommand, args: string ): Promise<void> {
		if ( this._isSearching ) {
			this._warnBusy( `run /${ cmd.slug }` );
			return;
		}

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

					sprintf( __( 'Command /%s was cancelled.' ), cmd.slug ),
			);
			return;
		}

		this._isSearching = true;
		this._submitBtn.disabled = true;
		this._input.disabled = true;

		this._showThinking( sprintf( __( 'Running /%s…' ), cmd.slug ) );

		const ctx: CommandContext = {

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

	private _warnBusy( what: string ): void {
		console.warn(
			`[openstation] command palette is busy — ignored: ${ what }. A search or command is still running.`,
		);
	}

	private _confirm( message: string, details?: string ): Promise< boolean > {
		return osConfirm( {
			title: details ? message : undefined,
			message: details ?? message,
		} );
	}

	private _renderCommandResult( _cmd: DesktopCommand, result: CommandResult ): void {
		if ( result === undefined || result === null ) {
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

		void this._runSearchRequest( query, resumeTool, startOffset );
	}

	private _abortSearch(): void {
		if ( this._searchAbort ) {
			this._searchAbort.abort();
			this._searchAbort = null;
		}
	}

	private async _runSearchRequest(
		query: string,
		resumeTool: string | null,
		startOffset: number,
	): Promise<void> {
		this._abortSearch();
		const controller = new AbortController();
		this._searchAbort = controller;

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
					signal: controller.signal,
				},
				{ source: 'desktop-mode/ai-search' },
			);

			if ( controller.signal.aborted ) {
				return;
			}

			if ( ! res.ok ) {
				const err = await res.json().catch( () => ( {} ) ) as {
					message?: string;
					code?: string;
					data?: { settings_tab?: string };
				};
				this._showError(
					err.message ??

						sprintf( __( 'Server returned %d' ), res.status ),
					err.data?.settings_tab,
				);
				return;
			}

			this._showResult( query, await res.json() as SearchResult );
		} catch {
			if ( ! controller.signal.aborted ) {
				this._showError(
					__( 'Network error — please check your connection and try again.' ),
				);
			}
		} finally {
			if ( this._searchAbort === controller ) {
				this._searchAbort = null;
				this._isSearching = false;
				this._submitBtn.disabled = false;
				this._input.disabled = false;
				this._input.focus();
			}
		}
	}

	private async _fetchRemoteCommands( query: string ): Promise<void> {
		const token = ++this._remoteSearchToken;
		try {
			await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );
			if ( token !== this._remoteSearchToken ) {
				return;
			}

			const res = await trackedFetch(

				`/wp-json/wp/v2/search?search=${ encodeURIComponent( query ) }&subtype=post,page&_embed=self`,
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
				_embedded?: {
					self?: Array< {
						_links?: {
							self?: Array< { targetHints?: { allow?: string[] } } >;
						};
					} >;
				};
			}>;

			if ( token !== this._remoteSearchToken ) {
				return;
			}

			this._currentRemoteCommands = items.map( ( item ) => {
				const isPage = item.subtype === 'page';

				const allow =
					item._embedded?.self?.[ 0 ]?._links?.self?.[ 0 ]?.targetHints?.allow;
				const canEdit = ! allow || allow.includes( 'PUT' );
				const editUrl = new URL( 'post.php', this._adminUrl );
				editUrl.searchParams.set( 'post', String( item.id ) );
				editUrl.searchParams.set( 'action', 'edit' );
				const href = canEdit ? editUrl.toString() : item.url;
				const title = decodeHTML( item.title || __( '(No title)' ) );
				const icon = isPage ? 'dashicons-admin-page' : 'dashicons-admin-post';
				let description: string;
				if ( canEdit ) {
					description = isPage ? __( 'Edit page' ) : __( 'Edit post' );
				} else {
					description = isPage ? __( 'View page' ) : __( 'View post' );
				}

				return {
					slug: `post-${ item.id }`,
					label: title,
					description,
					icon,
					eager: false,
					run: ( _args, ctx ) => {
						ctx.openInWindow( href, title, icon );
					},
				};
			} );

			if ( this._isOpen ) {
				this._renderForMode();
			}
		} catch ( err ) {

		}
	}

	private _getDesktopShell(): DesktopShellLite | null {
		const shell = ( window as unknown as {
			wp?: { os?: DesktopShellLite };
		} ).wp?.os;
		return shell ?? null;
	}

	private _openAssistantSettings( tabId: string ): void {
		const shell = this._getDesktopShell();
		this._previousFocus = null;
		this.close();
		shell?.openOsSettings?.( { tabId } );
	}

	private _openInLegacyWindow( url: string, title: string, icon?: string ): void {
		const shell = this._getDesktopShell();
		if ( ! shell || ! shell.windowManager ) {
			window.open( url, '_blank', 'noopener' );
			return;
		}

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

	private _renderCommandMode(): void {
		this._resultsEl.hidden = false;
		const parsed = parseCommandInput( this._input.value );

		if ( parsed.hasArgsPart ) {
			const cmd = findCommand( parsed.slug );
			if ( cmd ) {
				this._renderArgsMode( cmd, parsed.args );
				return;
			}
		}

		const matches = this._commandMatches();

		const loadingRow =
			parsed.isCommand || this._mode === 'commands'
				? `<div class="os-ai__state os-ai__state--loading"${ this._baselineLoading ? '' : ' hidden' }>
					${ ICON_SPINNER }
					<span>${ this._esc( __( 'Loading WordPress commands…' ) ) }</span>
				</div>`
				: '';

		if ( matches.length === 0 ) {
			const q = parsed.isCommand ? `/${ parsed.slug }` : this._input.value.trim();
			const message = sprintf(

				__( 'No commands matching %s.' ),
				`<strong>${ this._esc( q ) }</strong>`,
			);
			this._resultsEl.innerHTML = `
				<div class="os-ai__state os-ai__state--empty">
					<span>${ message }</span>
				</div>
				${ loadingRow }
			`;
			return;
		}

		if ( this._selectedCommand >= matches.length ) {
			this._selectedCommand = 0;
		}

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
			${ loadingRow }
		`;

		this._resultsEl
			.querySelectorAll< HTMLButtonElement >( '.os-ai__cmd-item' )
			.forEach( ( btn ) => {
				const idx = parseInt( btn.dataset.index ?? '', 10 );
				const rowCommand = Number.isNaN( idx ) ? undefined : matches[ idx ];
				btn.addEventListener( 'click', () => {
					if ( rowCommand ) {
						this._pickCommand( rowCommand );
					}
				} );
				btn.addEventListener( 'mouseenter', () => {
					if ( this._keyboardNav ) {
						return;
					}
					if ( ! Number.isNaN( idx ) ) {
						this._selectedCommand = idx;
						this._resultsEl
							.querySelectorAll( '.os-ai__cmd-item' )
							.forEach( ( el, i ) => el.classList.toggle( 'is-selected', i === idx ) );
					}
				} );
			} );
	}

	private _renderArgsMode( cmd: DesktopCommand, args: string ): void {
		if ( typeof cmd.suggest !== 'function' ) {
			this._currentSuggestions = [];
			this._resultsEl.innerHTML = this._renderCommandHeader( cmd, true );
			return;
		}

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
				return;
			}
			this._currentSuggestions = suggestions;
			if ( this._selectedSuggestion >= suggestions.length ) {
				this._selectedSuggestion = 0;
			}
			this._resultsEl.innerHTML =
				this._renderCommandHeader( cmd, false ) +
				this._renderSuggestionList( suggestions );

			this._resultsEl
				.querySelectorAll< HTMLButtonElement >( '.os-ai__cmd-suggest-item' )
				.forEach( ( btn ) => {
					btn.addEventListener( 'click', () => {
						const idx = parseInt( btn.dataset.index ?? '0', 10 );
						const pick = suggestions[ idx ];
						if ( pick ) {
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
			this._resultsEl.innerHTML = this._renderCommandHeader( cmd, false );
			( result as Promise< CommandSuggestion[] > )
				.then( ( r ) => render( Array.isArray( r ) ? r : [] ) )
				.catch( () => render( [] ) );
		} else {
			render( Array.isArray( result ) ? ( result as CommandSuggestion[] ) : [] );
		}
	}

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

							__( 'Press %s to run' ),
							'<kbd>↵</kbd>',
						) }</span>`
						: '' }
				</div>
			</div>
		`;
	}

	private _renderSuggestionList( suggestions: CommandSuggestion[] ): string {
		if ( suggestions.length === 0 ) {
			const message = sprintf(

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

	private _sortCommands( list: DesktopCommand[] ): DesktopCommand[] {
		return list.slice().sort( ( a, b ) => {
			const aIframe = typeof a.owner === 'string' && a.owner.startsWith( 'iframe:' ) ? 0 : 1;
			const bIframe = typeof b.owner === 'string' && b.owner.startsWith( 'iframe:' ) ? 0 : 1;
			return aIframe - bIframe;
		} );
	}

	private _isEntityResultCommand( cmd: DesktopCommand ): boolean {
		return this._currentRemoteCommands.includes( cmd );
	}

	private _paintCommandSelection(): void {
		const items = this._resultsEl.querySelectorAll< HTMLElement >( '.os-ai__cmd-item' );
		items.forEach( ( el, i ) => {
			el.classList.toggle( 'is-selected', i === this._selectedCommand );
		} );

		const list = this._resultsEl.querySelector< HTMLElement >( '.os-ai__cmd-list' );
		if ( list ) {
			list.classList.toggle( 'os-ai__cmd-list--kb-nav', this._keyboardNav );
		}
		const active = items[ this._selectedCommand ];
		if ( active && typeof active.scrollIntoView === 'function' ) {
			active.scrollIntoView( { block: 'nearest' } );
		}
	}

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

	private _aiSetupRoute(): 'unavailable' | 'ask-admin' | 'preferences' {
		if ( ! this._isAiSupported() ) {
			return 'unavailable';
		}

		if ( ! this._isAiAvailable() && ! this._canConnectProvider() ) {
			return 'ask-admin';
		}
		return 'preferences';
	}

	private _renderAiSetup(): void {
		this._resultsEl.hidden = false;
		const route = this._aiSetupRoute();
		if ( route !== 'preferences' ) {
			const message =
				route === 'unavailable'
					? __( 'AI features aren’t available on this site. You can still use Commands.' )
					: __( 'Ask a site administrator to connect an AI provider to use the AI assistant.' );
			this._resultsEl.innerHTML = `
				<div class="os-ai__state">
					<span id="os-ai-setup-message">${ this._esc( message ) }</span>
				</div>
			`;
			return;
		}
		const link = `<button type="button" class="os-ai__settings-link">${ this._esc(
			__( 'Set up the AI assistant' ),
		) }</button>`;
		this._resultsEl.innerHTML = `
			<div class="os-ai__state">
				<span id="os-ai-setup-message">${ sprintf(

					this._esc( __( '%s to find content and ask questions about your site.' ) ),
					link,
				) }</span>
			</div>
		`;
		this._resultsEl
			.querySelector< HTMLButtonElement >( '.os-ai__settings-link' )
			?.addEventListener( 'click', () =>
				this._openAssistantSettings( 'features' ),
			);
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

	private _showError( message: string, settingsTab?: string ): void {
		this._resultsEl.hidden = false;

		if ( settingsTab ) {
			const link = `<button type="button" class="os-ai__settings-link">${ this._esc(
				__( 'Open Preferences' ),
			) }</button>`;
			this._resultsEl.innerHTML = `
				<div class="os-ai__state os-ai__state--error">
					<span>${ this._esc( message ) } ${ link }</span>
				</div>
			`;
			this._resultsEl
				.querySelector< HTMLButtonElement >( '.os-ai__settings-link' )
				?.addEventListener( 'click', () =>
					this._openAssistantSettings( settingsTab ),
				);
			return;
		}

		this._resultsEl.innerHTML = `
			<div class="os-ai__state os-ai__state--error">
				<span>${ this._esc( message ) }</span>
			</div>
		`;
	}

	private _showResult( query: string, data: SearchResult ): void {
		if ( query !== '' ) {
			this._lastAiResult = { query, data };
		}
		this._resultsEl.hidden = false;

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

				__( 'Comment on “%s”' ),
				this._esc(
					e.post_title ??
						_x( 'post', 'fallback name for the post a comment was left on' ),
				),
			)
			: this._esc( e.title ?? __( 'Untitled' ) );
		const summary = this._esc( e.ai_summary || e.excerpt || '' );
		const typeLabel = this._entityTypeLabel( e.type );
		const topicChip = e.topic ? `<span class="os-ai__entity-topic">${ this._esc( e.topic ) }</span>` : '';

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
				${ this._renderAdminLinkIcon( link.icon ) }
				<span class="os-ai__admin-link-body">
					<span class="os-ai__admin-link-title">${ this._esc( link.title ) }</span>
					<span class="os-ai__admin-link-desc">${ this._esc( link.description ) }</span>
				</span>
				<span class="os-ai__admin-link-arrow">${ ICON_ARROW }</span>
			</button>
		` ).join( '' );

		return `<div class="os-ai__admin-links">${ items }</div>`;
	}

	private _renderAdminLinkIcon( icon: string ): string {
		if ( WPORG_ICON_URL.test( icon ) ) {
			return `<img class="os-ai__admin-link-icon" src="${ this._esc( icon ) }" alt="" draggable="false">`;
		}
		const dashicon = icon.startsWith( 'dashicons-' ) ? icon : 'dashicons-admin-generic';
		return `<span class="os-ai__admin-link-icon dashicons ${ this._esc( dashicon ) }" aria-hidden="true"></span>`;
	}

	private _esc( str: string ): string {
		return str
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' );
	}

	private _buildDOM(): HTMLElement {
		const el = document.createElement( 'div' );
		el.id = 'desktop-mode-ai-assistant';
		el.className = 'os-ai';
		el.setAttribute( 'role', 'dialog' );
		el.setAttribute( 'aria-modal', 'true' );
		el.setAttribute( 'aria-label', __( 'Site assistant' ) );
		el.setAttribute( 'aria-hidden', 'true' );
		el.setAttribute( 'hidden', '' );

		el.innerHTML = `
			<div class="os-ai__backdrop" aria-hidden="true"></div>
			<div class="os-ai__panel">
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
					<div class="os-ai__modes" role="group" aria-label="${ this._esc(
						__( 'Assistant mode' ),
					) }">
						<button type="button" class="os-ai__mode" data-mode="ai" aria-pressed="false">${ this._esc(
							__( 'Ask AI' ),
						) }</button>
						<button type="button" class="os-ai__mode" data-mode="commands" aria-pressed="false">${ this._esc(
							__( 'Commands' ),
						) }</button>
					</div>
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
