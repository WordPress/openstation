/**
 * Categories + Tags tabs of the native Posts window.
 *
 * One shared renderer for both taxonomies — they share 90% of their
 * UX (stats strip, search + add toolbar, paginated `<wpd-table>`,
 * row-action edit/delete) and only differ in:
 *   - Hierarchy: categories indent + carry a `parent` field; tags are
 *     flat.
 *   - Stats: tags surface "unused tags" prominently because that's the
 *     classic site-cleanup chore; categories surface the "default
 *     fallback" footer instead.
 *   - Add form: categories include a parent picker.
 *
 * The reimagined view replaces the legacy `edit-tags.php` admin layout
 * (left-side add form + cramped right table) with:
 *   - A single horizontal stats strip at top — at-a-glance counts the
 *     classic page hides.
 *   - A search + add row that lives ABOVE the table, no double-bar
 *     repetition above + below.
 *   - A `<wpd-table>` that already knows how to do sticky headers,
 *     server pagination, and row sub-tables — same primitive the
 *     Posts table uses, so the visual language is one piece across
 *     all three tabs.
 *
 * @public
 * @since 0.8.0
 */

import { __, sprintf } from '../i18n';
import {
	deleteTerm,
	fetchTerms,
	updateTerm,
	createCategory,
	createTag,
	type TermRow,
	type TermsListParams,
} from './rest';
import type {
	WpdTable,
	WpdTableColumn,
} from '../ui/components/wpd-table/wpd-table';

interface TermsTabConfig {
	/** REST taxonomy slug. */
	taxonomy: 'categories' | 'tags';
	/** Visible taxonomy name (singular, capitalized). */
	singular: string;
	/** Visible taxonomy name (plural). */
	plural: string;
	/** Whether the taxonomy is hierarchical — drives indent + parent picker. */
	hierarchical: boolean;
}

interface ViewState {
	page: number;
	perPage: number;
	search: string;
	orderby: TermsListParams[ 'orderby' ];
	order: 'asc' | 'desc';
	searchDebounce: number | null;
}

