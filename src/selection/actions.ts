/**
 * OpenStation — "what can I do with THESE?"
 *
 * The framework's half of the multi-selection contract. Each surface
 * already knows how to answer *"what can be done to this one thing?"*
 * — that's its existing tile-menu builder, filters and all. This
 * module answers the other question, once, for every surface:
 * *"what do these N things have in common?"*
 *
 * The rule, in full:
 *
 *   - One item selected → its own action list, untouched. Single-item
 *     menus are exactly what they were before multi-selection existed.
 *   - More than one → intersect by action `id`, and keep an id only
 *     when EVERY contributing action declares `multi: true`.
 *
 * `multi` is opt-in on purpose. A third-party action written against
 * one item — "Share folder…", "Rename…", anything that opens a modal
 * — would misbehave run twelve times over, and the plugin author
 * never agreed to that. Opting in is one field; opting in wrongly is
 * a bug the author can see in their own code.
 *
 * Execution has two modes. An action that ships a `bulk( items )`
 * runner gets called once with the whole set — that's how "Move to
 * Trash" produces one toast with one Undo instead of N of each.
 * Everything else fans out: each contributor's OWN `onClick` closure
 * runs in turn. That closure already captured its item, which is why
 * fan-out needs no cooperation from the surface that built it.
 */

import { applyFilters } from '../hooks';
import { __, sprintf } from '../i18n';

/**
 * One action offered for one item. A superset of the `TileMenuItem`
 * shape the file-tile menu has always used, so existing builders
 * satisfy it as-is and only opt into the new fields when they mean
 * to.
 *
 * @public
 */
export interface SelectionAction< T = unknown > {
	/** Stable id. Also the intersection key unless `multiId` says otherwise. */
	id: string;
	/**
	 * Identity to intersect on when several items are selected.
	 * Defaults to `id`.
	 *
	 * This exists because the same *deed* can carry different
	 * single-item labels: a folder tile offers `delete-folder`
	 * ("Move folder to Trash") and a file tile offers `remove`
	 * ("Move to Trash"). Selecting one of each is a perfectly
	 * ordinary thing to do, and intersecting on the raw ids would
	 * leave that selection with nothing to do. Both declare
	 * `multiId: 'trash'` and merge.
	 */
	multiId?: string;
	label: string;
	/** Dashicon class. */
	icon?: string;
	/** Lower sorts first. Defaults to 100. */
	sort?: number;
	disabled?: boolean;
	danger?: boolean;
	/** Handler for this one item. Always present. */
	onClick: ( e: MouseEvent ) => void | Promise< void >;
	/**
	 * Whether this action is safe to apply to a whole selection.
	 * Defaults to `false` — an action reaches a multi-selection menu
	 * only when it says so.
	 */
	multi?: boolean;
	/**
	 * Label for a set. Receives the count. Falls back to
	 * `"<label> (N items)"`.
	 */
	bulkLabel?: ( count: number ) => string;
	/**
	 * Batched runner. When present it replaces the per-item fan-out
	 * and is called ONCE with every selected item.
	 */
	bulk?: ( items: T[] ) => void | Promise< void >;
}

/** Context handed to the `os.selection.actions` filter. */
export interface SelectionActionsContext< T > {
	items: readonly T[];
	count: number;
}

function sortValue( action: { sort?: number } ): number {
	return typeof action.sort === 'number' ? action.sort : 100;
}

/**
 * Default label for a set, used when an action ships no `bulkLabel`.
 * Kept out of line so every surface pluralizes identically.
 */
function defaultBulkLabel( label: string, count: number ): string {
	return sprintf(
		/* translators: 1: action label, e.g. "Open". 2: number of selected items. */
		__( '%1$s (%2$d items)', 'desktop-mode' ),
		label,
		count,
	);
}

/**
 * Resolve the actions to offer for a selection.
 *
 * `actionsFor` is called once per item — surfaces can build lazily
 * and apply their own filters inside it without worrying about
 * repeat work.
 *
 * @public
 */
export function resolveCommonActions< T >(
	items: readonly T[],
	actionsFor: ( item: T ) => SelectionAction< T >[],
): SelectionAction< T >[] {
	if ( items.length === 0 ) {
		return [];
	}

	const lists = items.map( ( item ) => {
		const list = actionsFor( item );
		return Array.isArray( list ) ? list : [];
	} );

	// Single selection — hand back the surface's own list verbatim.
	// No intersection, no relabelling, no filter: the single-item
	// menu is the one that already existed.
	if ( items.length === 1 ) {
		return lists[ 0 ];
	}

	const count = items.length;
	const common: SelectionAction< T >[] = [];
	const keyOf = ( action: SelectionAction< T > ): string =>
		action.multiId ?? action.id;

	for ( const candidate of lists[ 0 ] ) {
		const key = keyOf( candidate );
		const contributors: SelectionAction< T >[] = [];
		let missing = false;
		for ( const list of lists ) {
			const match = list.find( ( a ) => keyOf( a ) === key );
			if ( ! match || match.multi !== true ) {
				missing = true;
				break;
			}
			contributors.push( match );
		}
		if ( missing || common.some( ( a ) => a.id === key ) ) {
			continue;
		}

		const primary = contributors[ 0 ];
		const label = primary.bulkLabel
			? primary.bulkLabel( count )
			: defaultBulkLabel( primary.label, count );

		common.push( {
			id: key,
			label,
			icon: primary.icon,
			// Least-forgiving wins: one disabled contributor disables
			// the set, one danger contributor marks the whole thing
			// destructive. Both err toward telling the user less will
			// happen than they asked for, never more.
			disabled: contributors.some( ( a ) => a.disabled === true ),
			danger: contributors.some( ( a ) => a.danger === true ),
			sort: Math.min( ...contributors.map( sortValue ) ),
			multi: true,
			onClick: async ( e: MouseEvent ) => {
				if ( typeof primary.bulk === 'function' ) {
					await primary.bulk( items.slice() );
					return;
				}
				// Fan-out. Sequential, not parallel: these are the
				// surface's own single-item handlers, and several of
				// them open windows or write settings where ordering
				// is visible to the user.
				for ( const contributor of contributors ) {
					try {
						await contributor.onClick( e );
					} catch ( err ) {
						// eslint-disable-next-line no-console
						console.error(
							`[openstation] selection action '${ primary.id }' failed for one item:`,
							err,
						);
					}
				}
			},
		} );
	}

	common.sort( ( a, b ) => {
		const sa = sortValue( a );
		const sb = sortValue( b );
		return sa !== sb ? sa - sb : a.label.localeCompare( b.label );
	} );

	const filtered = applyFilters<
		SelectionAction< T >[],
		[ SelectionActionsContext< T > ]
	>( 'os.selection.actions', common, { items, count } );

	return Array.isArray( filtered ) ? filtered : common;
}
