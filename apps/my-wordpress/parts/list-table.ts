/**
 * My WordPress — the list view.
 *
 * Part of the `my-wordpress` client view: imported by `list-views.ts`,
 * which hands a section's rows here when the window is in `list`
 * mode. This part owns the TABLE: one column model per kind (posts and
 * custom post types, media, users), sortable headers that drive the
 * same server orders the icon view's "Sort by" menu does, infinite
 * scroll through the framework's paged list, drag-out and selection
 * through the same row attributes the tiles carry, a per-row action
 * cluster (edit, copy link, copy the `?p=` shortlink, more), an ID
 * cell that copies itself, and a column chooser the server remembers.
 *
 * Plugins add columns through the `os.my-wordpress.list-columns`
 * filter; a row carries the same REST-visible fields the tiles do.
 *
 * @public
 */

import { __, _n, formatDate, html, sprintf, type TemplateResult } from '@openstation/app';
import { openUserEditWindow } from '../../../src/open-targets/user-edit-window';
import {
	shell,
	uiOf,
	type Ctx,
	type ListColumn,
	type ListItem,
	type SectionDef,
} from './types';
import { glyph } from './helpers';
import { longPress } from './long-press';
import { copyIdMessage, copyLinks, copyWithToast, rowInteractions } from './rows';

// ------------------------------------------------------------ columns

/** A short label for a post status, and the badge tone that says it. */
function statusBadge( status: string ): TemplateResult | '' {
	if ( status === '' || status === 'publish' ) {
		return '';
	}
	const tones: Record< string, string > = {
		draft: 'warning',
		pending: 'info',
		future: 'info',
		private: 'neutral',
	};
	const labels: Record< string, string > = {
		draft: __( 'Draft' ),
		pending: __( 'Pending' ),
		future: __( 'Scheduled' ),
		private: __( 'Private' ),
	};
	return html`<os-badge tone=${ tones[ status ] ?? 'neutral' } no-dot class="os-mywp__cell-badge">${ labels[ status ] ?? status }</os-badge>`;
}

/** The title cell: thumbnail or glyph, the title, the status, the lock. */
function titleCell( item: ListItem, section: SectionDef ): TemplateResult {
	const visual = item.thumb
		? html`<img class="os-mywp__cell-thumb" src=${ item.thumb } alt="" loading="lazy" />`
		: glyph( section.icon, 'os-mywp__cell-glyph' );
	return html`
		<span class="os-mywp__cell-title">
			${ visual }
			<span class="os-mywp__cell-text">${ item.title }</span>
			${ section.kind === 'post' ? statusBadge( item.status ) : '' }
			${ item.lockedBy
				? html`<span
					class="dashicons dashicons-lock os-mywp__cell-lock"
					title=${ sprintf(
						/* translators: %s: user display name. */
						__( '%s is editing' ),
						item.lockedBy,
					) }
				></span>`
				: '' }
		</span>
	`;
}

/** A date cell: the long form, with the full timestamp on hover. */
function dateCell( iso: string | undefined ): TemplateResult | '' {
	if ( ! iso ) {
		return '';
	}
	return html`<time datetime=${ iso } title=${ formatDate( iso, 'datetime' ) }>${ formatDate( iso, 'long' ) }</time>`;
}

/** A "how long ago" cell that keeps aging, the absolute moment on hover. */
function agoCell( iso: string | undefined ): TemplateResult | '' {
	if ( ! iso ) {
		return '';
	}
	return html`<os-relative-time datetime=${ iso } title=${ formatDate( iso, 'datetime' ) }></os-relative-time>`;
}

const ID_COLUMN: ListColumn = {
	id: 'id',
	label: __( 'ID' ),
	sort: { asc: 'id-asc', desc: 'id-desc', first: 'desc' },
	mono: true,
	align: 'end',
	locked: true,
	render: ( item ) => item.id,
};

const ACTIONS_COLUMN: ListColumn = {
	id: 'actions',
	label: __( 'Actions' ),
	align: 'end',
	locked: true,
	render: () => '',
};

