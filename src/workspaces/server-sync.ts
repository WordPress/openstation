/**
 * Reconciling the workspace templates with the server's list.
 *
 * Templates are the one registry in the family that carries no script:
 * a preset is metadata plus two token lists, and there is nothing to
 * lazy-load. That makes this the simplest sync module in the shell —
 * one synchronous pass, no `scriptUrl`, no readiness flag.
 *
 * It gives the `openstation_workspace_presets` PHP filter both of its
 * powers:
 *
 * - **Add.** A server entry whose id no client built-in claims is
 *   registered as a template of its own, tokens and all — so a plugin
 *   can ship a complete workspace from PHP with no JavaScript.
 * - **Remove.** A built-in the server list no longer names is filtered
 *   out client-side. That is what makes "drop the Commerce desk on a site
 *   with no store" a one-line filter rather than a JS bundle.
 *
 * The three shipped ids deliberately do NOT re-register from the
 * server: their token lists live on the client, where they are
 * resolved, and a second copy in PHP would be a second place to keep
 * in step. The server entry for a built-in says only "this one still
 * exists".
 */

import { addFilter, removeFilter, HOOKS } from '../hooks';
import {
	listWorkspacePresets,
	registerWorkspacePreset,
	unregisterWorkspacePreset,
} from './presets';
import type { WorkspacePreset } from './types';
import { WORKSPACE_LAYOUTS } from './types';
import { captureWorkspaceAppearance } from './visibility';

/** One `workspacePresets` entry, as PHP serializes it. */
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

/**
 * Ids the server's most recent payload named.
 *
 * `null` until the first sync, and the distinction matters: before the
 * server has spoken, the filter below must not drop anything. A shell
 * booting without the config key (vitest, a stripped payload) keeps
 * every built-in rather than showing an empty switcher.
 */
let serverIds: Set< string > | null = null;

/** Ids this module registered, so a later payload can retire them. */
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
		// Re-filtered client-side against the same allowlist the server
		// enforced. Cheap, and it keeps the sync honest if the two
		// lists ever drift.
		appearance: captureWorkspaceAppearance( entry.appearance ?? {} ),
		windows: Array.isArray( entry.windows )
			? entry.windows.map( ( w ) => ( { ...w } ) )
			: [],
		layout,
		order: 'number' === typeof entry.order ? entry.order : 0,
	};
}

/**
 * Bring the template list in line with a server payload.
 *
 * Safe to call repeatedly — the boot payload and every later menu
 * refresh both land here.
 */
export function applyServerWorkspacePresets(
	entries: WorkspacePresetServerEntry[] | undefined,
): void {
	if ( ! Array.isArray( entries ) ) {
		return;
	}
	const ids = new Set( entries.map( ( e ) => e.id ).filter( Boolean ) );

	// Built-in ids, read BEFORE registering anything from this payload
	// so a server entry cannot be mistaken for the client copy it is
	// standing next to.
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

	// Retire anything we registered that this payload no longer names —
	// the plugin that added it was deactivated.
	for ( const id of [ ...ownRegistrations ] ) {
		if ( ! ids.has( id ) ) {
			unregisterWorkspacePreset( id );
			ownRegistrations.delete( id );
		}
	}

	serverIds = ids;
}

/**
 * Install the filter that lets the server list remove a built-in.
 *
 * Registered once at boot, before the first payload lands, so a
 * `WORKSPACE_PRESETS` read that happens between boot and sync is
 * already going through it.
 */
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
