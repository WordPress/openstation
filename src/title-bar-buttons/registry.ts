import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';

import type { Window as DesktopWindow } from '../window';

export interface TitleBarButtonRenderCtx {

	window: DesktopWindow;
}

export interface TitleBarButtonDef {

	id: string;

	label: string;

	icon: string;

	placement?: 'left' | 'right';

	order?: number;

	match: ( window: DesktopWindow ) => boolean;

	onClick?: ( window: DesktopWindow, ev: MouseEvent ) => void;

	render?: ( host: HTMLElement, window: DesktopWindow ) => void;

	owner?: string;
}

interface RegistryStore {
	registry: Map< string, TitleBarButtonDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/title-bar-buttons-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const TITLE_BAR_BUTTON_ID = /^[a-z0-9_/-]+$/;

export function registerTitleBarButton( def: TitleBarButtonDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! TITLE_BAR_BUTTON_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ TITLE_BAR_BUTTON_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if ( typeof def.icon !== 'string' || def.icon.trim() === '' ) {
			errors.push( 'icon (missing)' );
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if (
			typeof def.onClick !== 'function' &&
			typeof def.render !== 'function'
		) {
			errors.push( 'onClick|render (at least one must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'TitleBarButton', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterTitleBarButton( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterTitleBarButtonsByOwner( owner: string ): number {
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

export function listTitleBarButtons(): TitleBarButtonDef[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.order ?? 100 ) - ( b.order ?? 100 ),
	);
}

export function buttonsForWindow(
	win: DesktopWindow,
): { left: TitleBarButtonDef[]; right: TitleBarButtonDef[] } {
	const left: TitleBarButtonDef[] = [];
	const right: TitleBarButtonDef[] = [];
	for ( const def of listTitleBarButtons() ) {
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch {
			continue;
		}
		if ( def.placement === 'right' ) {
			right.push( def );
		} else {
			left.push( def );
		}
	}
	return { left, right };
}

export function subscribeTitleBarButtons( cb: () => void ): () => void {
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
					'[openstation] title-bar-button registry listener threw:',
					err,
				);
			}
		}
	}
}

if ( typeof document !== 'undefined' ) {
	document.addEventListener( 'os-settings-save-lifecycle', ( e: Event ) => {
		const detail = ( e as CustomEvent ).detail;
		if ( detail && detail.phase === 'saved' ) {
			notify();
		}
	} );
}