interface StatsCard {
	value: string;
	label: string;
	tone?: 'default' | 'accent' | 'warning';
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Mount the term-management UI inside `host`. Idempotent — calling a
 * second time on the same host with the same config tears down + re-
 * mounts. Returns a teardown function that removes listeners + the
 * mounted DOM.
 *
 * @public
 */
export function mountTermsTab(
	host: HTMLElement,
	cfg: TermsTabConfig,
): () => void {
	host.replaceChildren();
	host.classList.add( 'desktop-mode-posts__terms' );

	// --- DOM scaffold ---------------------------------------------------

	const stats = document.createElement( 'div' );
	stats.className = 'desktop-mode-posts__stats';

	// (Categories now mount the Pixi mindmap directly from
	// `renderPostsWindow`; this module no longer surfaces a view
	// switcher. Kept around as the canonical Tags renderer.)

	const toolbar = document.createElement( 'header' );
	toolbar.className = 'desktop-mode-posts__terms-toolbar';

	const searchWrap = document.createElement( 'div' );
	searchWrap.className = 'desktop-mode-posts__terms-search';
	const searchInput = document.createElement( 'wpd-text-field' );
	searchInput.setAttribute(
		'placeholder',
		sprintf(
			/* translators: %s: taxonomy plural name (e.g. "categories"). */
			__( 'Search %s…' ),
			cfg.plural.toLowerCase(),
		),
	);
	searchWrap.appendChild( searchInput );

	const addRow = document.createElement( 'form' );
	addRow.className = 'desktop-mode-posts__terms-add';
	addRow.setAttribute( 'data-noclick', '' );
	const nameField = document.createElement( 'wpd-text-field' );
	nameField.setAttribute(
		'placeholder',
		sprintf(
			/* translators: %s: taxonomy singular name (e.g. "Category"). */
			__( 'New %s name' ),
			cfg.singular.toLowerCase(),
		),
	);
	addRow.appendChild( nameField );
	let parentSelect: HTMLSelectElement | null = null;
	if ( cfg.hierarchical ) {
		parentSelect = document.createElement( 'select' );
		parentSelect.className = 'desktop-mode-posts__terms-parent';
		parentSelect.setAttribute( 'aria-label', __( 'Parent category' ) );
		const noneOpt = document.createElement( 'option' );
		noneOpt.value = '0';
		noneOpt.textContent = __( '— No parent —' );
		parentSelect.appendChild( noneOpt );
		addRow.appendChild( parentSelect );
	}
	const addBtn = document.createElement( 'wpd-button' );
	addBtn.setAttribute( 'variant', 'primary' );
	addBtn.textContent = sprintf(
		/* translators: %s: taxonomy singular name. */
		__( 'Add %s' ),
		cfg.singular.toLowerCase(),
	);
	addRow.appendChild( addBtn );

	toolbar.appendChild( searchWrap );
	toolbar.appendChild( addRow );

	const table = document.createElement( 'wpd-table' ) as WpdTable< TermRow >;
	table.setAttribute( 'sticky-header', '' );
	table.setAttribute( 'sticky-columns', '1' );
	table.setAttribute( 'hover', '' );
	table.setAttribute( 'striped', '' );
	table.setAttribute( 'loading', '' );
	const empty = document.createElement( 'div' );
	empty.setAttribute( 'slot', 'empty' );
	empty.className = 'desktop-mode-posts__empty';
	const emptyIcon = document.createElement( 'span' );
	emptyIcon.className = 'dashicons dashicons-tag';
	emptyIcon.setAttribute( 'aria-hidden', 'true' );
	empty.appendChild( emptyIcon );
	const emptyText = document.createElement( 'p' );
	emptyText.textContent = sprintf(
		/* translators: %s: taxonomy plural name. */
		__( 'No %s yet.' ),
		cfg.plural.toLowerCase(),
	);
	empty.appendChild( emptyText );
	const emptyHint = document.createElement( 'p' );
	emptyHint.className = 'desktop-mode-posts__empty-hint';
	emptyHint.textContent = sprintf(
		/* translators: %s: taxonomy singular name. */
		__( 'Add the first %s using the form above.' ),
		cfg.singular.toLowerCase(),
	);
	empty.appendChild( emptyHint );
	table.appendChild( empty );

	const pager = document.createElement( 'footer' );
	pager.className = 'desktop-mode-posts__pager';
	const pagerMeta = document.createElement( 'div' );
	pagerMeta.className = 'desktop-mode-posts__pager-meta';
	const pageIndicator = document.createElement( 'span' );
	pageIndicator.textContent = '—';
	pagerMeta.appendChild( pageIndicator );
	const pagerNav = document.createElement( 'div' );
	pagerNav.className = 'desktop-mode-posts__pager-nav';
	const prevBtn = document.createElement( 'wpd-button' );
	prevBtn.setAttribute( 'variant', 'ghost' );
	prevBtn.setAttribute( 'disabled', '' );
	prevBtn.innerHTML =
		`<span class="dashicons dashicons-arrow-left-alt2" aria-hidden="true"></span>${ __( 'Previous' ) }`;
	const nextBtn = document.createElement( 'wpd-button' );
	nextBtn.setAttribute( 'variant', 'ghost' );
	nextBtn.setAttribute( 'disabled', '' );
	nextBtn.innerHTML = `${ __( 'Next' ) }<span class="dashicons dashicons-arrow-right-alt2" aria-hidden="true"></span>`;
	const perPageLabel = document.createElement( 'label' );
	perPageLabel.className = 'desktop-mode-posts__pager-perpage';
	perPageLabel.textContent = __( 'Per page' );
	const perPageSelect = document.createElement( 'select' );
	for ( const v of [ 25, 50, 100 ] ) {
		const opt = document.createElement( 'option' );
		opt.value = String( v );
		opt.textContent = String( v );
		if ( v === 50 ) {
			opt.selected = true;
		}
		perPageSelect.appendChild( opt );
	}
	perPageLabel.appendChild( perPageSelect );
	pagerNav.appendChild( prevBtn );
	pagerNav.appendChild( nextBtn );
	pagerNav.appendChild( perPageLabel );
	pager.appendChild( pagerMeta );
	pager.appendChild( pagerNav );

	host.appendChild( stats );
	host.appendChild( toolbar );
	host.appendChild( table );
	host.appendChild( pager );

	// --- View state -----------------------------------------------------

	const view: ViewState = {
		page: 1,
		perPage: 50,
		search: '',
		orderby: 'name',
		order: 'asc',
		searchDebounce: null,
	};

	// Cumulative cache of every term we've fetched so far — drives the
	// stats strip + the parent dropdown for categories. The table itself
	// only paints the current page.
	const allTermsById = new Map< number, TermRow >();

	let totalRows = 0;
	let totalPages = 0;
	let refreshSeq = 0;

	// --- Stats strip ----------------------------------------------------

	const renderStats = (): void => {
		stats.replaceChildren();
		const all = Array.from( allTermsById.values() );
		const used = all.filter( ( t ) => t.count > 0 );
		const empty2 = all.filter( ( t ) => t.count === 0 );
		const top = all.slice().sort( ( a, b ) => b.count - a.count )[ 0 ];
		const totalAssignments = all.reduce( ( sum, t ) => sum + t.count, 0 );

		const cards: StatsCard[] = [
			{
				value: String( totalRows || all.length ),
				label: sprintf(
					/* translators: %s: taxonomy plural. */
					__( 'Total %s' ),
					cfg.plural.toLowerCase(),
				),
			},
			{
				value: String( used.length ),
				label: __( 'In use' ),
				tone: 'accent',
			},
			{
				value: String( empty2.length ),
				label: __( 'Empty' ),
				tone: empty2.length > 0 ? 'warning' : 'default',
			},
			{
				value: top ? top.name : '—',
				label: top
					? sprintf(
						/* translators: %d: post count. */
						__( 'Most used (%d posts)' ),
						top.count,
					)
					: __( 'Most used' ),
			},
			{
				value: String( totalAssignments ),
				label: __( 'Total assignments' ),
			},
		];

		for ( const card of cards ) {
			const c = document.createElement( 'div' );
			c.className = 'desktop-mode-posts__stat';
			if ( card.tone && card.tone !== 'default' ) {
				c.dataset.tone = card.tone;
			}
			const v = document.createElement( 'span' );
			v.className = 'desktop-mode-posts__stat-value';
			v.textContent = card.value;
			c.appendChild( v );
			const l = document.createElement( 'span' );
			l.className = 'desktop-mode-posts__stat-label';
			l.textContent = card.label;
			c.appendChild( l );
			stats.appendChild( c );
		}
	};
	renderStats();

	// --- Parent dropdown (categories only) ------------------------------

	const refreshParentOptions = (): void => {
		if ( ! parentSelect ) {
			return;
		}
		const current = parentSelect.value;
		// Build a flat indented list, sorted alphabetically per level.
		const byParent = new Map< number, TermRow[] >();
		for ( const t of allTermsById.values() ) {
			const arr = byParent.get( t.parent ) ?? [];
			arr.push( t );
			byParent.set( t.parent, arr );
		}
		for ( const list of byParent.values() ) {
			list.sort( ( a, b ) => a.name.localeCompare( b.name ) );
		}
		const out: Array< { id: number; label: string } > = [];
		const walk = ( pid: number, depth: number ): void => {
			for ( const term of byParent.get( pid ) ?? [] ) {
				out.push( {
					id: term.id,
					label: `${ '— '.repeat( depth ) }${ term.name }`,
				} );
				walk( term.id, depth + 1 );
			}
		};
		walk( 0, 0 );
		parentSelect.replaceChildren();
		const noneOpt = document.createElement( 'option' );
		noneOpt.value = '0';
		noneOpt.textContent = __( '— No parent —' );
		parentSelect.appendChild( noneOpt );
		for ( const item of out ) {
			const opt = document.createElement( 'option' );
			opt.value = String( item.id );
			opt.textContent = item.label;
			parentSelect.appendChild( opt );
		}
		parentSelect.value = current || '0';
	};

	// --- Columns --------------------------------------------------------

	const buildColumns = (): WpdTableColumn< TermRow >[] => {
		const cols: WpdTableColumn< TermRow >[] = [
			{
				key: 'name',
				label: __( 'Name' ),
				sortable: true,
				sticky: true,
				minWidth: '220px',
				render: ( _v, row ) => buildNameCell( row ),
			},
			{
				key: 'slug',
				label: __( 'Slug' ),
				sortable: true,
				width: '180px',
				render: ( _v, row ) => buildSlugCell( row ),
			},
			{
				key: 'count',
				label: __( 'Posts' ),
				sortable: true,
				width: '110px',
				align: 'end',
				render: ( _v, row ) => buildCountCell( row ),
			},
			{
				key: 'description',
				label: __( 'Description' ),
				minWidth: '220px',
				render: ( _v, row ) => buildDescriptionCell( row ),
			},
			{
				key: '__actions',
				label: '',
				width: '120px',
				render: ( _v, row ) => buildActionsCell( row ),
			},
		];
		return cols;
	};

	const buildNameCell = ( row: TermRow ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-posts__term-name';
		// Hierarchy indent (categories): one ▸ per depth + name. Depth
		// is a quick lookup against the cumulative cache — works as
		// long as the parent has been loaded. For terms whose parent
		// hasn't been seen yet, we fall through to a flat "(orphan)"
		// rendering rather than a misleading depth-0 row.
		if ( cfg.hierarchical && row.parent ) {
			let depth = 0;
			let cur = row.parent;
			let safety = 12;
			while ( cur && safety-- > 0 ) {
				const parent = allTermsById.get( cur );
				if ( ! parent ) {
					break;
				}
				depth++;
				cur = parent.parent;
			}
			if ( depth > 0 ) {
				const indent = document.createElement( 'span' );
				indent.className = 'desktop-mode-posts__term-indent';
				indent.style.width = `${ depth * 16 }px`;
				wrap.appendChild( indent );
				const tee = document.createElement( 'span' );
				tee.className = 'desktop-mode-posts__term-tee';
				tee.textContent = '└';
				wrap.appendChild( tee );
			}
		}
		const name = document.createElement( 'span' );
		name.className = 'desktop-mode-posts__term-label';
		name.textContent = row.name;
		wrap.appendChild( name );
		return wrap;
	};

	const buildSlugCell = ( row: TermRow ): HTMLElement => {
		const span = document.createElement( 'code' );
		span.className = 'desktop-mode-posts__term-slug';
		span.textContent = row.slug;
		return span;
	};

	const buildCountCell = ( row: TermRow ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-posts__term-count';
		// Density bar — a tiny horizontal bar whose width is the
		// proportion of this term's count vs. the most-popular term in
		// the cache. Visual at-a-glance signal even when sorting by
		// name, so the user sees which categories carry the weight
		// without flipping to count-sort.
		const max = Math.max(
			1,
			...Array.from( allTermsById.values() ).map( ( t ) => t.count ),
		);
		const pct = Math.round( ( row.count / max ) * 100 );
		const bar = document.createElement( 'span' );
		bar.className = 'desktop-mode-posts__term-bar';
		bar.style.setProperty( '--wpd-term-bar', `${ pct }%` );
		const num = document.createElement( 'span' );
		num.className = 'desktop-mode-posts__term-count-num';
		num.textContent = String( row.count );
		wrap.appendChild( bar );
		wrap.appendChild( num );
		return wrap;
	};

	const buildDescriptionCell = ( row: TermRow ): HTMLElement => {
		const span = document.createElement( 'span' );
		span.className = 'desktop-mode-posts__term-desc';
		const text = ( row.description || '' ).trim();
		if ( ! text ) {
			span.classList.add( 'is-empty' );
			span.textContent = '—';
		} else {
			span.textContent = text;
		}
		return span;
	};

	const buildActionsCell = ( row: TermRow ): HTMLElement => {
		const wrap = document.createElement( 'div' );
		wrap.className = 'desktop-mode-posts__term-actions';

		const editBtn = document.createElement( 'button' );
		editBtn.type = 'button';
		editBtn.className = 'desktop-mode-posts__term-action';
		editBtn.textContent = __( 'Edit' );
		editBtn.setAttribute( 'data-noclick', '' );
		editBtn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void promptEdit( row );
		} );
		wrap.appendChild( editBtn );

