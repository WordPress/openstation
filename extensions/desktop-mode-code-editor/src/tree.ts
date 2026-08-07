/**
 * Code Editor — file-tree component.
 *
 * Hand-rolled recursive tree, lazy-expanding. Each folder fetches
 * its children on first expand; subsequent expand/collapse cycles
 * just toggle visibility. Click on a folder row toggles. Click on
 * a file row fires the host's `onOpen( path )` callback.
 *
 * No dedicated `<os-tree>` primitive yet — this is rolled here so
 * the editor isn't blocked on a component-kit addition. If a third
 * plugin needs the same shape, promote.
 *
 * @internal
 */

import { fetchTree, type TreeEntry } from './rest';

export interface FileTreeOptions {
	/** Mount node — the tree's `<ul>` becomes a child of this. */
	mount: HTMLElement;
	/** Called when the user clicks a file row that's `allowed`. */
	onOpen: ( path: string ) => void;
}

export interface FileTreeHandle {
	/** Tear down listeners + DOM. */
	dispose(): void;
}

const FOLDER_ICON_CLOSED = 'dashicons-category';
const FOLDER_ICON_OPEN = 'dashicons-portfolio';
const FILE_ICON = 'dashicons-media-default';
const FILE_ICONS_BY_EXT: Record< string, string > = {
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

function iconFor( entry: TreeEntry, expanded: boolean ): string {
	if ( entry.type === 'dir' ) {
		return expanded ? FOLDER_ICON_OPEN : FOLDER_ICON_CLOSED;
	}
	const dot = entry.name.lastIndexOf( '.' );
	const ext = dot >= 0 ? entry.name.slice( dot + 1 ).toLowerCase() : '';
	return FILE_ICONS_BY_EXT[ ext ] ?? FILE_ICON;
}

export function mountFileTree( opts: FileTreeOptions ): FileTreeHandle {
	const { mount, onOpen } = opts;

	mount.classList.add( 'osc-tree' );
	mount.replaceChildren();

	// Map of path → its child <ul> so collapse-then-re-expand doesn't
	// re-fetch. Closures over a single `expanded` Set keep state.
	const childrenByPath = new Map< string, HTMLUListElement >();
	const expanded = new Set< string >();

	// Single AbortController per expanding path so a fast double-click
	// (expand → collapse → expand) cancels the in-flight request
	// instead of racing.
	const inflight = new Map< string, AbortController >();

	const renderRow = ( entry: TreeEntry ): HTMLLIElement => {
		const li = document.createElement( 'li' );
		li.className = `osc-tree__row osc-tree__row--${ entry.type }`;
		if ( ! entry.allowed && entry.type === 'file' ) {
			li.classList.add( 'osc-tree__row--disabled' );
		}
		li.dataset.path = entry.path;

		const button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'osc-tree__btn';
		if ( ! entry.allowed && entry.type === 'file' ) {
			button.disabled = true;
			button.title = 'File extension is not in the editor allowlist.';
		}

		const caret = document.createElement( 'span' );
		caret.className = 'osc-tree__caret';
		caret.textContent = entry.type === 'dir' ? '▸' : '';

		const icon = document.createElement( 'span' );
		icon.className = `osc-tree__icon dashicons ${ iconFor( entry, false ) }`;
		icon.setAttribute( 'aria-hidden', 'true' );

		const label = document.createElement( 'span' );
		label.className = 'osc-tree__label';
		label.textContent = entry.name;

		button.append( caret, icon, label );
		li.append( button );

		if ( entry.type === 'file' ) {
			button.addEventListener( 'click', () => {
				if ( ! entry.allowed ) {
					return;
				}
				// Visual selection — single-select, light enough we
				// don't need a separate state machine.
				mount
					.querySelectorAll< HTMLElement >( '.osc-tree__row--active' )
					.forEach( ( el ) =>
						el.classList.remove( 'osc-tree__row--active' ),
					);
				li.classList.add( 'osc-tree__row--active' );
				onOpen( entry.path );
			} );
			return li;
		}

		// Directory.
		const childUl = document.createElement( 'ul' );
		childUl.className = 'osc-tree__children';
		childUl.hidden = true;
		li.append( childUl );

		const setExpanded = ( open: boolean ): void => {
			caret.textContent = open ? '▾' : '▸';
			icon.className = `osc-tree__icon dashicons ${ iconFor( entry, open ) }`;
			childUl.hidden = ! open;
			button.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
		};

		button.addEventListener( 'click', async () => {
			if ( expanded.has( entry.path ) ) {
				expanded.delete( entry.path );
				setExpanded( false );
				inflight.get( entry.path )?.abort();
				inflight.delete( entry.path );
				return;
			}
			expanded.add( entry.path );
			setExpanded( true );

			// Fetch only on first expansion. Subsequent toggles use
			// the cached <ul>.
			if ( childrenByPath.has( entry.path ) ) {
				return;
			}
			const ac = new AbortController();
			inflight.set( entry.path, ac );

			try {
				const placeholder = document.createElement( 'li' );
				placeholder.className = 'osc-tree__loading';
				placeholder.textContent = 'Loading…';
				childUl.append( placeholder );

				const resp = await fetchTree( entry.path, ac.signal );
				childUl.replaceChildren();
				for ( const child of resp.entries ) {
					childUl.append( renderRow( child ) );
				}
				childrenByPath.set( entry.path, childUl );
			} catch ( err ) {
				if ( ( err as Error ).name === 'AbortError' ) {
					return;
				}
				childUl.replaceChildren();
				const errorRow = document.createElement( 'li' );
				errorRow.className = 'osc-tree__error';
				errorRow.textContent =
					err instanceof Error ? err.message : 'Failed to load';
				childUl.append( errorRow );
			} finally {
				inflight.delete( entry.path );
			}
		} );

		setExpanded( false );
		return li;
	};

	const rootUl = document.createElement( 'ul' );
	rootUl.className = 'osc-tree__root';
	mount.append( rootUl );

	const loading = document.createElement( 'li' );
	loading.className = 'osc-tree__loading';
	loading.textContent = 'Loading workspace…';
	rootUl.append( loading );

	const rootController = new AbortController();
	void ( async () => {
		try {
			const resp = await fetchTree( '', rootController.signal );
			rootUl.replaceChildren();
			for ( const entry of resp.entries ) {
				rootUl.append( renderRow( entry ) );
			}
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				return;
			}
			rootUl.replaceChildren();
			const errorRow = document.createElement( 'li' );
			errorRow.className = 'osc-tree__error';
			errorRow.textContent =
				err instanceof Error ? err.message : 'Failed to load workspace';
			rootUl.append( errorRow );
		}
	} )();

	return {
		dispose() {
			rootController.abort();
			for ( const ac of inflight.values() ) {
				ac.abort();
			}
			inflight.clear();
			childrenByPath.clear();
			expanded.clear();
			mount.replaceChildren();
		},
	};
}
