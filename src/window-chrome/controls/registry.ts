import { throwOnRegistrationErrors } from '../../registration-errors';
import { createSharedStore } from '../../shared-store';

import type { Window as DesktopWindow } from '../../window';

export type WindowControlPlacement = 'left' | 'right' | 'controls';

export interface WindowControlDef {

	id: string;

	label: string;

	icon?: string;

	placement?: WindowControlPlacement;

	order?: number;

	match: ( window: DesktopWindow ) => boolean;

	onClick?: ( window: DesktopWindow, ev: MouseEvent ) => void;

	render?: ( host: HTMLElement, window: DesktopWindow ) => void;

	owner?: string;

	core?: boolean;
}

interface RegistryStore {
	registry: Map< string, WindowControlDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/window-controls-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_CONTROL_ID = /^[a-z0-9_/-]+$/;

export function registerWindowControl( def: WindowControlDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_CONTROL_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_CONTROL_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if (
			typeof def.onClick !== 'function' &&
			typeof def.render !== 'function'
		) {
			errors.push( 'onClick|render (at least one must be a function)' );
		}
		if ( typeof def.render !== 'function' ) {
			if ( typeof def.icon !== 'string' || def.icon.trim() === '' ) {
				errors.push( 'icon (required when render is omitted)' );
			}
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if (
			def.placement !== undefined &&
			def.placement !== 'left' &&
			def.placement !== 'right' &&
			def.placement !== 'controls'
		) {
			errors.push( 'placement (must be "left", "right", or "controls")' );
		}
	}

	throwOnRegistrationErrors( 'WindowControl', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterWindowControl( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterWindowControlsByOwner( owner: string ): number {
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

export function listWindowControls(): WindowControlDef[] {
	return Array.from( registry.values() ).sort( ( a, b ) => {
		const oa = a.order ?? 100;
		const ob = b.order ?? 100;
		if ( oa !== ob ) {
			return oa - ob;
		}
		return a.id.localeCompare( b.id );
	} );
}

export function controlsForWindow(
	win: DesktopWindow,
): {
	left: WindowControlDef[];
	right: WindowControlDef[];
	controls: WindowControlDef[];
} {
	const left: WindowControlDef[] = [];
	const right: WindowControlDef[] = [];
	const controls: WindowControlDef[] = [];
	for ( const def of listWindowControls() ) {
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					`[openstation] window-control "${ def.id }" match() threw — skipping`,
					err,
				);
			}
			continue;
		}
		const placement = def.placement ?? 'left';
		if ( placement === 'right' ) {
			right.push( def );
		} else if ( placement === 'controls' ) {
			controls.push( def );
		} else {
			left.push( def );
		}
	}
	return { left, right, controls };
}

export function subscribeWindowControls( cb: () => void ): () => void {
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
					'[openstation] window-control registry listener threw:',
					err,
				);
			}
		}
	}
}

export function _resetWindowControlRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
