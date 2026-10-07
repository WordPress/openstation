import { createSharedStore } from '../shared-store';
import type { OsSettingsState } from './types';

export type OsSettingsSnapshot = OsSettingsState;

export interface SettingsTabRenderCtx {

	isAdmin: boolean;

	getOsSettings(): OsSettingsSnapshot;

	subscribeOsSettings( cb: ( snapshot: OsSettingsSnapshot ) => void ): () => void;
}

export interface DesktopSettingsTab {

	id: string;

	label: string;

	capability?: string;

	order?: number;

	icon?: string;

	owner?: string;

	render( body: HTMLElement, ctx: SettingsTabRenderCtx ): void;
}

interface SettingsTabRegistryStore {
	registry: Map< string, DesktopSettingsTab >;
	listeners: Set< () => void >;
}
const store = createSharedStore< SettingsTabRegistryStore >(
	'desktop-mode/settings-tab-registry',
	() => ( {
		registry: new Map< string, DesktopSettingsTab >(),
		listeners: new Set<() => void >(),
	} ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

export function registerSettingsTab( tab: DesktopSettingsTab ): void {
	if ( ! tab || typeof tab.id !== 'string' || tab.id.trim() === '' ) {
		return;
	}
	if ( typeof tab.label !== 'string' || tab.label.trim() === '' ) {
		return;
	}
	if ( typeof tab.render !== 'function' ) {
		return;
	}
	const id = tab.id.trim().toLowerCase();
	if ( ! /^[a-z0-9_\-]+$/.test( id ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] registerSettingsTab: id must be [a-z0-9_-]+, got',
				tab.id,
			);
		}
		return;
	}
	registry.set( id, { ...tab, id } );
	notify();
}

export function unregisterSettingsTab( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterSettingsTabsByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, tab ] of Array.from( registry.entries() ) ) {
		if ( tab.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

export function listSettingsTabs(): DesktopSettingsTab[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.order ?? 100 ) - ( b.order ?? 100 ),
	);
}

export function subscribeSettingsTabs( cb: () => void ): () => void {
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
					'[openstation] settings-tab-registry listener threw:',
					err,
				);
			}
		}
	}
}
