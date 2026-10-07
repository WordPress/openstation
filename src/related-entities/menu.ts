import type { RelatedEntityItem } from '../window-links/types';

function groupRank( group: string ): number {
	if ( group === 'comments' ) {
		return 0;
	}
	if ( group.startsWith( 'terms/' ) ) {
		return 1;
	}
	if ( group === 'media' ) {
		return 2;
	}
	if ( group === 'links' ) {
		return 3;
	}
	return 4;
}

export function buildRelatedMenu( {
	items,
	onPick,
}: {
	items: RelatedEntityItem[];
	onPick: ( item: RelatedEntityItem ) => void;
} ): HTMLElement {
	const panel = document.createElement( 'os-menu' );

	panel.classList.add( 'os-window__menu-panel' );
	panel.classList.add( 'os-window__related-panel' );

	const groups = new Map< string, RelatedEntityItem[] >();
	for ( const item of items ) {
		const bucket = groups.get( item.group );
		if ( bucket ) {
			bucket.push( item );
		} else {
			groups.set( item.group, [ item ] );
		}
	}
	const ordered = Array.from( groups.entries() ).sort(
		( a, b ) => groupRank( a[ 0 ] ) - groupRank( b[ 0 ] ),
	);

	const rows: HTMLElement[] = [];
	for ( const [ , groupItems ] of ordered ) {
		const groupLabel = groupItems.find(
			( item ) => typeof item.groupLabel === 'string' && item.groupLabel !== '',
		)?.groupLabel;
		if ( groupLabel ) {
			const header = document.createElement( 'div' );
			header.className = 'os-window__related-group';
			header.setAttribute( 'role', 'presentation' );
			header.textContent = groupLabel;
			panel.appendChild( header );
		}

		for ( const item of groupItems ) {
			const row = document.createElement( 'os-menu-item' );
			row.setAttribute( 'role', 'menuitem' );
			row.setAttribute( 'value', item.id );

			row.tabIndex = -1;
			if ( item.icon ) {
				row.setAttribute( 'icon', item.icon );
			}
			row.classList.add( 'os-window__related-item' );
			row.textContent =
				typeof item.count === 'number'
					? `${ item.label } (${ item.count })`
					: item.label;
			row.addEventListener( 'os-menu-item-click', ( e: Event ) => {
				e.stopPropagation();
				onPick( item );
			} );
			rows.push( row );
			panel.appendChild( row );
		}
	}

	panel.addEventListener( 'keydown', ( e: Event ) => {
		const kev = e as KeyboardEvent;
		const active = rows.indexOf(
			panel.ownerDocument.activeElement as HTMLElement,
		);
		if ( kev.key === 'ArrowDown' || kev.key === 'ArrowUp' ) {
			kev.preventDefault();
			kev.stopPropagation();
			const down = kev.key === 'ArrowDown';
			let next = rows[ down ? 0 : rows.length - 1 ];
			if ( active !== -1 ) {
				const step = down ? 1 : -1;
				next = rows[ ( active + step + rows.length ) % rows.length ];
			}
			next?.focus();
		} else if ( kev.key === 'Home' || kev.key === 'End' ) {
			kev.preventDefault();
			kev.stopPropagation();
			rows[ kev.key === 'Home' ? 0 : rows.length - 1 ]?.focus();
		} else if ( kev.key === 'Enter' || kev.key === ' ' ) {
			const row = rows[ active ];
			if ( row ) {
				kev.preventDefault();
				kev.stopPropagation();

				row.dispatchEvent(
					new CustomEvent( 'os-menu-item-click', {
						bubbles: true,
					} ),
				);
			}
		}
	} );

	return panel;
}
