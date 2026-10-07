import { Component, defineComponent, html } from '../../core';
import { styles } from './os-log.styles';

export type OsLogRowRenderer< T = unknown > = (
	entry: T,
	index: number,
) => HTMLElement | string;

function defaultRowRenderer( entry: unknown ): HTMLElement {
	const span = document.createElement( 'span' );
	let text: string;
	if ( typeof entry === 'string' ) {
		text = entry;
	} else {
		try {
			text = JSON.stringify( entry );
		} catch {
			text = String( entry );
		}
	}
	span.textContent = text;
	return span;
}

export class OsLog< T = unknown > extends Component {
	static props = [ 'rowHeight', 'maxRows', 'overscan', 'empty', 'autoRowHeight' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Log (virtualized)',
		summary:
			'Append-only streaming list for high-rate output (SQL queries, network calls, log lines). Virtualises so thousands of rows render without layout cost; pins to the bottom while the viewport sits there, releases when the user scrolls up.',
		status: 'stable',
		props: [
			{
				name: 'row-height',
				type: 'number',
				description:
					'Fixed row height in pixels. Required for the default (fixed-height) virtualizer math. Default 22. Content taller than this clips silently — set `auto-row-height` for variable-height rows.',
			},
			{
				name: 'auto-row-height',
				type: 'boolean',
				description:
					'Opt into measured row heights. Each row is measured on first render and cached; the virtualizer uses cumulative offsets for window positioning. One extra layout pass per visible row vs. the fixed-height fast path. Use when rows have variable content (header + body, collapsible details).',
			},
			{
				name: 'max-rows',
				type: 'number',
				description:
					'LRU buffer cap. Once the entries count exceeds this, the oldest entries fall off FIFO. Omit for unbounded.',
			},
			{
				name: 'overscan',
				type: 'number',
				description:
					'Extra rows to render above/below the viewport so the buffer pre-paints during fast scrolls. Default 6.',
			},
			{
				name: 'empty',
				type: 'string',
				description:
					'Text shown when there are zero entries. Default "No entries".',
			},
		],
		events: [
			{
				name: 'os-log-append',
				description:
					'Fires after each `push( entry )`. detail.entry is the appended item; detail.length is the new buffer size.',
			},
		],
		cssProps: [
			{ name: '--os-ui-log-row-height', default: '22px' },
			{ name: '--os-ui-log-row-padding', default: '2px 8px' },
			{ name: '--os-ui-log-row-border', default: '1px solid rgba(0,0,0,0.04)' },
			{ name: '--os-ui-log-min-height', default: '120px' },
		],

		example: html`
			<div style="height:160px">
				<os-log row-height="22" max-rows="500"></os-log>
			</div>
		`,
		exampleInit: ( root: HTMLElement ) => {
			const log = root.querySelector( 'os-log' );
			if ( log ) {
				( log as OsLog< string > ).entries = [
					'[12:04:01] GET /wp-admin/index.php → 200 (48ms)',
					'[12:04:01] SELECT * FROM wp_options WHERE autoload = 1',
					'[12:04:02] GET /wp-json/desktop-mode/v1/session → 200 (12ms)',
					'[12:04:02] SELECT * FROM wp_posts ORDER BY post_date DESC LIMIT 5',
					'[12:04:03] POST /wp-admin/admin-ajax.php → 200 (31ms)',
					'[12:04:04] GET /wp-json/desktop-mode/v1/files → 200 (19ms)',
				];
			}
		},
	} as const;

	private _entries: T[] = [];
	private _renderRow: OsLogRowRenderer< T > = defaultRowRenderer as OsLogRowRenderer< T >;
	private _stickToBottom = true;

	private _heights: number[] = [];

	private _offsets: number[] = [];
	private _offsetsValid = false;

	private _onScroll = (): void => {
		const distance = this.scrollHeight - this.clientHeight - this.scrollTop;
		this._stickToBottom = distance <= 4;
		this._paintWindow();
	};

	private _resizeObserver: ResizeObserver | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener( 'scroll', this._onScroll, { passive: true } );

