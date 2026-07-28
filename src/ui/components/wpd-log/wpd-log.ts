/**
 * `<wpd-log>` — virtualized streaming log container.
 *
 * High-rate append-only list designed for inspector / monitor /
 * debugger UIs that need to display thousands of rows without
 * tanking layout. A naive `<div>` per row dies past a few thousand
 * entries: every layout pass becomes O(n²), scroll lag is visible,
 * and the GPU layer cost climbs with every batch.
 *
 * This component virtualises:
 *
 *   - Only rows in (or near) the viewport exist in the DOM.
 *   - A `.spacer` sized to the total content height provides the
 *     scrollbar geometry; the `.window` (absolutely positioned
 *     inside it) stamps the visible slice and is re-stamped on
 *     scroll.
 *   - Optional LRU eviction via `max-rows="N"` — once the buffer
 *     grows past N, the oldest entries fall off FIFO so memory
 *     stays bounded for long-running sessions.
 *   - Tail-stickiness: when the viewport is at the bottom, new
 *     appends keep it pinned (classic `tail -f` behavior). When the
 *     user scrolls up to inspect a past row, sticking is
 *     suspended until they scroll back to the bottom edge.
 *
 * ## Row-height contract — read this before shipping
 *
 * **Default mode (fast path) is fixed-row-height.** Each rendered row
 * MUST fit inside `row-height` pixels. Content taller than
 * `row-height` is **clipped silently** — the component does not
 * measure rendered rows, so a multi-line entry that exceeds the
 * height looks like a broken layout. This is the price the fixed-
 * height virtualizer pays for O(1) viewport-finding (no per-row
 * measurement passes, no DOM read on the hot append path).
 *
 * If your rows are one-liners (typical for SQL inspectors, log
 * tails, REST timing): leave the default. It's the cheapest path.
 *
 * If your rows have variable content (a header line + a body block,
 * collapsible details, inline previews): set `auto-row-height` on
 * the host. The component will measure each row on first render and
 * cache per-entry heights for the virtualizer. One extra layout pass
 * per visible row, scrollbar height settles after the first scroll
 * through the buffer, but no more silent clipping.
 *
 * ```html
 * <!-- One-liners — fast path -->
 * <wpd-log row-height="22"></wpd-log>
 *
 * <!-- Variable rows — measured -->
 * <wpd-log auto-row-height></wpd-log>
 * ```
 *
 * Usage (programmatic — typical for streaming log consumers):
 *
 * ```ts
 * const log = document.querySelector< WpdLog< QueryEvent > >( '#sql-log' )!;
 * log.rowHeight = 24;
 * log.maxRows = 5000;
 * log.renderRow = ( entry, index ) => {
 *     const el = document.createElement( 'div' );
 *     el.textContent = `[${ index }] ${ entry.sql }`;
 *     return el;
 * };
 * subscribe( ( event ) => log.push( event ) );
 * ```
 *
 * Consumers can also assign `entries` wholesale to seed the buffer
 * from a snapshot (e.g. session restore).
 *
 * Designed to be the canonical primitive for every devtool that
 * surfaces a streaming feed — SQL inspector, network inspector,
 * REST timing viewer, action-fire trace, log tail. None of those
 * should reinvent virtualization.
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-log.styles';

export type WpdLogRowRenderer< T = unknown > = (
	entry: T,
	index: number,
) => HTMLElement | string;

/**
 * Default row renderer. Stringifies each entry into a `<span>`. Plugins
 * almost always replace this — the default exists so a freshly-mounted
 * `<wpd-log>` paints something useful before the consumer wires up.
 */
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

