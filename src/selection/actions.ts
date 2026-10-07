import { applyFilters } from '../hooks';
import { __, sprintf } from '../i18n';

export interface SelectionAction< T = unknown > {

	id: string;

	multiId?: string;
	label: string;

	icon?: string;

	sort?: number;
	disabled?: boolean;
	danger?: boolean;

	onClick: ( e: MouseEvent ) => void | Promise< void >;

	multi?: boolean;

	bulkLabel?: ( count: number ) => string;

	bulk?: ( items: T[] ) => void | Promise< void >;
}

export interface SelectionActionsContext< T > {
	items: readonly T[];
	count: number;
}

function sortValue( action: { sort?: number } ): number {
	return typeof action.sort === 'number' ? action.sort : 100;
}

function defaultBulkLabel( label: string, count: number ): string {
	return sprintf(

		__( '%1$s (%2$d items)', 'desktop-mode' ),
		label,
		count,
	);
}

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

			disabled: contributors.some( ( a ) => a.disabled === true ),
			danger: contributors.some( ( a ) => a.danger === true ),
			sort: Math.min( ...contributors.map( sortValue ) ),
			multi: true,
			onClick: async ( e: MouseEvent ) => {
				const batches = new Map< NonNullable< SelectionAction< T >[ 'bulk' ] >, T[] >();
				const singles: Array< SelectionAction< T > > = [];
				contributors.forEach( ( contributor, index ) => {
					const runner = contributor.bulk;
					if ( typeof runner !== 'function' ) {
						singles.push( contributor );
						return;
					}
					const batch = batches.get( runner );
					if ( batch ) {
						batch.push( items[ index ] );
					} else {
						batches.set( runner, [ items[ index ] ] );
					}
				} );

				for ( const [ runner, batch ] of batches ) {
					try {
						await runner( batch );
					} catch ( err ) {
						console.error(
							`[openstation] selection action '${ key }' failed for a batch:`,
							err,
						);
					}
				}

				for ( const contributor of singles ) {
					try {
						await contributor.onClick( e );
					} catch ( err ) {
						console.error(
							`[openstation] selection action '${ key }' failed for one item:`,
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