function postColumns( section: SectionDef ): ListColumn[] {
	const columns: ListColumn[] = [
		ID_COLUMN,
		{
			id: 'title',
			label: __( 'Title' ),
			sort: { asc: 'title-asc', desc: 'title-desc', first: 'asc' },
			width: '1fr',
			locked: true,
			render: titleCell,
		},
		{
			id: 'slug',
			label: __( 'Slug' ),
			sort: { asc: 'slug-asc', desc: 'slug-desc', first: 'asc' },
			mono: true,
			render: ( item ) => item.slug ?? '',
		},
		{
			id: 'author',
			label: __( 'Author' ),
			render: ( item ) => item.author ?? '',
		},
		{
			id: 'status',
			label: __( 'Status' ),
			render: ( item ) => item.status,
		},
		{
			id: 'date',
			label: __( 'Date' ),
			sort: { asc: 'oldest', desc: 'default', first: 'desc' },
			render: ( item ) => dateCell( item.date ),
		},
		{
			id: 'modified',
			label: __( 'Modified' ),
			sort: { asc: 'modified-asc', desc: 'modified', first: 'desc' },
			render: ( item ) => agoCell( item.modified ),
		},
		{
			id: 'comments',
			label: __( 'Comments' ),
			sort: { asc: 'comments-asc', desc: 'comments', first: 'desc' },
			align: 'end',
			mono: true,
			render: ( item ) => item.comments ?? 0,
		},
	];
	if ( section.hierarchical ) {
		columns.push( {
			id: 'parent',
			label: __( 'Parent' ),
			render: ( item ) => ( item.parent && item.parent > 0
				? html`<span class="os-mywp__cell-parent"><span class="os-mywp__cell-id">#${ item.parent }</span> ${ item.parentTitle ?? '' }</span>`
				: '' ),
		} );
	}
	columns.push(
		{
			id: 'words',
			label: __( 'Words' ),
			align: 'end',
			mono: true,
			hidden: true,
			render: ( item ) => item.words ?? 0,
		},
		ACTIONS_COLUMN,
	);
	return columns;
}

function mediaColumns(): ListColumn[] {
	return [
		ID_COLUMN,
		{
			id: 'title',
			label: __( 'File' ),
			sort: { asc: 'title-asc', desc: 'title-desc', first: 'asc' },
			width: '1fr',
			locked: true,
			render: titleCell,
		},
		{
			id: 'file',
			label: __( 'File name' ),
			sort: { asc: 'slug-asc', desc: 'slug-desc', first: 'asc' },
			mono: true,
			render: ( item ) => item.file ?? '',
		},
		{
			id: 'mime',
			label: __( 'Type' ),
			mono: true,
			render: ( item ) => item.mime,
		},
		{
			id: 'size',
			label: __( 'Size' ),
			align: 'end',
			mono: true,
			render: ( item ) => item.size ?? '',
		},
		{
			id: 'dimensions',
			label: __( 'Dimensions' ),
			mono: true,
			render: ( item ) => item.dimensions ?? '',
		},
		{
			id: 'parent',
			label: __( 'Attached to' ),
			render: ( item ) => ( item.parent && item.parent > 0
				? html`<span class="os-mywp__cell-parent"><span class="os-mywp__cell-id">#${ item.parent }</span> ${ item.parentTitle ?? '' }</span>`
				: html`<span class="os-mywp__cell-muted">${ __( 'Unattached' ) }</span>` ),
		},
		{
			id: 'author',
			label: __( 'Uploaded by' ),
			hidden: true,
			render: ( item ) => item.author ?? '',
		},
		{
			id: 'date',
			label: __( 'Uploaded' ),
			sort: { asc: 'oldest', desc: 'default', first: 'desc' },
			render: ( item ) => dateCell( item.date ),
		},
		{
			id: 'modified',
			label: __( 'Modified' ),
			sort: { asc: 'modified-asc', desc: 'modified', first: 'desc' },
			hidden: true,
			render: ( item ) => agoCell( item.modified ),
		},
		ACTIONS_COLUMN,
	];
}

