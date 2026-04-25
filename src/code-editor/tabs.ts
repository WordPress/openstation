/**
 * Code Editor — file-tab strip.
 *
 * One row of tabs above the Monaco mount, one tab per open file.
 * Each tab shows the file's icon, basename, a dirty dot when the
 * model has unsaved edits, and a close (×) button. Click the body
 * to activate; click × to close (with a confirm modal if the
 * buffer is dirty).
 *
 * Re-opening an already-open file from the tree focuses the
 * existing tab; no duplicates. Closing the active tab activates
 * the right-neighbour, then the left if there's no right, then
 * goes back to the placeholder if no tabs remain.
 *
 * @since 0.18.0
 */

import { showConfirm } from './dialog';

export interface OpenFileMeta {
	/** Canonical relative path; doubles as the tab id. */
	path: string;
	/** Display label — usually the basename. */
	label: string;
	/** Dashicon class for the leading icon. */
	icon: string;
}

export interface TabsStripOptions {
	/** Element the tab strip mounts into; we own its children. */
	mount: HTMLElement;
	/** Fired when the user clicks a tab to activate it. */
	onActivate: ( path: string ) => void;
	/**
	 * Fired AFTER the tab has been closed. The strip handles dirty
	 * confirms internally — this hook lets the host dispose models /
	 * cancel in-flight requests / pick the next active tab.
	 */
	onClose: ( path: string ) => void;
}

export interface TabsStripHandle {
	/**
	 * Make a tab for `file`, or focus the existing one if the path
	 * is already open. Sets it active. Returns the active path so
	 * the host can sync state.
	 */
	open( file: OpenFileMeta ): string;
	/**
	 * Programmatic close (no confirm prompt). Use after a successful
	 * external save, or for the host to clean up on shell teardown.
	 */
	closeQuiet( path: string ): void;
	setActive( path: string ): void;
	getActive(): string | null;
	setDirty( path: string, dirty: boolean ): void;
	has( path: string ): boolean;
	dispose(): void;
}

interface InternalTab extends OpenFileMeta {
	dirty: boolean;
	li: HTMLLIElement;
	dirtyEl: HTMLElement;
}

