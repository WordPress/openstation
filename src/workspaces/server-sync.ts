import { addFilter, removeFilter, HOOKS } from '../hooks';
import {
	listWorkspacePresets,
	registerWorkspacePreset,
	unregisterWorkspacePreset,
} from './presets';
import type { WorkspacePreset } from './types';
import { WORKSPACE_LAYOUTS } from './types';
import { captureWorkspaceAppearance } from './visibility';

export interface WorkspacePresetServerEntry {
	id: string;
	label?: string;
	description?: string;
	icon?: string;
	color?: string;
	apps?: string[];
	widgets?: string[];
	appearance?: Record< string, unknown >;
	windows?: Array< { match: string; url?: string; title?: string } >;
	layout?: string;
	order?: number;
}

const FILTER_NAMESPACE = 'desktop-mode/workspace-presets';

let serverIds: Set< string > | null = null;

const ownRegistrations = new Set< string >();

function toPreset( entry: WorkspacePresetServerEntry ): WorkspacePreset {
	const layout = WORKSPACE_LAYOUTS.includes(
		entry.layout as ( typeof WORKSPACE_LAYOUTS )[ number ],
	)
		? ( entry.layout as WorkspacePreset[ 'layout' ] )
		: 'free';
	return {
		id: entry.id,
		label: entry.label || entry.id,
		description: entry.description || '',
		icon: entry.icon || 'dashicons-desktop',
		color: entry.color || '',
		apps: Array.isArray( entry.apps ) ? entry.apps.slice() : [],
		widgets: Array.isArray( entry.widgets ) ? entry.widgets.slice() : [],

		appearance: captureWorkspaceAppearance( entry.appearance ?? {} ),
		windows: Array.isArray( entry.windows )
			? entry.windows.map( ( w ) => ( { ...w } ) )
			: [],
		layout,
		order: 'number' === typeof entry.order ? entry.order : 0,
	};
}

export function applyServerWorkspacePresets(
	entries: WorkspacePresetServerEntry[] | undefined,
): void {
	if ( ! Array.isArray( entries ) ) {
		return;
	}
	const ids = new Set( entries.map( ( e ) => e.id ).filter( Boolean ) );

	const builtIns = new Set(
		listWorkspacePresets()
			.filter( ( p ) => ! ownRegistrations.has( p.id ) )
			.map( ( p ) => p.id ),
	);

	for ( const entry of entries ) {
		if ( ! entry?.id || builtIns.has( entry.id ) ) {
			continue;
		}
		registerWorkspacePreset( toPreset( entry ) );
		ownRegistrations.add( entry.id );
	}

	for ( const id of [ ...ownRegistrations ] ) {
		if ( ! ids.has( id ) ) {
			unregisterWorkspacePreset( id );
			ownRegistrations.delete( id );
		}
	}

	serverIds = ids;
}

export function installWorkspacePresetSync(): () => void {
	addFilter< WorkspacePreset[] >(
		HOOKS.WORKSPACE_PRESETS,
		FILTER_NAMESPACE,
		( presets ) => {
			if ( ! serverIds ) {
				return presets;
			}
			return presets.filter(
				( preset ) =>
					ownRegistrations.has( preset.id ) ||
					serverIds?.has( preset.id ),
			);
		},
	);
	return () => {
		removeFilter( HOOKS.WORKSPACE_PRESETS, FILTER_NAMESPACE );
		serverIds = null;
		for ( const id of ownRegistrations ) {
			unregisterWorkspacePreset( id );
		}
		ownRegistrations.clear();
	};
}
