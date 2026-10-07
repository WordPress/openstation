import { throwOnRegistrationErrors } from '../../registration-errors';
import { createSharedStore } from '../../shared-store';

import type { Window as DesktopWindow } from '../../window';
import type { WindowState } from '../../types';

export interface ChromeRenderState {
	title: string;
	icon: string;
	focused: boolean;
	state: WindowState;
}

export interface ChromeRenderContext {

	window: DesktopWindow;

	state: ChromeRenderState;
}

export interface ChromeRenderHandle {

	update?: ( state: ChromeRenderState ) => void;

	destroy: () => void;
}

export interface WindowChromeDef {

	id: string;

	label?: string;

	match: ( window: DesktopWindow ) => boolean;

	render: ( host: HTMLElement, ctx: ChromeRenderContext ) => ChromeRenderHandle;

	owner?: string;
}

interface RegistryStore {
	registry: Map< string, WindowChromeDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/window-chrome-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_CHROME_ID = /^[a-z0-9_/-]+$/;

export function registerWindowChrome( def: WindowChromeDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_CHROME_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_CHROME_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if ( typeof def.render !== 'function' ) {
			errors.push( 'render (must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowChrome', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterWindowChrome( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterWindowChromesByOwner( owner: string ): number {
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

export function listWindowChromes(): WindowChromeDef[] {
	return Array.from( registry.values() ).sort( ( a, b ) =>
		a.id.localeCompare( b.id ),
	);
}

export function getWindowChrome( id: string ): WindowChromeDef | null {
	return registry.get( id.toLowerCase() ) ?? null;
}

export function subscribeWindowChromes( cb: () => void ): () => void {
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
					'[openstation] window-chrome registry listener threw:',
					err,
				);
			}
		}
	}
}

export function _resetWindowChromeRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
