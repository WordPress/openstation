/**
 * Posts app — the Tags cell: a `<os-tag-input>` per row with
 * autocomplete, free-form creation and optimistic persistence to the
 * post's `tags`. Suggestions are debounced and cancelled with an
 * `AbortController`; adds and removes roll back on failure with a
 * toast. Only the Posts mode renders it, so only the Posts bundle
 * carries the picker.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import '../../../../src/ui/components/os-tag-input/os-tag-input';
import type { OsTagInput, OsTagItem } from '../../../../src/ui/components/os-tag-input/os-tag-input';
import { termRecordsOf, type CellEnv } from './env';
import type { PostListItem, TagTerm } from '../types';

export function buildTagsCell( row: PostListItem, env: CellEnv ): HTMLElement {
	const { client } = env;
	const wrap = document.createElement( 'span' );
	wrap.style.cssText = 'display:inline-flex;align-items:center;width:100%;min-width:0;';

	const picker = document.createElement( 'os-tag-input' ) as OsTagInput;
	picker.setAttribute( 'creatable', '' );
	picker.setAttribute( 'removable', '' );
	picker.setAttribute( 'min-query', '0' );
	picker.setAttribute( 'placeholder', __( 'Add tag…' ) );
	picker.setAttribute( 'add-label', __( 'Tag' ) );
	picker.setAttribute( 'data-noclick', '' );

	const seed: OsTagItem[] = termRecordsOf( row, 'post_tag' ).map( ( t ) => ( { id: t.id, label: t.name } ) );
	picker.value = seed;

	const cellState = {
		// Optimistic mirror of `picker.value` — one source of truth when
		// two events fire in the same tick.
		tags: seed.slice(),
		suggestAbort: null as AbortController | null,
		suggestDebounce: null as number | null,
		lastQuery: '',
	};

	const setValue = ( next: OsTagItem[] ): void => {
		cellState.tags = next.slice();
		picker.value = next;
	};

	picker.addEventListener( 'os-tag-suggest', ( e: Event ) => {
		const q = ( e as CustomEvent< { query: string } > ).detail?.query ?? '';
		cellState.lastQuery = q;
		if ( cellState.suggestDebounce !== null ) {
			window.clearTimeout( cellState.suggestDebounce );
		}
		cellState.suggestDebounce = window.setTimeout( async () => {
			cellState.suggestDebounce = null;
			cellState.suggestAbort?.abort();
			const ac = new AbortController();
			cellState.suggestAbort = ac;
			try {
				const matches = await client.searchTags( q, ac.signal );
				if ( cellState.lastQuery !== q ) {
					return;
				}
				const existingIds = new Set( cellState.tags.map( ( t ) => t.id ) );
				picker.suggestions = matches
					.filter( ( m ) => ! existingIds.has( m.id ) )
					.map( ( m ) => ( { id: m.id, label: m.name } ) );
			} catch ( err ) {
				if ( ( err as Error )?.name === 'AbortError' ) {
					return;
				}
				picker.suggestions = [];
				// eslint-disable-next-line no-console
				console.warn( '[openstation:desktop-mode-posts] tag search failed', err );
			} finally {
				picker.suggestionsLoading = false;
			}
		}, 200 );
	} );

	picker.addEventListener( 'os-tag-add', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { tag: OsTagItem; isNew: boolean } > ).detail;
		if ( ! detail?.tag ) {
			return;
		}
		setValue( [ ...cellState.tags, { id: detail.tag.id, label: detail.tag.label, pending: true } ] );
		try {
			const resolved: TagTerm =
				detail.isNew || typeof detail.tag.id !== 'number'
					? await client.createTag( detail.tag.label )
					: { id: Number( detail.tag.id ), name: detail.tag.label, slug: '' };
			const desiredIds = [
				...cellState.tags.filter( ( t ) => ! t.pending ).map( ( t ) => Number( t.id ) ),
				resolved.id,
			];
			await client.updatePostTags( row.id, desiredIds );
			// Replace the pending placeholder with the canonical term.
			setValue(
				cellState.tags.map( ( t ) =>
					t.label.toLowerCase() === detail.tag.label.toLowerCase()
						? { id: resolved.id, label: resolved.name }
						: t,
				),
			);
			env.announce( 'tagged', [ row.id ] );
		} catch ( err ) {
			setValue( cellState.tags.filter( ( t ) => t.label.toLowerCase() !== detail.tag.label.toLowerCase() ) );
			/* translators: %s: tag label */
			env.toast( sprintf( __( 'Couldn’t add tag "%s".' ), detail.tag.label ), err );
		}
	} );

	picker.addEventListener( 'os-tag-remove', async ( e: Event ) => {
		const detail = ( e as CustomEvent< { tag: OsTagItem } > ).detail;
		if ( ! detail?.tag ) {
			return;
		}
		const removed = detail.tag;
		const previous = cellState.tags.slice();
		setValue( cellState.tags.map( ( t ) => ( t.label === removed.label ? { ...t, pending: true } : t ) ) );
		try {
			const desiredIds = previous
				.filter( ( t ) => t.label !== removed.label )
				.map( ( t ) => Number( t.id ) )
				.filter( ( n ) => Number.isFinite( n ) );
			await client.updatePostTags( row.id, desiredIds );
			setValue( previous.filter( ( t ) => t.label !== removed.label ) );
			env.announce( 'untagged', [ row.id ] );
		} catch ( err ) {
			setValue( previous );
			/* translators: %s: tag label */
			env.toast( sprintf( __( 'Couldn’t remove tag "%s".' ), removed.label ), err );
		}
	} );

	wrap.appendChild( picker );
	return wrap;
}
