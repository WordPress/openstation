import { applyFilters, HOOKS } from '../hooks';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { WindowLinkRendererDef } from './types';

type RegistryListener = () => void;

export const WINDOW_LINK_RENDERER_NONE = 'none';

export const WINDOW_LINK_RENDERER_DEFAULT = 'svg-splines';

interface WindowLinkRendererRegistryStore {
	registry: Map< string, WindowLinkRendererDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< WindowLinkRendererRegistryStore >(
	'desktop-mode/window-link-renderer-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_LINK_RENDERER_ID = /^[a-z0-9_/-]+$/;

export function registerWindowLinkRenderer( def: WindowLinkRendererDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if (
			! WINDOW_LINK_RENDERER_ID.test( def.id.trim().toLowerCase() )
		) {
			errors.push(
				`id (must match ${ WINDOW_LINK_RENDERER_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		} else if (
			def.id.trim().toLowerCase() === WINDOW_LINK_RENDERER_NONE
		) {
			errors.push( 'id ("none" is reserved)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if ( typeof def.mount !== 'function' ) {
			errors.push( 'mount (not a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowLinkRenderer', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterWindowLinkRenderer( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterWindowLinkRenderersByOwner( owner: string ): number {
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

export function listWindowLinkRenderers(): WindowLinkRendererDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< WindowLinkRendererDef[] >(
		HOOKS.WINDOW_LINK_RENDERERS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.window-links.renderers` filter ' +
					'returned a non-array; falling back to registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

export function getWindowLinkRenderer(
	id: string,
): WindowLinkRendererDef | undefined {
	return listWindowLinkRenderers().find( ( r ) => r.id === id );
}

export function subscribeWindowLinkRenderers(
	cb: RegistryListener,
): () => void {
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
					'[openstation] window-link-renderer registry listener threw:',
					err,
				);
			}
		}
	}
}
