/**
 * The keyboard-shortcuts reference, as a shell window.
 *
 * The reference itself is not new — it has always been a popover in
 * `assets/js/admin-bar.js`, anchored under the admin bar's keyboard
 * button and styled entirely under `#wpadminbar`. With the bar hidden
 * by default, both the button and the styles are off the page, so the
 * System menu's "Keyboard shortcuts" row needed a surface that lives
 * inside the shell. This is that surface.
 *
 * The DATA is still the server's, read off `openStationAdminBar
 * .shortcuts`: PHP translates every string once and ships them with
 * the admin bar's config, and the bar is still rendered (hiding it is
 * a body class, not a suppression), so the payload is on the page
 * whichever mode the user picked. Nothing here touches i18n.
 */

/** One row of the contextual table: a key, and what it does where. */
interface ContextualRow {
	keys?: string[];
	note?: string;
	outside?: string;
	inside?: string;
	showDesktop?: string;
}

/** One entry of the flat list: a chord and a sentence. */
interface GeneralItem {
	keys?: string[];
	description?: string;
}

/**
 * The server's shortcuts payload. Exported so `exit-openstation.ts`,
 * which owns the `openStationAdminBar` global declaration, can type
 * the key without owning its shape.
 */
export interface ShortcutsData {
	title?: string;
	contextual?: {
		heading?: string;
		headers?: Record< string, string >;
		rows?: ContextualRow[];
	};
	general?: {
		heading?: string;
		items?: GeneralItem[];
	};
}

/** `⌘` + `K` as a run of `<kbd>`s joined by thin plus signs. */
function chord( keys: string[] ): HTMLElement {
	const wrap = document.createElement( 'span' );
	wrap.className = 'os-shortcuts__chord';
	keys.forEach( ( key, i ) => {
		if ( i > 0 ) {
			const plus = document.createElement( 'span' );
			plus.className = 'os-shortcuts__plus';
			plus.textContent = '+';
			wrap.appendChild( plus );
		}
		const kbd = document.createElement( 'kbd' );
		kbd.className = 'os-shortcuts__kbd';
		kbd.textContent = key;
		wrap.appendChild( kbd );
	} );
	return wrap;
}

/**
 * The contextual block, as a table.
 *
 * A table rather than a list because the same key means three
 * different things depending on where you are, and that is a grid: the
 * columns ARE the contexts. Flattening it into sentences was tried in
 * the popover and made ← and → read as four unrelated shortcuts.
 */
function buildContextual(
	data: NonNullable< ShortcutsData[ 'contextual' ] >,
): HTMLElement {
	const section = document.createElement( 'section' );
	section.className = 'os-shortcuts__section';

	if ( data.heading ) {
		const h = document.createElement( 'h2' );
		h.className = 'os-shortcuts__heading';
		h.textContent = data.heading;
		section.appendChild( h );
	}

	const scroller = document.createElement( 'div' );
	scroller.className = 'os-shortcuts__scroller';
	const table = document.createElement( 'table' );
	table.className = 'os-shortcuts__table';

	const headers = data.headers ?? {};
	const cols = [ 'key', 'outside', 'inside', 'showDesktop' ] as const;
	const thead = document.createElement( 'thead' );
	const headRow = document.createElement( 'tr' );
	for ( const col of cols ) {
		const th = document.createElement( 'th' );
		th.scope = 'col';
		th.textContent = headers[ col ] ?? '';
		headRow.appendChild( th );
	}
	thead.appendChild( headRow );
	table.appendChild( thead );

	const tbody = document.createElement( 'tbody' );
	for ( const row of data.rows ?? [] ) {
		const tr = document.createElement( 'tr' );

		const keyCell = document.createElement( 'td' );
		keyCell.className = 'os-shortcuts__key-cell';
		keyCell.appendChild( chord( row.keys ?? [] ) );
		if ( row.note ) {
			const note = document.createElement( 'span' );
			note.className = 'os-shortcuts__note';
			note.textContent = row.note;
			keyCell.appendChild( note );
		}
		tr.appendChild( keyCell );

		for ( const col of [ 'outside', 'inside', 'showDesktop' ] as const ) {
			const td = document.createElement( 'td' );
			td.textContent = row[ col ] ?? '';
			tr.appendChild( td );
		}
		tbody.appendChild( tr );
	}
	table.appendChild( tbody );
	scroller.appendChild( table );
	section.appendChild( scroller );
	return section;
}

