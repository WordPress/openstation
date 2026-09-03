/**
 * Plugins app — the mutations every surface shares.
 *
 * Part of the `desktop-mode-plugins` client view. The Installed table,
 * the gallery cards, the detail flyout and the upload dialog all
 * activate, deactivate, delete and install plugins; the legacy window
 * carried a copy of each flow per surface. One copy here: activate /
 * deactivate / delete are app actions (a dispatch — the server runs
 * Core's REST controller, toasts, refreshes the dock and returns the
 * fresh list), install rides Core's `wp_ajax_install_plugin` and then
 * re-reads `data()`. The one thing only the client can do — leave for
 * the classic admin once OpenStation deactivated or deleted ITSELF —
 * happens here after the dispatch lands.
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import { decodeEntities } from './card';
import { describeError, isActiveStatus, type InstalledPlugin, type PluginsHost } from './types';

/**
 * True when the mutation just took OpenStation down: the row is our
 * own plugin and it is no longer active (deactivated) or no longer
 * there (deleted). The shell is now running on a dead plugin, so the
 * only useful next step is the classic admin.
 */
export function selfGone( host: PluginsHost, plugin: string ): boolean {
	if ( ! host.rest.isOpenStationSelf( plugin ) ) {
		return false;
	}
	const row = host.installed.find( ( r ) => r.plugin === plugin );
	return ! row || ! isActiveStatus( row.status );
}

/** Toast, then leave for the classic Dashboard. */
export function leaveAfterSelfMutation( host: PluginsHost, deleted: boolean ): void {
	host.toast(
		deleted
			? __( 'OpenStation deleted. Reloading…', 'desktop-mode' )
			: __( 'OpenStation deactivated. Reloading…', 'desktop-mode' ),
		2000,
	);
	host.rest.reloadOutOfOpenStation();
}

/** Activate one plugin. Resolves true once the fresh list landed. */
export async function activatePlugin( host: PluginsHost, row: InstalledPlugin ): Promise< boolean > {
	const ok = await host.dispatch( 'activate', { plugin: row.plugin } );
	if ( ok ) {
		host.broadcastChange( { plugin: row.plugin, action: 'activate' } );
	}
	return ok;
}

/** Deactivate one plugin; a self-deactivate leaves for the classic admin. */
export async function deactivatePlugin( host: PluginsHost, row: InstalledPlugin ): Promise< boolean > {
	const ok = await host.dispatch( 'deactivate', { plugin: row.plugin } );
	if ( ! ok ) {
		return false;
	}
	if ( selfGone( host, row.plugin ) ) {
		leaveAfterSelfMutation( host, false );
		return true;
	}
	host.broadcastChange( { plugin: row.plugin, action: 'deactivate' } );
	return true;
}

/** Confirm, then delete one plugin (must be inactive — the server refuses otherwise). */
export async function deletePlugin( host: PluginsHost, row: InstalledPlugin ): Promise< boolean > {
	const ok = await host.dispatch(
		'delete',
		{ plugin: row.plugin },
		{
			confirm: {
				title: __( 'Delete plugin?', 'desktop-mode' ),
				message: sprintf(
					/* translators: %s: plugin name */
					__( 'Permanently delete %s? Its files will be removed from disk. This cannot be undone.', 'desktop-mode' ),
					row.name || row.plugin,
				),
				label: __( 'Delete', 'desktop-mode' ),
				danger: true,
			},
		},
	);
	if ( ! ok ) {
		return false;
	}
	if ( selfGone( host, row.plugin ) ) {
		leaveAfterSelfMutation( host, true );
		return true;
	}
	host.broadcastChange( { plugin: row.plugin, action: 'delete' } );
	return true;
}

/**
 * Install a wp.org plugin by slug through Core's own handler, then
 * re-read the list — that is what flips a card's CTA from Install to
 * Activate. The dock refresh (a hidden admin page load) is fired in
 * the background so it never gates the CTA flip.
 */
export async function installBySlug( host: PluginsHost, slug: string, name: string ): Promise< boolean > {
	try {
		await host.rest.installPluginBySlug( slug );
	} catch ( err ) {
		host.toast(
			sprintf(
				/* translators: %s: error message */
				__( 'Install failed: %s', 'desktop-mode' ),
				describeError( err ),
			),
			6000,
		);
		return false;
	}
	await host.refresh();
	host.toast(
		sprintf(
			/* translators: %s: plugin name */
			__( 'Installed %s.', 'desktop-mode' ),
			decodeEntities( name ),
		),
	);
	host.broadcastChange( { plugin: slug, action: 'install' } );
	void host.rest.refreshFrameworkMenu();
	return true;
}
