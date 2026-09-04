/**
 * Posts app — the Categories cell: a `<os-category-picker>` per row
 * over the window's shared tree cache with optimistic UX, REST
 * roll-back on failure, inline term creation, confirmed deletion, and
 * a drag-and-drop breadcrumb chain that merges into another row's
 * set. Only the Posts mode renders it.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import '../../../../src/ui/components/os-category-picker/os-category-picker';
import type { OsCategoryPicker } from '../../../../src/ui/components/os-category-picker/os-category-picker';
import { termRecordsOf, type CellEnv } from './env';
import type { CategoryTerm, PostListItem } from '../types';

const DRAG_MIME = 'application/x-os-categories';

/**
 * The category tree, fetched once per window and shared by every
 * row's picker. Cleared on close and on an `os.term.changed`
 * broadcast, so a category created elsewhere shows up without an F5.
 */
function getCategoriesTree( env: CellEnv ) {
	if ( ! env.categories.tree ) {
		env.categories.tree = env.client
			.fetchAllCategories()
			.then( ( terms: CategoryTerm[] ) => terms.map( ( t ) => ( { id: t.id, name: t.name, parent: t.parent } ) ) );
	}
	return env.categories.tree;
}

export function clearCategoryTreeCache( env: CellEnv ): void {
	env.categories.tree = null;
}

/**
 * Re-fetch the tree and push it onto every live picker — without
 * this a category created in the mind map is not draggable from any
 * cell, since a chain cannot render a segment for an id the picker
 * does not know about.
 */
export function broadcastFreshCategoryTreeToPickers( env: CellEnv ): void {
	void getCategoriesTree( env )
		.then( ( tree ) => {
			for ( const picker of env.categories.pickers ) {
				if ( picker.isConnected ) {
					picker.items = tree;
				} else {
					env.categories.pickers.delete( picker );
				}
			}
		} )
		.catch( () => {
			// Pickers keep their existing items; the next open retries.
		} );
}