		if ( typeof ResizeObserver !== 'undefined' ) {
			this._resizeObserver = new ResizeObserver( () => this._paintWindow() );
			this._resizeObserver.observe( this );
		}

		queueMicrotask( () => {
			this._paintSpacer();
			if ( this._stickToBottom ) {
				this.scrollTop = this.scrollHeight;
			}
			this._paintWindow();
		} );
	}

	disconnectedCallback(): void {
		this.removeEventListener( 'scroll', this._onScroll );
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;
	}

	get renderRow(): OsLogRowRenderer< T > {
		return this._renderRow;
	}
	set renderRow( fn: OsLogRowRenderer< T > ) {
		this._renderRow = typeof fn === 'function' ? fn : ( defaultRowRenderer as OsLogRowRenderer< T > );
		this._heights = [];
		this._invalidateOffsets();
		this._paintSpacer();
		this._paintWindow();
	}

	get entries(): readonly T[] {
		return this._entries;
	}
	set entries( next: readonly T[] ) {
		this._entries = Array.isArray( next ) ? next.slice() : [];
		this._heights = [];
		this._invalidateOffsets();
		this._enforceMaxRows();
		this._afterEntriesMutation();
	}

	push( entry: T ): void {
		this._entries.push( entry );
		this._enforceMaxRows();
		this._afterEntriesMutation();
		this.emit( 'os-log-append', { entry, length: this._entries.length } );
	}

	pushMany( entries: readonly T[] ): void {
		if ( ! Array.isArray( entries ) || entries.length === 0 ) {
			return;
		}
		for ( const e of entries ) {
			this._entries.push( e );
		}
		this._enforceMaxRows();
		this._afterEntriesMutation();
	}

	clear(): void {
		this._entries = [];
		this._heights = [];
		this._invalidateOffsets();
		this._afterEntriesMutation();
	}

	scrollToBottom(): void {
		this._stickToBottom = true;
		this.scrollTop = this.scrollHeight;
	}

	private _enforceMaxRows(): void {
		const cap = this._readMaxRows();
		if ( cap > 0 && this._entries.length > cap ) {
			const drop = this._entries.length - cap;

			this._entries.splice( 0, drop );
			if ( this._heights.length > 0 ) {
				this._heights.splice( 0, Math.min( drop, this._heights.length ) );
			}
			this._invalidateOffsets();
		}
	}

	private _afterEntriesMutation(): void {
		this._paintSpacer();
		if ( this._stickToBottom ) {
			this.scrollTop = this.scrollHeight;
		}
		this._paintWindow();
	}

	private _readRowHeight(): number {
		const raw = parseFloat( this.getAttribute( 'row-height' ) || '22' );
		return Number.isFinite( raw ) && raw > 0 ? raw : 22;
	}

	private _readMaxRows(): number {
		const raw = parseFloat( this.getAttribute( 'max-rows' ) || '0' );
		return Number.isFinite( raw ) && raw > 0 ? Math.floor( raw ) : 0;
	}

	private _readOverscan(): number {
		const raw = parseFloat( this.getAttribute( 'overscan' ) || '6' );
		return Number.isFinite( raw ) && raw >= 0 ? Math.floor( raw ) : 6;
	}

	private _isAutoHeight(): boolean {
		return this.getAttribute( 'auto-row-height' ) !== null;
	}

	private _invalidateOffsets(): void {
		this._offsetsValid = false;
		this._offsets = [];
	}

	private _ensureOffsets(): void {
		if ( this._offsetsValid ) {
			return;
		}
		const fallback = this._readRowHeight();
		const offsets: number[] = new Array( this._entries.length );
		let acc = 0;
		for ( let i = 0; i < this._entries.length; i++ ) {
			offsets[ i ] = acc;
			const h = this._heights[ i ];
			acc += Number.isFinite( h ) && h > 0 ? h : fallback;
		}
		this._offsets = offsets;
		( this as unknown as { _totalHeight: number } )._totalHeight = acc;
		this._offsetsValid = true;
	}

	private _totalContentHeight(): number {
		if ( this._isAutoHeight() ) {
			this._ensureOffsets();
			return ( this as unknown as { _totalHeight?: number } )._totalHeight ?? 0;
		}
		return this._entries.length * this._readRowHeight();
	}

	private _findIndexAtOffset( scrollTop: number ): number {
		const offsets = this._offsets;
		if ( offsets.length === 0 ) {
			return 0;
		}
		let lo = 0;
		let hi = offsets.length - 1;
		while ( lo < hi ) {
			const mid = Math.floor( ( lo + hi + 1 ) / 2 );
			if ( offsets[ mid ] <= scrollTop ) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return lo;
	}

	private _paintSpacer(): void {
		const spacer = this.shadowRoot?.querySelector< HTMLElement >( '.spacer' );
		if ( ! spacer ) {
			return;
		}
		spacer.style.height = `${ this._totalContentHeight() }px`;
	}

	private _paintWindow(): void {
		const winEl = this.shadowRoot?.querySelector< HTMLElement >( '.window' );
		const empty = this.shadowRoot?.querySelector< HTMLElement >( '.empty' );
		if ( ! winEl ) {
			return;
		}
		if ( this._entries.length === 0 ) {
			winEl.replaceChildren();
			if ( empty ) {
				empty.style.display = '';
			}
			return;
		}
		if ( empty ) {
			empty.style.display = 'none';
		}

		const auto = this._isAutoHeight();
		const rowHeight = this._readRowHeight();
		const overscan = this._readOverscan();
		const viewportH = this.clientHeight;
		const scrollTop = this.scrollTop;

		let startIdx: number;
		let endIdx: number;
		if ( auto ) {
			this._ensureOffsets();
			const firstVisible = this._findIndexAtOffset( scrollTop );
			const lastVisible = this._findIndexAtOffset( scrollTop + viewportH );
			startIdx = Math.max( 0, firstVisible - overscan );
			endIdx = Math.min( this._entries.length, lastVisible + 1 + overscan );
		} else {
			startIdx = Math.max( 0, Math.floor( scrollTop / rowHeight ) - overscan );
			endIdx = Math.min(
				this._entries.length,
				Math.ceil( ( scrollTop + viewportH ) / rowHeight ) + overscan,
			);
		}

		const frag = document.createDocumentFragment();
		const renderedRows: Array< { idx: number; el: HTMLElement } > = [];
		for ( let i = startIdx; i < endIdx; i++ ) {
			const rendered = this._renderRow( this._entries[ i ], i );
			let row: HTMLElement;
			if ( rendered instanceof HTMLElement ) {
				row = rendered;
			} else {
				row = document.createElement( 'span' );
				row.textContent = String( rendered );
			}
			row.classList.add( 'row' );
			row.style.position = 'absolute';
			row.style.left = '0';
			row.style.right = '0';
			if ( auto ) {
				row.style.top = `${ this._offsets[ i ] }px`;

				row.style.height = 'auto';
			} else {
				row.style.top = `${ i * rowHeight }px`;
				row.style.height = `${ rowHeight }px`;
			}
			frag.appendChild( row );
			renderedRows.push( { idx: i, el: row } );
		}
		winEl.replaceChildren( frag );

		if ( ! auto ) {
			return;
		}

		let changed = false;
		const fallback = this._readRowHeight();
		for ( const { idx, el } of renderedRows ) {
			const h = el.offsetHeight || fallback;
			const prev = this._heights[ idx ];
			if ( ! Number.isFinite( prev ) || Math.abs( prev - h ) > 0.5 ) {
				this._heights[ idx ] = h;
				changed = true;
			}
		}
		if ( changed ) {
			this._invalidateOffsets();
			this._ensureOffsets();

			for ( const { idx, el } of renderedRows ) {
				el.style.top = `${ this._offsets[ idx ] }px`;
			}
			this._paintSpacer();
			if ( this._stickToBottom ) {
				this.scrollTop = this.scrollHeight;
			}
		}
	}

	protected render() {
		const emptyText = this.getAttribute( 'empty' ) || 'No entries';
		return html`
			<div class="spacer">
				<div class="window" part="window"></div>
			</div>
			<div class="empty" part="empty">${ emptyText }</div>
		`;
	}
}
defineComponent( 'os-log', OsLog );
