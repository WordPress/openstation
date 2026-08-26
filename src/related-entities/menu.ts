/**
 * OpenStation — Related-entities menu construction.
 *
 * Builds the `<os-menu>` panel the title bar's "Related" button
 * opens: one section per group (Comments, per-taxonomy terms, Media,
 * then vendor-defined groups), one `<os-menu-item>` per related
 * entity. Pure DOM construction — open/close lifecycle and dismissal
 * live in `index.ts`, mirroring how `src/window/menus.ts` owns the ⋯
 * menu's state while `src/window/dom.ts` builds it.
 */

import type { RelatedEntityItem } from '../window-links/types';

/**
 * Display rank of a group key — built-ins first, in a fixed order,
 * vendor groups after in arrival order.
 */
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

/**
 * Build the "Related" dropdown panel for a resolved item list.
 *
 * Items are partitioned by `group` (arrival order preserved within a
 * group and between same-rank groups), each section headed by its
 * first item's `groupLabel` when present. Picking an item calls
 * `onPick` — the caller closes the panel and opens the target.
 *
 * @param opts        Options bag.
 * @param opts.items  Resolved related-entity items (non-empty).
 * @param opts.onPick Called with the picked item.
 * @return The `<os-menu>` element, ready to append.
 */
export function buildRelatedMenu( {
	items,
	onPick,
}: {
	items: RelatedEntityItem[];
	onPick: ( item: RelatedEntityItem ) => void;
} ): HTMLElement {
	const panel = document.createElement( 'os-menu' );
	// BOTH classes, deliberately. `menu-panel` is the load-bearing one:
	// it carries the absolute dropdown positioning in window-chrome.css
	// AND it's in the title-bar drag tracker's exclusion list
	// (`src/window/pointer.ts`) — without it a pointerdown on a menu
	// item starts a window drag whose pointer capture swallows the
	// click. `related-panel` layers the related-menu extras (scroll
	// cap, section headers) on top.
	panel.classList.add( 'os-window__menu-panel' );
	panel.classList.add( 'os-window__related-panel' );

	// Partition by group, preserving arrival order.
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
			// Focusable host — the component's shadow root doesn't
			// delegate focus, so without a tabindex `.focus()` is a
			// no-op and the ARIA menu pattern (focus moves into the
			// menu, arrows navigate) can't work.
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

	// Roving arrow-key navigation + Enter/Space activation. Keydown
	// fires on the focused row host and bubbles here; Escape is NOT
	// handled — it belongs to the opener (index.ts), which also owns
	// returning focus to the trigger.
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
				// Same event the row's pointer path emits — one
				// activation contract for both input methods.
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
