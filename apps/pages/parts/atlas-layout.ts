import { SHEET_WIDTH, SHEET_HEIGHT, type AtlasPage, type AtlasNode, type AtlasEdge } from './atlas-model';
export interface RoutePoint { x: number; y: number }
export const COLUMN_STEP = 480;
export const ROW_STEP = 368;

export function layoutAtlas( pages: AtlasPage[], edges: AtlasEdge[], home?: number ): AtlasNode[] {
	const byId = new Map( pages.map( ( p ) => [ p.id, p ] ) );
	const neighbors = new Map( pages.map( ( p ) => [ p.id, new Set< number >() ] ) );
	for ( const edge of edges ) {
		neighbors.get( edge.from )?.add( edge.to ); neighbors.get( edge.to )?.add( edge.from );
	}
	const seen = new Set< number >();
	const groups: number[][] = [];
	for ( const page of pages ) {
		if ( seen.has( page.id ) ) {
			continue;
		}
		const group = [ page.id ]; seen.add( page.id );
		for ( let i = 0; i < group.length; i++ ) {
			for ( const id of neighbors.get( group[ i ] ) || [] ) {
				if ( byId.has( id ) && ! seen.has( id ) ) {
					seen.add( id ); group.push( id );
				}
			}
		}
		groups.push( group );
	}
	groups.sort( ( a, b ) => b.length - a.length || a[ 0 ] - b[ 0 ] );
	const positions = new Map< number, RoutePoint >();
	let cursorY = 0;
	let widest = 1;
	for ( const group of groups.filter( ( g ) => g.length > 1 ) ) {
		const root = group.includes( home || 0 ) ? home! : [ ...group ].sort( ( a, b ) => ( neighbors.get( b )?.size || 0 ) - ( neighbors.get( a )?.size || 0 ) || a - b )[ 0 ];
		const depths = new Map< number, number >( [ [ root, 0 ] ] );
		const queue = [ root ];
		for ( let i = 0; i < queue.length; i++ ) {
			for ( const id of neighbors.get( queue[ i ] ) || [] ) {
				if ( ! depths.has( id ) && byId.has( id ) ) {
					depths.set( id, depths.get( queue[ i ] )! + 1 ); queue.push( id );
				}
			}
		}
		const layers: number[][] = [];
		for ( const id of queue ) {
			( layers[ depths.get( id )! ] ??= [] ).push( id );
		}

		for ( let pass = 0; pass < 6; pass++ ) {
			const order = layers.map( ( _, index ) => index );
			if ( pass % 2 ) {
				order.reverse();
			}
			for ( const index of order ) {
				const adjacent = layers[ index + ( pass % 2 ? 1 : -1 ) ];
				if ( ! adjacent ) {
					continue;
				}
				const rank = new Map( adjacent.map( ( id, i ) => [ id, i ] ) );
				const score = ( id: number ): number => {
					const values = Array.from( neighbors.get( id ) || [] ).filter( ( n ) => rank.has( n ) ).map( ( n ) => rank.get( n )! );
					return values.length ? values.reduce( ( a, b ) => a + b, 0 ) / values.length : 0;
				};
				layers[ index ].sort( ( a, b ) => score( a ) - score( b ) || a - b );
			}
		}
		const height = Math.min( 6, Math.max( ...layers.map( ( layer ) => layer.length ) ) );
		let column = 0;
		for ( const layer of layers ) {
			layer.forEach( ( id, i ) => positions.set( id, { x: ( column + Math.floor( i / height ) ) * COLUMN_STEP, y: ( cursorY + i % height + Math.floor( ( height - Math.min( height, layer.length ) ) / 2 ) ) * ROW_STEP } ) );
			column += Math.ceil( layer.length / height );
		}
		cursorY += height + 1; widest = Math.max( widest, column );
	}
	const isolated = groups.filter( ( g ) => g.length === 1 ).flat();
	const columns = Math.max( widest + ( isolated.length ? 1 : 0 ), Math.ceil( Math.sqrt( pages.length * 1.2 ) ), 1 );
	let slot = 0;
	for ( const id of isolated ) {
		while ( Math.floor( slot / columns ) < Math.max( 0, cursorY - 1 ) && slot % columns < widest ) {
			slot++;
		}
		positions.set( id, { x: slot % columns * COLUMN_STEP, y: Math.floor( slot / columns ) * ROW_STEP } ); slot++;
	}
	return [ ...pages ].sort( ( a, b ) => Number( b.id === home ) - Number( a.id === home ) ).map( ( page ) => ( { page, ...positions.get( page.id )! } ) );
}

export function routeThread( from: AtlasNode, to: AtlasNode, lane = 0 ): RoutePoint[] {
	const offset = ( lane % 7 - 3 ) * 7;
	const right = to.x >= from.x;
	const start = { x: from.x + ( right ? SHEET_WIDTH : 0 ), y: from.y + SHEET_HEIGHT / 2 + offset };
	const sameColumn = from.x === to.x;
	const end = { x: to.x + ( right && ! sameColumn ? 0 : SHEET_WIDTH ), y: to.y + SHEET_HEIGHT / 2 + offset };
	const exitX = from.x + ( right ? SHEET_WIDTH + 90 + offset : -90 + offset );
	const entryX = to.x + ( right && ! sameColumn ? -90 + offset : SHEET_WIDTH + 90 + offset );
	let points: RoutePoint[];
	if ( sameColumn ) {
		points = [ start, { x: exitX, y: start.y }, { x: exitX, y: end.y }, end ];
	} else if ( from.y === to.y && Math.abs( from.x - to.x ) === COLUMN_STEP ) {
		points = [ start, end ];
	} else {
		const gutterY = from.y + ( to.y < from.y ? -55 : SHEET_HEIGHT + 55 ) + offset;
		points = [ start, { x: exitX, y: start.y }, { x: exitX, y: gutterY }, { x: entryX, y: gutterY }, { x: entryX, y: end.y }, end ];
	}
	return points.filter( ( point, i ) => ! i || point.x !== points[ i - 1 ].x || point.y !== points[ i - 1 ].y );
}
