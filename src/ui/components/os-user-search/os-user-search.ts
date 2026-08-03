/**
 * `<os-user-search>` — debounced autocomplete picker over the
 * `/desktop-mode/v1/files/users/search` endpoint. Renders a search
 * field; emits `os-user-pick { user }` when the user picks a row.
 *
 * Optional attributes:
 *
 *   - `placeholder` — input placeholder.
 *   - `exclude` — comma-separated user ids to exclude from results.
 *   - `endpoint` — search URL (defaults to
 *     `openStationConfig.filesUsersSearchUrl`).
 *
 * The dropdown is rendered as a `position: fixed` panel anchored to
 * the input — it escapes any `overflow: auto` ancestor (e.g. a
 * modal body) so the list is always reachable.
 *
 * Multi-selection is up to the parent (the parent renders chips
 * for current picks and feeds an updated `exclude` list back).
 */

import { Component, defineComponent, html } from '../../core';
import { trackedFetch } from '../../../tracked-fetch';
import { userSearchStyles } from './os-user-search.styles';

interface SearchUser {
	id: number;
	name: string;
	slug: string;
	avatarUrl: string;
}

type Phase = 'idle' | 'loading' | 'ready' | 'error';

export class OsUserSearch extends Component {
	static props = [ 'placeholder', 'exclude', 'endpoint' ] as const;
	static styles = [ userSearchStyles ];

	static help = {
		title: 'User autocomplete',
		summary:
			'Debounced autocomplete over /desktop-mode/v1/files/users/search. Emits os-user-pick { user } when a row is chosen. Dropdown anchors as position: fixed so it escapes overflow:auto ancestors.',
		status: 'experimental',
		since: '0.8.5',
		props: [
			{ name: 'placeholder', type: 'string', description: 'Input placeholder text.' },
			{
				name: 'exclude',
				type: 'csv user ids',
				description: 'Already-picked user ids to suppress in results.',
			},
			{
				name: 'endpoint',
				type: 'URL',
				description: 'Override the search URL (defaults to openStationConfig.filesUsersSearchUrl).',
			},
		],
		events: [
			{ name: 'os-user-pick', description: 'Emitted on pick. Detail: `{ user: SearchUser }`.' },
		],
		/*
		 * Just the closed input. The dropdown only exists after a
		 * debounced REST round-trip, and firing user searches from a
		 * documentation pane on every keystroke is not something a
		 * help screen should do on the reader's behalf — so the
		 * example shows the resting state and the prose says what
		 * happens next.
		 */
		example: html`
			<os-user-search
				placeholder="Search users to share with…"
			></os-user-search>
		`,
	} as const;

	private _timer: ReturnType< typeof setTimeout > | null = null;
	private _abort: AbortController | null = null;
	private _results: SearchUser[] = [];
	private _query = '';
	private _open = false;
	private _phase: Phase = 'idle';
	private _error = '';
	private _dropdownStyle = '';
	private _onScrollOrResize: () => void = () => undefined;

	connectedCallback(): void {
		super.connectedCallback();
		this._onScrollOrResize = (): void => {
			if ( this._open ) {
				this._positionDropdown();
				this.requestUpdate();
			}
		};
		window.addEventListener( 'resize', this._onScrollOrResize );
		window.addEventListener( 'scroll', this._onScrollOrResize, true );
	}

	disconnectedCallback(): void {
		if ( this._timer ) {
			clearTimeout( this._timer );
		}
		if ( this._abort ) {
			this._abort.abort();
		}
		window.removeEventListener( 'resize', this._onScrollOrResize );
		window.removeEventListener( 'scroll', this._onScrollOrResize, true );
	}

	private _endpoint(): string {
		const attr = this.getAttribute( 'endpoint' );
		if ( attr ) {
			return attr;
		}
		return window.openStationConfig?.filesUsersSearchUrl || '';
	}

	private _scheduleSearch( q: string ): void {
		if ( this._timer ) {
			clearTimeout( this._timer );
		}
		// Mark loading immediately so the dropdown shows a spinner
		// while the debounce + fetch are in flight. Without this the
		// component looks dead for ~300 ms after every keystroke.
		this._phase = 'loading';
		this._open = true;
		this._positionDropdown();
		this.requestUpdate();
		this._timer = setTimeout( () => this._runSearch( q ), 200 );
	}