export function mountTabsStrip(
	opts: TabsStripOptions,
): TabsStripHandle {
	const { mount, onActivate, onClose } = opts;
	mount.classList.add( 'wpdc-tabs' );

	const ul = document.createElement( 'ul' );
	ul.className = 'wpdc-tabs__list';
	mount.replaceChildren( ul );

	const tabs = new Map< string, InternalTab >();
	const order: string[] = [];
	let active: string | null = null;

	const updateActiveClass = (): void => {
		for ( const [ path, tab ] of tabs ) {
			tab.li.classList.toggle( 'wpdc-tabs__tab--active', path === active );
		}
	};

	const indexOf = ( path: string ): number => order.indexOf( path );

	const pickNeighbour = ( path: string ): string | null => {
		const idx = indexOf( path );
		if ( idx === -1 ) {
			return null;
		}
		// Right neighbour first (matches VS Code), then left.
		if ( order[ idx + 1 ] ) {
			return order[ idx + 1 ];
		}
		if ( order[ idx - 1 ] ) {
			return order[ idx - 1 ];
		}
		return null;
	};

	const removeTab = ( path: string ): void => {
		const tab = tabs.get( path );
		if ( ! tab ) {
			return;
		}

		// Pick the successor BEFORE removing this tab from `order`.
		// `pickNeighbour` reads `order.indexOf( path )`, which would
		// return -1 once we splice — and the closer would always
		// fall through to the empty state even with siblings still
		// open.
		const wasActive = active === path;
		const successor = wasActive ? pickNeighbour( path ) : null;

		tab.li.remove();
		tabs.delete( path );
		const idx = indexOf( path );
		if ( idx !== -1 ) {
			order.splice( idx, 1 );
		}

		if ( wasActive ) {
			active = successor;
			updateActiveClass();
			if ( active ) {
				onActivate( active );
			}
		}
		onClose( path );
	};

	const closeWithGuard = async ( path: string ): Promise< void > => {
		const tab = tabs.get( path );
		if ( ! tab ) {
			return;
		}
		if ( tab.dirty ) {
			const ok = await showConfirm( {
				title: 'Close without saving?',
				body: `${ tab.path } has unsaved changes. Close anyway?`,
				confirmLabel: 'Close without saving',
				cancelLabel: 'Keep open',
				danger: true,
			} );
			if ( ! ok ) {
				return;
			}
		}
		removeTab( path );
	};

	const buildTab = ( file: OpenFileMeta ): InternalTab => {
		const li = document.createElement( 'li' );
		li.className = 'wpdc-tabs__tab';
		li.dataset.path = file.path;
		li.title = file.path;

		const body = document.createElement( 'button' );
		body.type = 'button';
		body.className = 'wpdc-tabs__body';
		body.addEventListener( 'click', () => {
			if ( active !== file.path ) {
				active = file.path;
				updateActiveClass();
				onActivate( file.path );
			}
		} );

		const icon = document.createElement( 'span' );
		icon.className = `wpdc-tabs__icon dashicons ${ file.icon }`;
		icon.setAttribute( 'aria-hidden', 'true' );

		const label = document.createElement( 'span' );
		label.className = 'wpdc-tabs__label';
		label.textContent = file.label;

		body.append( icon, label );

		// Dirty dot + close button live in the same slot. The CSS
		// crossfades them on hover so a clean tab shows nothing
		// until the user reaches for it (cleaner visual rhythm —
		// VS Code uses the same affordance).
		const trailing = document.createElement( 'span' );
		trailing.className = 'wpdc-tabs__trailing';

		const dirtyEl = document.createElement( 'span' );
		dirtyEl.className = 'wpdc-tabs__dirty';
		dirtyEl.textContent = '●';
		dirtyEl.setAttribute( 'aria-label', 'Unsaved changes' );

		const closeBtn = document.createElement( 'button' );
		closeBtn.type = 'button';
		closeBtn.className = 'wpdc-tabs__close';
		closeBtn.setAttribute( 'aria-label', 'Close tab' );
		closeBtn.textContent = '×';
		closeBtn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void closeWithGuard( file.path );
		} );

		trailing.append( dirtyEl, closeBtn );
		li.append( body, trailing );

		// Middle-click closes, matching every browser tab strip.
		li.addEventListener( 'auxclick', ( e ) => {
			if ( e.button === 1 ) {
				e.preventDefault();
				void closeWithGuard( file.path );
			}
		} );

		return { ...file, dirty: false, li, dirtyEl };
	};

	const setDirty = ( path: string, dirty: boolean ): void => {
		const tab = tabs.get( path );
		if ( ! tab || tab.dirty === dirty ) {
			return;
		}
		tab.dirty = dirty;
		tab.li.classList.toggle( 'wpdc-tabs__tab--dirty', dirty );
	};

	return {
		open( file ) {
			let tab = tabs.get( file.path );
			if ( ! tab ) {
				tab = buildTab( file );
				tabs.set( file.path, tab );
				order.push( file.path );
				ul.append( tab.li );
			}
			active = file.path;
			updateActiveClass();
			tab.li.scrollIntoView( {
				inline: 'nearest',
				block: 'nearest',
				behavior: 'smooth',
			} );
			return active;
		},

		closeQuiet( path ) {
			removeTab( path );
		},

		setActive( path ) {
			if ( ! tabs.has( path ) ) {
				return;
			}
			active = path;
			updateActiveClass();
		},

		getActive() {
			return active;
		},

		setDirty,

		has( path ) {
			return tabs.has( path );
		},

		dispose() {
			tabs.clear();
			order.length = 0;
			active = null;
			mount.replaceChildren();
		},
	};
}

/**
 * Derive default tab metadata from a file path. The host can pass
 * its own `icon`/`label` to {@link TabsStripHandle.open}, but
 * Phase 2.5's typical case (open via tree click) already has
 * everything the icon-and-basename derivation needs.
 */
export function tabMetaForPath( path: string ): OpenFileMeta {
	const slash = path.lastIndexOf( '/' );
	const label = slash >= 0 ? path.slice( slash + 1 ) : path;
	const dot = label.lastIndexOf( '.' );
	const ext = dot >= 0 ? label.slice( dot + 1 ).toLowerCase() : '';

	const ICON_BY_EXT: Record< string, string > = {
		php: 'dashicons-editor-code',
		js: 'dashicons-editor-code',
		mjs: 'dashicons-editor-code',
		cjs: 'dashicons-editor-code',
		jsx: 'dashicons-editor-code',
		ts: 'dashicons-editor-code',
		tsx: 'dashicons-editor-code',
		css: 'dashicons-art',
		scss: 'dashicons-art',
		sass: 'dashicons-art',
		less: 'dashicons-art',
		html: 'dashicons-html',
		htm: 'dashicons-html',
		json: 'dashicons-media-text',
		md: 'dashicons-media-document',
		mdx: 'dashicons-media-document',
		svg: 'dashicons-format-image',
		xml: 'dashicons-media-text',
		yml: 'dashicons-media-text',
		yaml: 'dashicons-media-text',
		txt: 'dashicons-media-default',
	};

	return {
		path,
		label,
		icon: ICON_BY_EXT[ ext ] ?? 'dashicons-media-default',
	};
}
