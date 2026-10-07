import type { Obstacle } from './environment';

const MAX_STALE_MS = 250;

export interface ObstacleTrack {

	sample( obstacles: readonly Obstacle[], nowMs: number ): void;

	at( nowMs: number ): readonly Obstacle[];

	reset(): void;
}

function keyed( obstacles: readonly Obstacle[] ): Map< string, Obstacle > {
	const out = new Map< string, Obstacle >();
	const seen = new Map< string, number >();
	for ( const o of obstacles ) {
		const n = seen.get( o.id ) ?? 0;
		seen.set( o.id, n + 1 );
		out.set( 0 === n ? o.id : `${ o.id }#${ n }`, o );
	}
	return out;
}

function unchanged(
	a: Map< string, Obstacle >,
	b: Map< string, Obstacle >,
): boolean {
	if ( a.size !== b.size ) {
		return false;
	}
	for ( const [ key, prev ] of a ) {
		const next = b.get( key );
		if (
			! next ||
			next.x !== prev.x ||
			next.y !== prev.y ||
			next.width !== prev.width ||
			next.height !== prev.height
		) {
			return false;
		}
	}
	return true;
}

function lerp( a: number, b: number, t: number ): number {
	return a + ( b - a ) * t;
}

export function createObstacleTrack( intervalMs: number ): ObstacleTrack {
	const interval = Math.max( 1, intervalMs );
	let previous = new Map< string, Obstacle >();
	let current = new Map< string, Obstacle >();

	let currentList: readonly Obstacle[] = [];
	let sampledAt = 0;

	let still = true;

	return {
		sample( obstacles: readonly Obstacle[], nowMs: number ): void {
			const gap = nowMs - sampledAt;
			previous = current;
			current = keyed( obstacles );
			currentList = obstacles;
			sampledAt = nowMs;
			still = gap > MAX_STALE_MS || unchanged( previous, current );
		},

		at( nowMs: number ): readonly Obstacle[] {
			if ( still ) {
				return currentList;
			}
			const t = Math.min(
				1,
				Math.max( 0, ( nowMs - sampledAt ) / interval ),
			);
			if ( 1 <= t ) {
				return currentList;
			}
			const out: Obstacle[] = [];
			for ( const [ key, o ] of current ) {
				const prev = previous.get( key );
				if ( ! prev ) {
					out.push( o );
					continue;
				}
				out.push( {
					id: o.id,
					kind: o.kind,
					face: o.face,
					x: lerp( prev.x, o.x, t ),
					y: lerp( prev.y, o.y, t ),
					width: lerp( prev.width, o.width, t ),
					height: lerp( prev.height, o.height, t ),
				} );
			}
			return out;
		},

		reset(): void {
			previous = current;
			still = true;
		},
	};
}
