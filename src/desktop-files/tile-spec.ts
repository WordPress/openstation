import { TILE_CLASS, getDragManager } from '../ui/components/os-tile/os-tile';
import { applyFilters } from '../hooks';
import type { ShortcutDragData } from './drag-payloads';

export { TILE_CLASS };

export type TileStatus = 'draft' | 'pending' | 'private' | 'future' | string;

export interface TileSpec {

	type: string;

	ref: string;

	label: string;

	icon?: string;

	thumbnail?: string;

	role?: 'folder' | 'entry';

	status?: TileStatus;

	x?: number;
	y?: number;

	dataset?: Record< string, string | number | undefined >;

	meta?: Record< string, unknown >;

	extraClasses?: string[];

	ariaLabel?: string;

	missing?: boolean;

	accessGated?: boolean;
}

export function buildTileFromSpec( spec: TileSpec ): HTMLElement {
	const tile = document.createElement( 'os-tile' );

	tile.setAttribute( 'type', spec.type );
	tile.setAttribute( 'ref', spec.ref );
	tile.setAttribute( 'label', spec.label );
	if ( spec.icon ) {
		tile.setAttribute( 'icon', spec.icon );
	}
	if ( spec.thumbnail ) {
		tile.setAttribute( 'thumbnail', spec.thumbnail );
	}
	if ( spec.role ) {
		tile.setAttribute( 'kind', spec.role );
	}
	if ( spec.status ) {
		tile.setAttribute( 'status', spec.status );
	}
	if ( spec.missing ) {
		tile.setAttribute( 'missing', '' );
	}
	if ( spec.accessGated ) {
		tile.setAttribute( 'access-gated', '' );
	}

	if ( spec.dataset ) {
		for ( const [ key, raw ] of Object.entries( spec.dataset ) ) {
			if ( raw === undefined || raw === null ) {
				continue;
			}
			( tile as HTMLElement ).dataset[ key ] = String( raw );
		}
	}

	if ( Array.isArray( spec.extraClasses ) ) {
		for ( const c of spec.extraClasses ) {
			if ( c ) {
				tile.classList.add( c );
			}
		}
	}

	const classFiltered = applyFilters< string, [ TileSpec ] >(
		'os.tile.class',
		tile.className,
		spec,
	);
	if ( classFiltered && classFiltered !== tile.className ) {
		tile.className = classFiltered;
	}

	if ( typeof spec.x === 'number' && typeof spec.y === 'number' ) {
		tile.style.position = 'absolute';
		tile.style.left = `${ spec.x }px`;
		tile.style.top = `${ spec.y }px`;
	}

	return tile;
}

export function buildDragStackGhost(
	tile: HTMLElement,
	count: number,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-drag-stack';
	const rect = tile.getBoundingClientRect();
	wrap.style.width = `${ rect.width }px`;
	wrap.style.height = `${ rect.height }px`;

	const clone = tile.cloneNode( true ) as HTMLElement;
	clone.removeAttribute( 'id' );

	clone.removeAttribute( 'selected' );
	clone.removeAttribute( 'aria-selected' );
	clone.classList.remove( `${ TILE_CLASS }--selected` );
	clone.style.left = '0px';
	clone.style.top = '0px';
	clone.style.position = 'relative';
	wrap.appendChild( clone );

	const badge = document.createElement( 'span' );
	badge.className = 'os-drag-stack__count';
	badge.textContent = String( count );
	wrap.appendChild( badge );
	return wrap;
}

export interface TileDragOutPayload {

	kind: string;

	ref: string;

	title?: string;

	icon?: string;

	entityId?: string;

	bridgePayload?: import( '../drag-bridge' ).DragBridgePayload;
}

export function attachTileDragOut(
	tile: HTMLElement,
	payload: TileDragOutPayload,
	onClick?: () => void,
	opts: { resolveSet?: () => TileDragOutPayload[] } = {},
): void {
	tile.addEventListener( 'pointerdown', ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			return;
		}

		if ( e.shiftKey || e.ctrlKey || e.metaKey ) {
			return;
		}
		const dragManager = getDragManager();
		if ( ! dragManager ) {
			return;
		}
		const rect = tile.getBoundingClientRect();

		const set = opts.resolveSet?.() ?? [];
		const many = set.length > 1 ? set : [];
		dragManager.start( {
			payload: {
				type: 'shortcut',
				source: tile,
				data: {
					kind: payload.kind,
					ref: payload.ref,
					title: payload.title,
					icon: payload.icon,
					entityId: payload.entityId,
					bridgePayload: payload.bridgePayload,

					...( many.length > 0 ? { items: many } : {} ),
				} satisfies ShortcutDragData,
				ghost: {
					offsetX: e.clientX - rect.left,
					offsetY: e.clientY - rect.top,
					element:
						many.length > 0
							? buildDragStackGhost( tile, many.length )
							: undefined,
					hint:
						many.length > 0
							? {
								accept: `Add ${ many.length } items here`,
								reject: `Can’t drop ${ many.length } items here`,
								neutral: `Dragging ${ many.length } items`,
							}
							: undefined,
				},
			},
			origin: e,
			onClickOnly: onClick,
		} );
	} );
}