function userColumns(): ListColumn[] {
	return [
		ID_COLUMN,
		{
			id: 'title',
			label: __( 'Name' ),
			sort: { asc: 'default', desc: 'title-desc', first: 'asc' },
			width: '1fr',
			locked: true,
			render: titleCell,
		},
		{
			id: 'login',
			label: __( 'Username' ),
			sort: { asc: 'login-asc', desc: 'login-desc', first: 'asc' },
			mono: true,
			render: ( item ) => item.login ?? '',
		},
		{
			id: 'email',
			label: __( 'Email' ),
			sort: { asc: 'email-asc', desc: 'email-desc', first: 'asc' },
			render: ( item ) => item.email ?? item.subtitle,
		},
		{
			id: 'roles',
			label: __( 'Role' ),
			render: ( item ) => item.status,
		},
		{
			id: 'posts',
			label: __( 'Posts' ),
			sort: { asc: 'posts-asc', desc: 'posts', first: 'desc' },
			align: 'end',
			mono: true,
			render: ( item ) => item.posts ?? 0,
		},
		{
			id: 'registered',
			label: __( 'Registered' ),
			sort: { asc: 'oldest', desc: 'newest', first: 'desc' },
			render: ( item ) => dateCell( item.registered ),
		},
		ACTIONS_COLUMN,
	];
}

/**
 * The columns a section lists, after the `os.my-wordpress.list-columns`
 * filter. A filter that hands back something broken (not an array,
 * rows without an id or a render) is ignored rather than trusted.
 */
export function columnsFor( section: SectionDef ): ListColumn[] {
	let columns: ListColumn[];
	if ( section.kind === 'user' ) {
		columns = userColumns();
	} else if ( section.kind === 'media' ) {
		columns = mediaColumns();
	} else {
		columns = postColumns( section );
	}
	const merged = shell().hooks?.applyFilters( 'os.my-wordpress.list-columns', columns, section );
	if ( ! Array.isArray( merged ) ) {
		return columns;
	}
	const valid = merged.filter( ( c ): c is ListColumn => {
		if ( ! c || typeof c !== 'object' ) {
			return false;
		}
		const col = c as ListColumn;
		return typeof col.id === 'string' && col.id !== '' && typeof col.render === 'function';
	} );
	// The two the table cannot work without stay whatever the filter did.
	const ids = new Set( valid.map( ( c ) => c.id ) );
	if ( ! ids.has( 'title' ) ) {
		valid.unshift( columns.find( ( c ) => c.id === 'title' )! );
	}
	if ( ! ids.has( 'actions' ) ) {
		valid.push( ACTIONS_COLUMN );
	}
	return valid;
}

/** Which column ids the section hides: the remembered set, else the defaults. */
export function hiddenFor( ctx: Ctx, section: SectionDef, columns: ListColumn[] ): Set< string > {
	const remembered = ctx.data.hiddenColumns?.[ section.id ];
	if ( Array.isArray( remembered ) ) {
		return new Set( remembered.map( String ) );
	}
	return new Set( columns.filter( ( c ) => c.hidden ).map( ( c ) => c.id ) );
}

// ---------------------------------------------------------------- sort

/** The sort key a click on a sortable header applies next. */
export function nextSort( column: ListColumn, active: string ): string {
	if ( ! column.sort ) {
		return active;
	}
	const { asc, desc, first } = column.sort;
	const firstKey = first === 'asc' ? asc : desc;
	const otherKey = first === 'asc' ? desc : asc;
	return active === firstKey ? otherKey : firstKey;
}

/** Whether the section's server orders include the column's. */
function sortable( column: ListColumn, sortOptions: Record< string, string > ): boolean {
	return !! column.sort && column.sort.asc in sortOptions && column.sort.desc in sortOptions;
}

// ------------------------------------------------------------- actions

/** One icon button in a row's action cluster. */
function actionButton( icon: string, label: string, run: () => void ): TemplateResult {
	return html`
		<os-button
			variant="ghost"
			class="os-mywp__row-action"
			title=${ label }
			aria-label=${ label }
			@click=${ ( e: Event ) => {
				e.stopPropagation();
				run();
			} }
			@dblclick=${ ( e: Event ) => e.stopPropagation() }
		>
			<span class="dashicons ${ icon }" aria-hidden="true"></span>
		</os-button>
	`;
}