	private async _runSearch( q: string ): Promise< void > {
		const url = this._endpoint();
		if ( ! url ) {
			this._phase = 'error';
			this._error = 'Search endpoint is not configured.';
			this._results = [];
			this._open = true;
			this.requestUpdate();
			return;
		}
		if ( this._abort ) {
			this._abort.abort();
		}
		const ctrl = new AbortController();
		this._abort = ctrl;

		const exclude = this.getAttribute( 'exclude' ) || '';
		const full = url + '?q=' + encodeURIComponent( q ) + '&exclude=' + encodeURIComponent( exclude );
		try {
			const init: RequestInit = {
				signal: ctrl.signal,
				credentials: 'same-origin',
			};
			const res = await trackedFetch( full, init, {
				source: 'desktop-mode/files-user-search',
				silent: true,
			} );
			if ( ! res.ok ) {
				throw new Error( `HTTP ${ res.status }` );
			}
			const json = await res.json();
			this._results = ( json && Array.isArray( json.users ) ? json.users : [] ) as SearchUser[];
			this._phase = 'ready';
			this._error = '';
			this._open = true;
		} catch ( e ) {
			if ( ( e as Error ).name === 'AbortError' ) {
				return;
			}
			this._results = [];
			this._phase = 'error';
			this._error = ( e as Error ).message || 'Search failed.';
			this._open = true;
		}
		this._positionDropdown();
		this.requestUpdate();
	}

	private _positionDropdown(): void {
		const input = this.shadowRoot?.querySelector< HTMLInputElement >( '.input' );
		if ( ! input ) {
			return;
		}
		const rect = input.getBoundingClientRect();
		const top = rect.bottom + 4;
		const left = rect.left;
		const width = rect.width;
		// Flip up if the input is in the bottom half and there's
		// more room above. Default to anchored below.
		const viewportH = window.innerHeight;
		const spaceBelow = viewportH - rect.bottom;
		const spaceAbove = rect.top;
		const maxHeight = Math.max( 120, Math.min( 280, Math.max( spaceBelow, spaceAbove ) - 16 ) );
		if ( spaceBelow < 200 && spaceAbove > spaceBelow ) {
			// Anchor above.
			this._dropdownStyle = [
				'position:fixed',
				`left:${ left }px`,
				`top:${ rect.top - 4 - maxHeight }px`,
				`width:${ width }px`,
				`max-height:${ maxHeight }px`,
			].join( ';' );
		} else {
			this._dropdownStyle = [
				'position:fixed',
				`left:${ left }px`,
				`top:${ top }px`,
				`width:${ width }px`,
				`max-height:${ maxHeight }px`,
			].join( ';' );
		}
	}

	private _onInput = ( e: Event ): void => {
		const value = ( e.target as HTMLInputElement ).value;
		this._query = value;
		this._scheduleSearch( value );
	};

	private _onFocus = (): void => {
		// Open the dropdown on first focus and run an initial
		// search if we don't have results yet. Matches the
		// "click-and-see-everyone" pattern of native pickers like
		// Slack's people picker.
		if ( this._results.length === 0 && this._phase === 'idle' ) {
			this._scheduleSearch( this._query );
			return;
		}
		this._open = true;
		this._positionDropdown();
		this.requestUpdate();
	};

	private _onBlur = (): void => {
		// Delay so a click on a result still registers.
		setTimeout( () => {
			this._open = false;
			this.requestUpdate();
		}, 150 );
	};

	private _pick = ( user: SearchUser ): void => {
		this.emit( 'os-user-pick', { user } );
		this._results = [];
		this._open = false;
		this._phase = 'idle';
		this._query = '';
		const input = this.shadowRoot?.querySelector< HTMLInputElement >( '.input' );
		if ( input ) {
			input.value = '';
		}
		this.requestUpdate();
	};

	private _dropdownContent() {
		if ( this._phase === 'loading' ) {
			return html`<div class="empty">Searching…</div>`;
		}
		if ( this._phase === 'error' ) {
			return html`<div class="empty error">${ this._error }</div>`;
		}
		if ( this._results.length === 0 ) {
			const message = this._query ? 'No matches.' : 'No users available.';
			return html`<div class="empty">${ message }</div>`;
		}
		return this._results.map( ( u ) =>
			html`
				<button
					type="button"
					class="item"
					role="option"
					@mousedown=${ ( e: MouseEvent ) => e.preventDefault() }
					@click=${ () => this._pick( u ) }
				>
					<img class="avatar" src=${ u.avatarUrl } alt="" />
					<div>
						<div class="name">${ u.name }</div>
						<div class="slug">${ u.slug }</div>
					</div>
				</button>
			`,
		);
	}

	protected render() {
		const placeholder = this.getAttribute( 'placeholder' ) || 'Search users…';
		return html`
			<input
				class="input"
				type="search"
				placeholder=${ placeholder }
				autocomplete="off"
				@input=${ this._onInput }
				@focus=${ this._onFocus }
				@blur=${ this._onBlur }
				.value=${ this._query }
			/>
			${ this._open
				? html`
					<div class="dropdown" role="listbox" style=${ this._dropdownStyle }>
						${ this._dropdownContent() }
					</div>
				`
				: html`` }
		`;
	}
}
defineComponent( 'os-user-search', OsUserSearch );