export class WpdLog< T = unknown > extends Component {
	static props = [ 'rowHeight', 'maxRows', 'overscan', 'empty', 'autoRowHeight' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Log (virtualized)',
		summary:
			'Append-only streaming list for high-rate output (SQL queries, network calls, log lines). Virtualises so thousands of rows render without layout cost; pins to the bottom while the viewport sits there, releases when the user scrolls up.',
		status: 'experimental',
		since: '0.6.0',
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
				name: 'wpd-log-append',
				description:
					'Fires after each `push( entry )`. detail.entry is the appended item; detail.length is the new buffer size.',
			},
		],
		cssProps: [
			{ name: '--wpd-log-row-height', default: '22px' },
			{ name: '--wpd-log-row-padding', default: '2px 8px' },
			{ name: '--wpd-log-row-border', default: '1px solid rgba(0,0,0,0.04)' },
			{ name: '--wpd-log-min-height', default: '120px' },
		],
		example: html`
			<wpd-log id="sample-log" row-height="22" max-rows="500"></wpd-log>
		`,
	} as const;

	private _entries: T[] = [];
	private _renderRow: WpdLogRowRenderer< T > = defaultRowRenderer as WpdLogRowRenderer< T >;
	private _stickToBottom = true;

	/**
	 * Per-entry measured height — auto-row-height mode only. Sparse:
	 * unmeasured indices read as `rowHeight` (default). Stays index-
	 * aligned with `_entries`; trimmed in lockstep when `max-rows` evicts.
	 */
	private _heights: number[] = [];
	/**
	 * Cumulative offsets — `_offsets[i]` is the top edge of entry i.
	 * Auto-row-height mode only. Lazily computed by `_ensureOffsets()`
	 * and invalidated whenever `_heights` changes.
	 */
	private _offsets: number[] = [];
	private _offsetsValid = false;

	private _onScroll = (): void => {
		// User scrolled — recompute stickiness based on whether they
		// landed on the bottom edge. A 4px slop accounts for sub-pixel
		// scroll positions on retina displays where strict equality
		// would never trigger.
		const distance = this.scrollHeight - this.clientHeight - this.scrollTop;
		this._stickToBottom = distance <= 4;
		this._paintWindow();
	};

	private _resizeObserver: ResizeObserver | null = null;

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener( 'scroll', this._onScroll, { passive: true } );
		// Repaint when the host resizes — without this the visible
		// slice gets stale after a window resize / split-view swap.
		if ( typeof ResizeObserver !== 'undefined' ) {
			this._resizeObserver = new ResizeObserver( () => this._paintWindow() );
			this._resizeObserver.observe( this );
		}
		// First paint runs AFTER the base-class render microtask drops
		// the skeleton into the shadow root. Without this, entries
		// pushed before connect (or while the render loop hasn't run
		// yet) sit invisible until the next mutation.
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

	/**
	 * Per-row renderer. Receives the entry + its absolute index in the
	 * buffer (NOT the visible slice). Return a DOM node — strings are
	 * stamped into a `<span>`. Default is a JSON stringification, so a
	 * freshly-mounted log paints something useful before the consumer
	 * wires up.
	 *
	 * Reassigning `renderRow` invalidates measured heights — under
	 * `auto-row-height` mode, the new renderer's row sizes will likely
	 * differ from the previous, so we re-measure on next paint.
	 */
	get renderRow(): WpdLogRowRenderer< T > {
		return this._renderRow;
	}
	set renderRow( fn: WpdLogRowRenderer< T > ) {
		this._renderRow = typeof fn === 'function' ? fn : ( defaultRowRenderer as WpdLogRowRenderer< T > );
		this._heights = [];
		this._invalidateOffsets();
		this._paintSpacer();
		this._paintWindow();
	}

	/** Snapshot (read) / replace (write) the entire entry buffer. */
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

	/**
	 * Append a single entry. The cheap hot path — designed for
	 * `subscribe( e => log.push( e ) )` patterns where the consumer
	 * fires it from a postMessage or polling callback.
	 *
	 * Named `push` (not `append`) because `Element.append( …Node )` is
	 * already a DOM method on the host and we don't want to shadow it.
	 */
	push( entry: T ): void {
		this._entries.push( entry );
		this._enforceMaxRows();
		this._afterEntriesMutation();
		this.emit( 'wpd-log-append', { entry, length: this._entries.length } );
	}

	/** Append many entries at once — single repaint. */
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

	/** Drop every entry. */
	clear(): void {
		this._entries = [];
		this._heights = [];
		this._invalidateOffsets();
		this._afterEntriesMutation();
	}

	/** Scroll to the very bottom and re-pin tail-stickiness. */
	scrollToBottom(): void {
		this._stickToBottom = true;
		this.scrollTop = this.scrollHeight;
	}

	private _enforceMaxRows(): void {
		const cap = this._readMaxRows();
		if ( cap > 0 && this._entries.length > cap ) {
			const drop = this._entries.length - cap;
			// Drop the oldest. `splice` mutates in-place — cheaper than
			// reassigning a slice for the typical case where we trim
			// 1-N entries off the front. Heights array follows in
			// lockstep so index alignment with entries holds.
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
			// Sync scroll position to the new total height, then paint.
			// Scrolling first means `scrollTop` is correct when the
			// window-stamping math runs.
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

	/**
	 * Build / refresh the cumulative-offsets array under
	 * auto-row-height mode. Unmeasured entries fall back to the
	 * declared `row-height`; once they paint and we measure them, the
	 * invalidation flag flips and we rebuild.
	 */
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

	/**
	 * Binary-search the auto-mode offsets array for the first entry
	 * whose top edge is at or past `scrollTop`. Returns the index of
	 * the LAST entry that starts at or before scrollTop — i.e. the
	 * topmost row that's still partially visible.
	 */
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

		// Stamp the visible slice into a fragment so we touch the live
		// DOM exactly once per paint. `replaceChildren( frag )` swaps in
		// a single layout pass.
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
				// Don't pin a height — the measured-mode whole point
				// is letting content drive height. `min-height: 0`
				// override on the row class would also work; using
				// `auto` here avoids fighting the CSS default.
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

		// Measurement pass — read each freshly-mounted row's actual
		// height and update the cache. If anything changed, invalidate
		// offsets, re-paint the spacer, and re-paint the window. Guard
		// the recursion by only re-painting when at least one row
		// actually moved; otherwise we'd spin forever on a row whose
		// clientHeight rounds the cached value.
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
			// Reposition the rows we already stamped — cheaper than a
			// full re-render, and visually identical. Subsequent paints
			// will pick up the cached heights without measurement.
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
		// Static skeleton — the heavy lifting is in `_paintWindow`,
		// which mutates `.window` directly. Keeping the skeleton
		// declarative means the host's slot / part anchors stay
		// inspectable without re-rendering on every append.
		const emptyText = this.getAttribute( 'empty' ) || 'No entries';
		return html`
			<div class="spacer">
				<div class="window" part="window"></div>
			</div>
			<div class="empty" part="empty">${ emptyText }</div>
		`;
	}
}
defineComponent( 'wpd-log', WpdLog );