function actionsCell( ctx: Ctx, section: SectionDef, item: ListItem, order: number[] ): TemplateResult {
	const row = rowInteractions( ctx, section, item, order );
	const buttons: TemplateResult[] = [];
	if ( item.canEdit ) {
		buttons.push(
			actionButton(
				'dashicons-edit',
				section.kind === 'user' ? __( 'Edit profile' ) : __( 'Open in editor' ),
				() => {
					if ( section.kind === 'user' ) {
						openUserEditWindow( item.id, {
							source: 'my-wordpress-app/list-view',
							fallback: () => void ctx.dispatch( 'edit', { item: item.id } ),
						} );
					} else {
						void ctx.dispatch( 'edit', { item: item.id } );
					}
				},
			),
		);
	}
	if ( section.kind === 'user' ) {
		buttons.push(
			actionButton(
				'dashicons-chart-area',
				__( 'View activity footprint' ),
				() => void ctx.dispatch( 'footprint', { user: item.id, name: item.title } ),
			),
		);
	}
	if ( item.link ) {
		buttons.push(
			actionButton(
				'dashicons-admin-links',
				section.kind === 'media' ? __( 'Copy URL' ) : __( 'Copy link' ),
				() => copyLinks( ctx, [ item ], 'link' ),
			),
		);
	}
	if ( item.shortlink ) {
		buttons.push(
			actionButton(
				'dashicons-shortcode',
				__( 'Copy shortlink' ),
				() => copyLinks( ctx, [ item ], 'shortlink' ),
			),
		);
	}
	buttons.push( html`
		<os-button
			variant="ghost"
			class="os-mywp__row-action"
			title=${ __( 'More actions' ) }
			aria-label=${ __( 'More actions' ) }
			aria-haspopup="menu"
			@click=${ ( e: Event ) => {
				e.stopPropagation();
				row.menuAt( e.currentTarget as Element );
			} }
			@dblclick=${ ( e: Event ) => e.stopPropagation() }
		>
			<span class="dashicons dashicons-ellipsis" aria-hidden="true"></span>
		</os-button>
	` );
	return html`<span class="os-mywp__row-actions">${ buttons }</span>`;
}

// ---------------------------------------------------------------- rows

function cell( ctx: Ctx, column: ListColumn, item: ListItem, section: SectionDef, order: number[] ): TemplateResult {
	const classes = [
		'os-mywp__td',
		column.align === 'end' ? 'os-mywp__td--end' : '',
		column.mono ? 'os-mywp__td--mono' : '',
		`os-mywp__td--${ column.id }`,
	].filter( Boolean ).join( ' ' );
	if ( column.id === 'id' ) {
		// The id copies itself — the one fact this view exists for.
		return html`
			<td class=${ classes }>
				<button
					type="button"
					class="os-mywp__cell-id os-mywp__cell-id--copy"
					title=${ __( 'Copy ID' ) }
					@click=${ ( e: Event ) => {
						e.stopPropagation();
						void copyWithToast( ctx, String( item.id ), copyIdMessage( item.id ) );
					} }
					@dblclick=${ ( e: Event ) => e.stopPropagation() }
				>${ item.id }</button>
			</td>
		`;
	}
	if ( column.id === 'actions' ) {
		return html`<td class=${ classes }>${ actionsCell( ctx, section, item, order ) }</td>`;
	}
	let content: TemplateResult | string | number;
	try {
		content = column.render( item, section );
	} catch {
		// Plugin code — contained, per cell.
		content = '';
	}
	return html`<td class=${ classes }>${ content }</td>`;
}

function renderRow(
	ctx: Ctx,
	section: SectionDef,
	item: ListItem,
	columns: ListColumn[],
	order: number[],
): TemplateResult {
	const { state } = ctx;
	const isSelected = state.selected.includes( item.id );
	const isOpen = state.item === item.id;
	const row = rowInteractions( ctx, section, item, order );
	const onKey = ( e: KeyboardEvent ): void => {
		const tr = e.currentTarget as HTMLElement;
		if ( e.key === 'Enter' ) {
			e.preventDefault();
			row.activate();
		} else if ( e.key === ' ' ) {
			e.preventDefault();
			ctx.local( 'select', { item: item.id, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, order } );
			void ctx.dispatch( 'open', { item: item.id } );
		} else if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
			e.preventDefault();
			const next = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
			( next as HTMLElement | null )?.focus?.();
		}
	};
	return html`
		<tr
			class="os-mywp__row ${ isOpen ? 'is-open' : '' } ${ isSelected ? 'is-selected' : '' }"
			data-item-id=${ String( item.id ) }
			data-mywp-drag=${ section.kind === 'user' ? 'user' : section.post_type }
			role="row"
			aria-selected=${ isSelected ? 'true' : 'false' }
			tabindex="0"
			@click=${ row.select }
			@dblclick=${ row.activate }
			@contextmenu=${ row.menu }
			@pointerdown=${ row.press.pointerdown }
			@pointermove=${ row.press.pointermove }
			@pointerup=${ row.press.pointerup }
			@pointercancel=${ row.press.pointercancel }
			@keydown=${ onKey }
		>
			${ columns.map( ( column ) => cell( ctx, column, item, section, order ) ) }
		</tr>
	`;
}