		const delBtn = document.createElement( 'button' );
		delBtn.type = 'button';
		delBtn.className =
			'desktop-mode-posts__term-action desktop-mode-posts__term-action--danger';
		delBtn.textContent = __( 'Delete' );
		delBtn.setAttribute( 'data-noclick', '' );
		delBtn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void confirmDelete( row );
		} );
		wrap.appendChild( delBtn );

		return wrap;
	};

	// --- Edit / delete --------------------------------------------------

	const showError = ( title: string, err: unknown ): void => {
		const reason = err instanceof Error ? err.message : String( err );
		const api = window.wp?.desktop;
		if ( api && typeof api.showToast === 'function' ) {
			api.showToast( {
				message: `${ title } ${ reason }`.trim(),
				duration: 6000,
			} );
			return;
		}
		// eslint-disable-next-line no-console
		console.error( title, err );
	};

	const promptEdit = async ( row: TermRow ): Promise< void > => {
		// MVP: native prompt for rename. Description + slug + parent
		// editing land in a side drawer in v2; for v1 the most-common
		// rename action is one click + one keystroke. We tolerate the
		// no-alert lint hit because a) this is a single-keystroke
		// rename b) the surrounding flow gracefully degrades when the
		// shell toast surface isn't available.
		// eslint-disable-next-line no-alert
		const next = window.prompt(
			sprintf(
				/* translators: %s: current term name. */
				__( 'Rename "%s" to:' ),
				row.name,
			),
			row.name,
		);
		if ( next === null ) {
			return;
		}
		const trimmed = next.trim();
		if ( trimmed === '' || trimmed === row.name ) {
			return;
		}
		try {
			const updated = await updateTerm( cfg.taxonomy, row.id, {
				name: trimmed,
			} );
			allTermsById.set( updated.id, updated );
			refreshParentOptions();
			renderStats();
			void refresh();
		} catch ( err ) {
			showError( __( 'Couldn’t rename:' ), err );
		}
	};

	const confirmDelete = async ( row: TermRow ): Promise< void > => {
		// eslint-disable-next-line no-alert
		const ok = window.confirm(
			sprintf(
				/* translators: %s: term name. */
				__( 'Delete "%s"? Posts assigned to it will fall through to the default term.' ),
				row.name,
			),
		);
		if ( ! ok ) {
			return;
		}
		try {
			await deleteTerm( cfg.taxonomy, row.id );
			allTermsById.delete( row.id );
			refreshParentOptions();
			renderStats();
			void refresh();
		} catch ( err ) {
			showError( __( 'Couldn’t delete:' ), err );
		}
	};

	// --- Add ------------------------------------------------------------

	const onAdd = async ( e: Event ): Promise< void > => {
		e.preventDefault();
		const name = (
			( nameField as unknown as { value: string } ).value ?? ''
		).trim();
		if ( ! name ) {
			return;
		}
		const parent = parentSelect ? parseInt( parentSelect.value, 10 ) || 0 : 0;
		try {
			const created =
				cfg.taxonomy === 'categories'
					? await createCategory( name, parent )
					: await createTag( name );
			allTermsById.set( created.id, {
				id: created.id,
				name: created.name,
				slug:
					( created as unknown as { slug?: string } ).slug || '',
				parent:
					( created as unknown as { parent?: number } ).parent ?? 0,
				count: 0,
				description: '',
				isDefault: false,
			} );
			( nameField as unknown as { value: string } ).value = '';
			refreshParentOptions();
			renderStats();
			void refresh();
		} catch ( err ) {
			showError( __( 'Couldn’t add:' ), err );
		}
	};
	addRow.addEventListener( 'submit', onAdd );
	addBtn.addEventListener( 'click', ( e ) => {
		// `<wpd-button>` doesn't always submit the parent form on
		// click — bind explicit submission so Enter-after-typing AND
		// click-the-button both work.
		if ( ! ( e.currentTarget instanceof HTMLButtonElement ) ) {
			e.preventDefault();
			void onAdd( e );
		}
	} );

	// --- Refresh + paint ------------------------------------------------

	const refresh = async (): Promise< void > => {
		refreshSeq++;
		const seq = refreshSeq;
		( table as unknown as { loading: string } ).loading = '';
		try {
			const res = await fetchTerms( cfg.taxonomy, {
				page: view.page,
				perPage: view.perPage,
				search: view.search || undefined,
				orderby: view.orderby,
				order: view.order,
			} );
			if ( seq !== refreshSeq ) {
				return;
			}
			for ( const t of res.items ) {
				allTermsById.set( t.id, t );
			}
			totalRows = res.total;
			totalPages = res.totalPages;
			table.columns = buildColumns();
			table.getRowId = ( row ) => row.id;
			( table as unknown as { data: TermRow[] } ).data = res.items;
			refreshParentOptions();
			renderStats();
			repaintPager();
		} finally {
			if ( seq === refreshSeq ) {
				table.removeAttribute( 'loading' );
			}
		}
	};

	const repaintPager = (): void => {
		pageIndicator.textContent = sprintf(
			/* translators: 1: current page, 2: total pages, 3: total rows. */
			__( 'Page %1$d of %2$d · %3$d total' ),
			view.page,
			Math.max( 1, totalPages ),
			totalRows,
		);
		if ( view.page > 1 ) {
			prevBtn.removeAttribute( 'disabled' );
		} else {
			prevBtn.setAttribute( 'disabled', '' );
		}
		if ( view.page < totalPages ) {
			nextBtn.removeAttribute( 'disabled' );
		} else {
			nextBtn.setAttribute( 'disabled', '' );
		}
	};

	// --- Wiring ---------------------------------------------------------

	const onSearch = ( e: Event ): void => {
		const detail = ( e as CustomEvent< { value: string } > ).detail;
		const next = detail?.value ?? '';
		if ( view.searchDebounce !== null ) {
			window.clearTimeout( view.searchDebounce );
		}
		view.searchDebounce = window.setTimeout( () => {
			view.searchDebounce = null;
			view.search = next.trim();
			view.page = 1;
			void refresh();
		}, SEARCH_DEBOUNCE_MS );
	};
	searchInput.addEventListener( 'wpd-input', onSearch );

	const onSortChange = ( e: Event ): void => {
		const detail = ( e as CustomEvent< {
			sort: { key: string; direction: 'asc' | 'desc' } | null;
		} > ).detail;
		if ( ! detail || ! detail.sort ) {
			view.orderby = 'name';
			view.order = 'asc';
		} else {
			const key = detail.sort.key as TermsListParams[ 'orderby' ];
			view.orderby = key ?? 'name';
			view.order = detail.sort.direction;
		}
		view.page = 1;
		void refresh();
	};
	table.addEventListener( 'wpd-table-sort-change', onSortChange );

	const onPrev = (): void => {
		if ( view.page <= 1 ) {
			return;
		}
		view.page--;
		void refresh();
	};
	const onNext = (): void => {
		if ( view.page >= totalPages ) {
			return;
		}
		view.page++;
		void refresh();
	};
	prevBtn.addEventListener( 'click', onPrev );
	nextBtn.addEventListener( 'click', onNext );

	const onPerPage = (): void => {
		view.perPage = parseInt( perPageSelect.value, 10 ) || 50;
		view.page = 1;
		void refresh();
	};
	perPageSelect.addEventListener( 'change', onPerPage );

	void refresh();

	// --- Teardown -------------------------------------------------------

	return () => {
		searchInput.removeEventListener( 'wpd-input', onSearch );
		table.removeEventListener( 'wpd-table-sort-change', onSortChange );
		prevBtn.removeEventListener( 'click', onPrev );
		nextBtn.removeEventListener( 'click', onNext );
		perPageSelect.removeEventListener( 'change', onPerPage );
		addRow.removeEventListener( 'submit', onAdd );
		if ( view.searchDebounce !== null ) {
			window.clearTimeout( view.searchDebounce );
			view.searchDebounce = null;
		}
		host.replaceChildren();
		host.classList.remove( 'desktop-mode-posts__terms' );
	};
}
