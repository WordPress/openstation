import { applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import {
	blindsPair,
	curtainPair,
	diagonalPair,
	diamondPair,
	irisPair,
	mosaicPair,
	radarPair,
	risePair,
	shutterPair,
	slatsPair,
	sweepPair,
} from './shapes';
import { renderObturator } from './obturator';
import type { WindowRevealDef, WindowRevealLayer } from './types';

type RegistryListener = () => void;

export const WINDOW_REVEAL_NONE = 'none';

export const DEFAULT_REVEAL_DURATION_MS = 460;

export const DEFAULT_REVEAL_EASING = 'cubic-bezier( 0.33, 0, 0.2, 1 )';

export const MIN_REVEAL_DURATION_MS = 80;

export const MAX_REVEAL_DURATION_MS = 4000;

export const DEFAULT_REVEAL_EDGE_LAG_MS = 70;

export const MAX_REVEAL_EDGE_LAG_MS = 600;

interface WindowRevealRegistryStore {
	registry: Map< string, WindowRevealDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< WindowRevealRegistryStore >(
	'desktop-mode/window-reveal-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_REVEAL_ID = /^[a-z0-9_/-]+$/;

function shapeFunction( value: string ): string {
	const match = /^\s*([a-zA-Z-]+)\s*\(/.exec( value );
	return match ? match[ 1 ].toLowerCase() : '';
}

export function clampRevealDuration( duration: number | undefined ): number {
	if ( typeof duration !== 'number' || ! Number.isFinite( duration ) ) {
		return DEFAULT_REVEAL_DURATION_MS;
	}
	return Math.min(
		MAX_REVEAL_DURATION_MS,
		Math.max( MIN_REVEAL_DURATION_MS, duration ),
	);
}

export const REVEAL_DURATION_AUTO = 0;

export function clampRevealDurationOverride( value: number | undefined ): number {
	if ( typeof value !== 'number' || ! Number.isFinite( value ) || value <= 0 ) {
		return REVEAL_DURATION_AUTO;
	}
	return Math.min(
		MAX_REVEAL_DURATION_MS,
		Math.max( MIN_REVEAL_DURATION_MS, value ),
	);
}

export function clampRevealEdgeLag( lag: number | undefined ): number {
	if ( typeof lag !== 'number' || ! Number.isFinite( lag ) ) {
		return DEFAULT_REVEAL_EDGE_LAG_MS;
	}
	return Math.min( MAX_REVEAL_EDGE_LAG_MS, Math.max( 0, lag ) );
}

export function revealLayerPairs( def: WindowRevealDef ): WindowRevealLayer[] {
	if ( typeof def.render === 'function' ) {
		return [];
	}
	if ( Array.isArray( def.layers ) && def.layers.length > 0 ) {
		return def.layers;
	}
	if ( typeof def.from === 'string' && typeof def.to === 'string' ) {
		return [ { from: def.from, to: def.to } ];
	}
	return [];
}

function pairErrors( pair: Partial< WindowRevealLayer >, label: string ): string[] {
	const errors: string[] = [];
	const fromOk = typeof pair.from === 'string' && pair.from.trim() !== '';
	const toOk = typeof pair.to === 'string' && pair.to.trim() !== '';
	if ( ! fromOk ) {
		errors.push( `${ label }.from (missing — the clip-path covering the window)` );
	}
	if ( ! toOk ) {
		errors.push( `${ label }.to (missing — the clip-path uncovering the window)` );
	}
	if ( fromOk && toOk ) {
		const a = shapeFunction( pair.from as string );
		const b = shapeFunction( pair.to as string );
		if ( a === '' || b === '' ) {
			errors.push(
				`${ label }.from|to (must be shape functions, e.g. \`inset( … )\` or \`polygon( … )\` — bare keywords like \`none\` cannot be animated)`,
			);
		} else if ( a !== b ) {
			errors.push(
				`${ label }.from|to (must use the same shape function to interpolate — got \`${ a }()\` and \`${ b }()\`)`,
			);
		}
	}
	return errors;
}

function isParseableEasing( easing: string ): boolean {
	if ( typeof KeyframeEffect !== 'function' ) {
		return true;
	}
	try {
		void new KeyframeEffect( null, null, { easing } );
		return true;
	} catch {
		return false;
	}
}

export function registerWindowReveal( def: WindowRevealDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_REVEAL_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_REVEAL_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		} else if ( def.id.trim().toLowerCase() === WINDOW_REVEAL_NONE ) {
			errors.push( 'id ("none" is reserved)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		const hasRender = def.render !== undefined;
		const hasLayers = Array.isArray( def.layers );
		const hasPair = def.from !== undefined || def.to !== undefined;
		if ( hasRender && typeof def.render !== 'function' ) {
			errors.push( 'render (not a function)' );
		} else if ( hasRender && ( hasLayers || hasPair ) ) {
			errors.push(
				'render|layers|from|to (supply exactly one of: a from/to pair, a layers array, or a render function)',
			);
		} else if ( hasRender ) {

		} else if ( hasLayers && hasPair ) {
			errors.push(
				'layers|from|to (supply EITHER a single from/to pair OR a layers array, not both)',
			);
		} else if ( hasLayers ) {
			if ( def.layers!.length === 0 ) {
				errors.push( 'layers (empty — supply at least one matched pair)' );
			}
			def.layers!.forEach( ( layer, i ) => {
				if ( ! layer || typeof layer !== 'object' ) {
					errors.push( `layers[ ${ i } ] (not an object)` );
					return;
				}
				errors.push( ...pairErrors( layer, `layers[ ${ i } ]` ) );
			} );
		} else {
			errors.push(
				...pairErrors( def, '' ).map( ( e ) => e.replace( /^\./, '' ) ),
			);
		}
		if ( def.easing !== undefined ) {
			if ( typeof def.easing !== 'string' || def.easing.trim() === '' ) {
				errors.push( 'easing (not a non-empty string)' );
			} else if ( ! isParseableEasing( def.easing ) ) {
				errors.push(
					'easing (not an easing the browser can parse — `Element.animate()` would throw at play time, with the covering surface already over the window)',
				);
			}
		}
	}

	throwOnRegistrationErrors( 'WindowReveal', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterWindowReveal( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterWindowRevealsByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, def ] of Array.from( registry.entries() ) ) {
		if ( def.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

export function listWindowReveals(): WindowRevealDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< WindowRevealDef[] >(
		HOOKS.WINDOW_REVEALS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.window-reveals` filter ' +
					'returned a non-array; falling back to registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

export function getWindowReveal( id: string ): WindowRevealDef | undefined {
	return listWindowReveals().find( ( r ) => r.id === id );
}

export function hasWindowReveal( id: string ): boolean {
	return registry.has( id );
}

export function subscribeWindowReveals( cb: RegistryListener ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] window-reveal registry listener threw:',
					err,
				);
			}
		}
	}
}

registerWindowReveal( {
	id: 'sweep',
	label: __( 'Sweep' ),
	description: __(
		'A straight edge travels across the window, uncovering the page behind it.',
	),
	...sweepPair(),
	duration: 420,
} );

registerWindowReveal( {
	id: 'iris',
	label: __( 'Iris' ),
	description: __(
		'The page opens out from the centre of the window, like a camera shutter.',
	),
	...irisPair(),
	duration: 520,
} );

registerWindowReveal( {
	id: 'curtain',
	label: __( 'Curtain' ),
	description: __(
		'Two panels part from the middle of the window and slide off the sides.',
	),
	...curtainPair(),
	duration: 480,
} );

registerWindowReveal( {
	id: 'blinds',
	label: __( 'Blinds' ),
	description: __(
		'Six horizontal slats retract at once, letting the page through between them.',
	),
	...blindsPair(),
	duration: 560,
} );

registerWindowReveal( {
	id: 'diagonal',
	label: __( 'Diagonal' ),
	description: __(
		'A slanted edge sweeps off the trailing corner of the window.',
	),
	...diagonalPair(),
	duration: 460,
} );

registerWindowReveal( {
	id: 'rise',
	label: __( 'Rise' ),
	description: __(
		'The page rises into the window from the bottom edge upward.',
	),
	...risePair(),
	duration: 440,
} );

registerWindowReveal( {
	id: 'shutter',
	label: __( 'Shutter' ),
	description: __(
		'Two panels part from the middle of the window and slide off the top and bottom.',
	),
	...shutterPair(),
	duration: 480,
} );

registerWindowReveal( {
	id: 'slats',
	label: __( 'Slats' ),
	description: __(
		'Eight vertical slats retract at once, letting the page through between them.',
	),
	...slatsPair(),
	duration: 560,
} );

registerWindowReveal( {
	id: 'diamond',
	label: __( 'Diamond' ),
	description: __(
		'The page opens out from the centre of the window through a growing rhombus.',
	),
	...diamondPair(),
	duration: 520,
} );

registerWindowReveal( {
	id: 'mosaic',
	label: __( 'Mosaic' ),
	description: __(
		'The page arrives as a grid of tiles, each opening out from its own centre.',
	),
	...mosaicPair(),
	duration: 600,
} );

registerWindowReveal( {
	id: 'obturator',
	label: __( 'Camera shutter' ),
	description: __(
		'Six wedges slide aside in unison, opening a hexagonal aperture from the centre like the iris of a camera lens.',
	),

	render: renderObturator,
	duration: 720,

	edgeLag: 0,
} );

registerWindowReveal( {
	id: 'radar',
	label: __( 'Radar' ),
	description: __(
		'A spoke sweeps a full turn around the centre of the window, uncovering the page behind it.',
	),
	...radarPair(),
	duration: 760,
} );
