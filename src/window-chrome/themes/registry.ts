import { throwOnRegistrationErrors } from '../../registration-errors';
import { createSharedStore } from '../../shared-store';

import type { Window as DesktopWindow } from '../../window';

export interface WindowThemeDef {

	id: string;

	label?: string;

	tokens: Record< string, string >;

	match: ( window: DesktopWindow ) => boolean;

	priority?: number;

	owner?: string;
}

interface RegistryStore {
	registry: Map< string, WindowThemeDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/window-themes-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_THEME_ID = /^[a-z0-9_/-]+$/;

export function registerWindowTheme( def: WindowThemeDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_THEME_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_THEME_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( ! def.tokens || typeof def.tokens !== 'object' ) {
			errors.push( 'tokens (must be an object of CSS custom-property → value)' );
		} else {
			for ( const key of Object.keys( def.tokens ) ) {
				if ( ! key.startsWith( '--' ) ) {
					errors.push(
						`tokens.${ key } (CSS custom-property keys must start with "--")`,
					);
					break;
				}
			}
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowTheme', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterWindowTheme( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterWindowThemesByOwner( owner: string ): number {
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

export function listWindowThemes(): WindowThemeDef[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.priority ?? 100 ) - ( b.priority ?? 100 ),
	);
}

export function resolveWindowTheme(
	win: DesktopWindow,
): WindowThemeDef | null {
	let winner: WindowThemeDef | null = null;
	for ( const def of listWindowThemes() ) {
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					`[openstation] window-theme "${ def.id }" match() threw — skipping`,
					err,
				);
			}
			continue;
		}
		winner = def;
	}
	return winner;
}

export function subscribeWindowThemes( cb: () => void ): () => void {
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
					'[openstation] window-theme registry listener threw:',
					err,
				);
			}
		}
	}
}

export function _resetWindowThemeRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