/** The flat block: one chord, one sentence. */
function buildGeneral(
	data: NonNullable< ShortcutsData[ 'general' ] >,
): HTMLElement {
	const section = document.createElement( 'section' );
	section.className = 'os-shortcuts__section';

	if ( data.heading ) {
		const h = document.createElement( 'h2' );
		h.className = 'os-shortcuts__heading';
		h.textContent = data.heading;
		section.appendChild( h );
	}

	const list = document.createElement( 'ul' );
	list.className = 'os-shortcuts__list';
	for ( const item of data.items ?? [] ) {
		const li = document.createElement( 'li' );
		li.className = 'os-shortcuts__item';
		li.appendChild( chord( item.keys ?? [] ) );
		const desc = document.createElement( 'span' );
		desc.className = 'os-shortcuts__description';
		desc.textContent = item.description ?? '';
		li.appendChild( desc );
		list.appendChild( li );
	}
	section.appendChild( list );
	return section;
}

/** Paint the reference into a window body. */
export function renderShortcuts( body: HTMLElement ): void {
	body.innerHTML = '';
	const root = document.createElement( 'div' );
	root.className = 'os-shortcuts';

	const data = window.openStationAdminBar?.shortcuts;
	if ( ! data ) {
		// The admin-bar config is the only source, and it ships with
		// the bar's own script. Say so rather than painting an empty
		// window that reads as "this site has no shortcuts".
		const empty = document.createElement( 'p' );
		empty.className = 'os-shortcuts__empty';
		empty.textContent = 'Keyboard shortcuts are unavailable.';
		root.appendChild( empty );
		body.appendChild( root );
		return;
	}

	if ( data.contextual ) {
		root.appendChild( buildContextual( data.contextual ) );
	}
	if ( data.general ) {
		root.appendChild( buildGeneral( data.general ) );
	}
	body.appendChild( root );
}

/** Window id, exported so the System row and the opener agree on it. */
export const SHORTCUTS_WINDOW_ID = 'openstation-shortcuts';

/** Icon: a keyboard, which Dashicons does not have — so, drawn. */
export const OS_SHORTCUTS_ICON = `data:image/svg+xml;base64,${ btoa(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round">' +
		'<rect x="5" y="14" width="54" height="36" rx="7"/>' +
		'<path d="M17 26h2M27 26h2M37 26h2M47 26h2M22 39h20"/>' +
		'</svg>',
) }`;

/**
 * Open (or focus) the shortcuts window.
 *
 * Takes the opener rather than importing the window manager: this
 * module is a renderer, and `desktop.ts` owns every window id the
 * shell opens.
 */
export function openShortcutsWith(
	open: ( config: {
		id: string;
		baseId: string;
		url: string;
		title: string;
		icon: string;
		native: true;
		render: ( body: HTMLElement ) => void;
		width: number;
		height: number;
		minWidth: number;
		minHeight: number;
	} ) => void,
): void {
	open( {
		id: SHORTCUTS_WINDOW_ID,
		baseId: SHORTCUTS_WINDOW_ID,
		url: '#os-shortcuts',
		title: window.openStationAdminBar?.shortcuts?.title
			? String( window.openStationAdminBar.shortcuts.title )
			: 'Keyboard shortcuts',
		icon: OS_SHORTCUTS_ICON,
		native: true,
		render: renderShortcuts,
		width: 760,
		height: 560,
		minWidth: 480,
		minHeight: 360,
	} );
}