// -------------------------------------------------------------- table

/** The list view of one section: header, rows, skeletons, sentinel. */
export function renderTable( ctx: Ctx, section: SectionDef, items: ListItem[] ): TemplateResult {
	const ui = uiOf( ctx );
	const all = columnsFor( section );
	const hidden = hiddenFor( ctx, section, all );
	const columns = all.filter( ( c ) => ! hidden.has( c.id ) );
	const order = items.map( ( i ) => i.id );
	const active = ctx.state.sort || 'default';
	const sortOptions = ctx.data.sortOptions ?? {};
	const hasMore = ui.list.hasMore();
	const ghosts = ui.list.ghosts( ctx.data.list?.perPage ?? 24 );

	const onSort = ( column: ListColumn ): void => {
		const next = nextSort( column, active );
		ctx.local( 'set-sort', { sort: next === 'default' ? '' : next } );
		void ctx.dispatch( 'sort' );
	};
	const ariaSort = ( column: ListColumn ): string => {
		if ( ! column.sort ) {
			return 'none';
		}
		if ( active === column.sort.asc ) {
			return 'ascending';
		}
		if ( active === column.sort.desc ) {
			return 'descending';
		}
		return 'none';
	};
	const header = ( column: ListColumn ): TemplateResult => {
		const classes = [
			'os-mywp__th',
			column.align === 'end' ? 'os-mywp__th--end' : '',
			`os-mywp__th--${ column.id }`,
		].filter( Boolean ).join( ' ' );
		if ( column.id === 'actions' ) {
			return html`
				<th class=${ classes } scope="col">
					<os-button
						variant="ghost"
						class="os-mywp__row-action os-mywp__columns-btn"
						title=${ __( 'Choose columns' ) }
						aria-label=${ __( 'Choose columns' ) }
						aria-haspopup="menu"
						@click=${ ( e: MouseEvent ) => {
							const rect = ( e.currentTarget as Element ).getBoundingClientRect();
							ui.columnsMenu = { x: rect.left, y: rect.bottom + 2 };
							ctx.repaint();
						} }
					>
						<span class="dashicons dashicons-screenoptions" aria-hidden="true"></span>
					</os-button>
				</th>
			`;
		}
		if ( ! sortable( column, sortOptions ) ) {
			return html`<th class=${ classes } scope="col">${ column.label }</th>`;
		}
		const direction = ariaSort( column );
		const arrows: Record< string, string > = { ascending: '▲', descending: '▼' };
		return html`
			<th class=${ classes } scope="col" aria-sort=${ direction }>
				<button
					type="button"
					class="os-mywp__sort ${ direction !== 'none' ? 'is-active' : '' }"
					@click=${ () => onSort( column ) }
				>
					<span>${ column.label }</span>
					<span class="os-mywp__sort-arrow" aria-hidden="true">${ arrows[ direction ] ?? '' }</span>
				</button>
			</th>
		`;
	};

	const canvasMenu = ( e: MouseEvent ): void => {
		e.preventDefault();
		ui.menu = { x: e.clientX, y: e.clientY, item: null };
		ctx.repaint();
	};
	// The canvas menu on a finger held still beside the rows; a press
	// that began on a row is the row's.
	const canvasPress = longPress(
		( x, y ) => {
			ui.menu = { x, y, item: null };
			ctx.repaint();
		},
		( e ) => ! ( e.target as Element | null )?.closest( '[data-item-id]' ),
	);

	return html`
		<div
			class="os-mywp__canvas os-mywp__table-wrap"
			data-mywp-list
			@contextmenu=${ canvasMenu }
			@pointerdown=${ canvasPress.pointerdown }
			@pointermove=${ canvasPress.pointermove }
			@pointerup=${ canvasPress.pointerup }
			@pointercancel=${ canvasPress.pointercancel }
		>
			<table
				class="os-mywp__table"
				role="grid"
				aria-multiselectable="true"
				aria-label=${ section.label }
			>
				<colgroup>
					${ columns.map( ( c ) => html`<col style=${ c.width && c.width !== '1fr' ? `width:${ c.width }` : '' } />` ) }
				</colgroup>
				<thead>
					<tr role="row">${ columns.map( header ) }</tr>
				</thead>
				<tbody>
					${ items.map( ( item ) => renderRow( ctx, section, item, columns, order ) ) }
					${ Array.from( { length: ghosts }, ( _unused, i ) => html`
						<tr class="os-mywp__row os-mywp__row--ghost" data-ghost-index=${ String( i ) } aria-hidden="true">
							<td colspan=${ String( columns.length ) }><span class="os-mywp__ghost-line"></span></td>
						</tr>
					` ) }
				</tbody>
			</table>
			${ items.length === 0 && ghosts === 0
				? html`<p class="os-mywp__table-empty">${ ctx.state.query ? __( 'Nothing matches the search.' ) : __( 'Nothing here yet.' ) }</p>`
				: '' }
			${ hasMore ? html`<div class="os-mywp__sentinel" data-mywp-sentinel></div>` : '' }
		</div>
	`;
}