export function buildCategoriesCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const { client } = env;
	const wrap = document.createElement( 'span' );
	wrap.style.cssText =
		'display:inline-flex;align-items:center;width:100%;min-width:0;border-radius:6px;transition:background-color 0.12s ease, box-shadow 0.12s ease;';

	const picker = document.createElement( 'os-category-picker' ) as OsCategoryPicker;
	picker.setAttribute( 'placeholder', __( 'Search categories…' ) );
	picker.setAttribute( 'add-label', __( 'Categorize' ) );
	picker.setAttribute( 'data-noclick', '' );
	env.categories.pickers.add( picker );

	picker.value = row.categories ?? [];
	// Seed from the embedded terms so the first paint has names before
	// the tree fetch resolves.
	picker.items = termRecordsOf( row, 'category' ).map( ( t ) => ( { id: t.id, name: t.name, parent: 0 } ) );

	const cellState = { categoryIds: ( row.categories ?? [] ).slice() };
	const setValue = ( next: number[] ): void => {
		cellState.categoryIds = next.slice();
		picker.value = next;
	};
	const persist = async ( next: number[], previous: number[], failure: string ): Promise< void > => {
		try {
			await client.updatePostCategories( row.id, next );
			env.announce( 'categorized', [ row.id ] );
		} catch ( err ) {
			setValue( previous );
			env.toast( failure, err );
		}
	};

	// Eager tree load so the in-cell breadcrumb chains render full
	// hierarchy paths from the first paint; one round-trip per open.
	void getCategoriesTree( env )
		.then( ( tree ) => {
			if ( picker.isConnected ) {
				picker.items = tree;
			}
		} )
		.catch( ( err ) => {
			// eslint-disable-next-line no-console
			console.warn( '[openstation:desktop-mode-posts] category tree fetch failed', err );
		} );

	picker.addEventListener( 'os-categories-open', () => {
		if ( env.categories.tree ) {
			void env.categories.tree.then( ( tree ) => {
				picker.items = tree;
			} ).catch( () => undefined );
		}
	} );

	picker.addEventListener( 'os-categories-create', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { name: string; parent: number } > ).detail;
		const parent = detail?.parent ?? 0;
		if ( ! detail || ! detail.name ) {
			picker.failCreating( parent );
			return;
		}
		try {
			const created = await client.createCategory( detail.name, parent );
			clearCategoryTreeCache( env );
			picker.items = [ ...picker.items, { id: created.id, name: created.name, parent: created.parent } ];
			const previous = cellState.categoryIds.slice();
			const next = [ ...previous, created.id ];
			setValue( next );
			picker.endCreating( parent );
			await persist( next, previous, __( 'Couldn’t assign new category.' ) );
		} catch ( err ) {
			picker.failCreating( parent, err instanceof Error ? err.message : String( err ) );
			env.toast( __( 'Couldn’t create category.' ), err );
		}
	} );

	picker.addEventListener( 'os-categories-change', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { value: number[] } > ).detail;
		if ( ! detail || ! Array.isArray( detail.value ) ) {
			return;
		}
		const previous = cellState.categoryIds.slice();
		const next = detail.value.slice();
		setValue( next );
		await persist( next, previous, __( 'Couldn’t update categories.' ) );
	} );

	picker.addEventListener( 'os-categories-delete', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: number; name: string } > ).detail;
		if ( ! detail || typeof detail.id !== 'number' ) {
			return;
		}
		const ok = await env.confirm( {
			title: __( 'Delete category?' ),
			message: sprintf(
				/* translators: %s: category name. */
				__( 'Delete the category "%s"? Posts assigned only to it will fall back to Uncategorized.' ),
				detail.name,
			),
			confirmLabel: __( 'Delete' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		try {
			await client.deleteTerm( 'categories', detail.id );
			if ( cellState.categoryIds.includes( detail.id ) ) {
				const next = cellState.categoryIds.filter( ( id ) => id !== detail.id );
				setValue( next );
				try {
					await client.updatePostCategories( row.id, next );
				} catch ( err ) {
					env.toast( __( 'Couldn’t update post categories after delete.' ), err );
				}
			}
		} catch ( err ) {
			env.toast( __( 'Couldn’t delete category.' ), err );
		}
	} );

	// Drag a chain segment (+ its descendants) to another row.
	picker.addEventListener( 'os-chain-segment-dragstart', ( e: Event ) => {
		const detail = ( e as CustomEvent< { segments: Array< { id?: number | string } >; dragEvent: DragEvent } > ).detail;
		if ( ! detail?.dragEvent?.dataTransfer ) {
			return;
		}
		const ids = detail.segments.map( ( seg ) => seg.id ).filter( ( id ): id is number => typeof id === 'number' );
		if ( ids.length === 0 ) {
			return;
		}
		const dt = detail.dragEvent.dataTransfer;
		dt.setData( DRAG_MIME, JSON.stringify( { ids, source: 'posts-window', sourcePostId: row.id } ) );
		dt.setData( 'text/plain', ids.join( ',' ) );
		dt.effectAllowed = 'copy';
	} );

	// Drop target on the cell — an enter counter dodges the "dragleave
	// fires when entering every child" gotcha.
	let dropEnterCount = 0;
	const setDropTargetActive = ( on: boolean ): void => {
		wrap.style.backgroundColor = on ? 'color-mix(in srgb, var(--wp-admin-theme-color, #2271b1) 12%, transparent)' : '';
		wrap.style.boxShadow = on ? 'inset 0 0 0 2px var(--wp-admin-theme-color, #2271b1)' : '';
	};
	const acceptsCategoriesDrag = ( e: DragEvent ): boolean => Array.from( e.dataTransfer?.types ?? [] ).includes( DRAG_MIME );
	wrap.addEventListener( 'dragenter', ( e: DragEvent ) => {
		if ( acceptsCategoriesDrag( e ) ) {
			e.preventDefault();
			dropEnterCount++;
			setDropTargetActive( true );
		}
	} );
	wrap.addEventListener( 'dragover', ( e: DragEvent ) => {
		if ( acceptsCategoriesDrag( e ) ) {
			e.preventDefault();
			if ( e.dataTransfer ) {
				e.dataTransfer.dropEffect = 'copy';
			}
		}
	} );
	wrap.addEventListener( 'dragleave', () => {
		if ( dropEnterCount > 0 ) {
			dropEnterCount--;
		}
		if ( dropEnterCount === 0 ) {
			setDropTargetActive( false );
		}
	} );
	wrap.addEventListener( 'drop', async ( e: DragEvent ) => {
		dropEnterCount = 0;
		setDropTargetActive( false );
		if ( ! acceptsCategoriesDrag( e ) ) {
			return;
		}
		e.preventDefault();
		let parsed: { ids?: unknown; sourcePostId?: number } | null = null;
		try {
			parsed = JSON.parse( e.dataTransfer?.getData( DRAG_MIME ) ?? '' );
		} catch {
			return;
		}
		if ( ! parsed || ! Array.isArray( parsed.ids ) ) {
			return;
		}
		const incoming = parsed.ids.filter( ( v ): v is number => typeof v === 'number' && Number.isFinite( v ) );
		if ( incoming.length === 0 ) {
			return;
		}
		const previous = cellState.categoryIds.slice();
		const merged = Array.from( new Set( [ ...previous, ...incoming ] ) );
		// Nothing new — including a drop back onto the source row.
		if ( merged.length === previous.length ) {
			return;
		}
		setValue( merged );
		await persist( merged, previous, __( 'Couldn’t add category.' ) );
	} );

	wrap.appendChild( picker );
	return wrap;
}
