/* eslint-disable no-bitwise -- FNV-1a and mulberry32 are defined in terms of
   32-bit XOR / shift / OR; bitwise operators are intrinsic to the algorithms,
   not a stylistic choice. The WP preset disallows them by default. */

export function hash32( input: string ): number {
	let h = 0x811c9dc5;
	for ( let i = 0; i < input.length; i++ ) {
		h ^= input.charCodeAt( i );
		h = Math.imul( h, 0x01000193 );
	}
	return h >>> 0;
}

export function mulberry32( seed: number ): () => number {
	let a = seed >>> 0;
	return function next(): number {
		a = ( a + 0x6d2b79f5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
	};
}