/** The column chooser: every unlocked column, ticked when shown. */
export function renderColumnsMenu( ctx: Ctx, section: SectionDef | null ): TemplateResult | '' {
	const ui = uiOf( ctx );
	if ( ! ui.columnsMenu || ! section ) {
		return '';
	}
	const { x, y } = ui.columnsMenu;
	const all = columnsFor( section );
	const hidden = hiddenFor( ctx, section, all );
	const close = (): void => {
		ui.columnsMenu = null;
		ctx.repaint();
	};
	const pick = ( e: Event ): void => {
		const id = String( ( e as CustomEvent< { id?: string } > ).detail?.id ?? '' );
		if ( id === 'reset' ) {
			close();
			void ctx.dispatch( 'set-columns', { reset: true } );
			return;
		}
		const next = new Set( hidden );
		if ( next.has( id ) ) {
			next.delete( id );
		} else {
			next.add( id );
		}
		// The menu stays open — one toggle rarely means done.
		void ctx.dispatch( 'set-columns', { hidden: Array.from( next ) } );
	};
	const optional = all.filter( ( c ) => ! c.locked );
	return html`
		<div
			class="os-mywp__menu-backdrop"
			@click=${ close }
			@contextmenu=${ ( e: Event ) => {
				e.preventDefault();
				close();
			} }
		></div>
		<os-context-menu
			open
			class="os-mywp__menu os-mywp__columns-menu"
			style="position:fixed;left:${ x }px;top:${ y }px;visibility:hidden"
			@os-context-menu-pick=${ pick }
		>
			<os-context-menu-option heading>${ __( 'Columns' ) }</os-context-menu-option>
			${ optional.map( ( c ) => html`
				<os-context-menu-option id=${ c.id } ?checked=${ ! hidden.has( c.id ) }>
					${ c.label }
				</os-context-menu-option>
			` ) }
			<os-context-menu-option id="reset">${ __( 'Reset columns' ) }</os-context-menu-option>
		</os-context-menu>
	`;
}

/** The status-bar phrase for the active order, e.g. "Sorted by ID, highest first". */
export function sortStatus( ctx: Ctx ): string {
	const active = ctx.state.sort || 'default';
	const label = ctx.data.sortOptions?.[ active ];
	if ( ! label ) {
		return '';
	}
	return sprintf(
		/* translators: %s: the sort option label. */
		__( 'Sorted by %s' ),
		label,
	);
}

/** "3 columns hidden" for the status bar, '' when none are. */
export function hiddenStatus( ctx: Ctx, section: SectionDef ): string {
	const all = columnsFor( section );
	const hidden = hiddenFor( ctx, section, all );
	const count = all.filter( ( c ) => hidden.has( c.id ) ).length;
	if ( count === 0 ) {
		return '';
	}
	return sprintf(
		/* translators: %d: hidden column count. */
		_n( '%d column hidden', '%d columns hidden', count ),
		count,
	);
}
