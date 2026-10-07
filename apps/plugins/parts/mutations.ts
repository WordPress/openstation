import { __, sprintf } from '@openstation/app';
import { decodeHTML } from '../../../src/utils';
import { leaveForClassicAdmin } from '../../../src/exit-openstation';
import type { DeactivationFeedbackApi } from '../../../src/deactivation-feedback';
import { describeError, isActiveStatus, type InstalledPlugin, type PluginsHost } from './types';

declare global {
	interface Window {

		openStationDeactivationFeedback?: DeactivationFeedbackApi;
	}
}

export function selfGone( host: PluginsHost, plugin: string ): boolean {
	if ( ! host.rest.isOpenStationSelf( plugin ) ) {
		return false;
	}
	const row = host.installed.find( ( r ) => r.plugin === plugin );
	return ! row || ! isActiveStatus( row.status );
}

export function leaveAfterSelfMutation( host: PluginsHost, deleted: boolean ): void {
	host.toast(
		deleted
			? __( 'OpenStation deleted. Reloading…', 'desktop-mode' )
			: __( 'OpenStation deactivated. Reloading…', 'desktop-mode' ),
		2000,
	);
	leaveForClassicAdmin( host.extra.adminUrl ?? '' );
}

export async function askBeforeSelfDeactivate( host: PluginsHost, plugins: string[] ): Promise< void > {
	if ( ! plugins.some( ( plugin ) => host.rest.isOpenStationSelf( plugin ) ) ) {
		return;
	}
	const cfg = host.extra.deactivationFeedback;
	if ( ! cfg ) {
		return;
	}
	try {
		const os = window.wp?.os;
		let api = os?.deactivationFeedback ?? window.openStationDeactivationFeedback;
		if ( ! api && cfg.script.url && typeof os?.loadVendorScript === 'function' ) {
			await os.loadVendorScript( cfg.script.url, {
				handle: 'os-deactivation-feedback',
				translations: cfg.script.translations,
			} );
			api = os.deactivationFeedback ?? window.openStationDeactivationFeedback;
		}
		if ( ! api ) {
			return;
		}
		await api.ask( {
			plugin: host.extra.selfPluginFile + '.php',
			restUrl: cfg.restUrl,

			restNonce: '',
			context: 'app',
			styleUrl: cfg.styleUrl,
		} );
	} catch {

	}
}

export async function activatePlugin( host: PluginsHost, row: InstalledPlugin ): Promise< boolean > {
	const ok = await host.dispatch( 'activate', { plugin: row.plugin } );
	if ( ok ) {
		host.broadcastChange( { plugin: row.plugin, action: 'activate' } );
	}
	return ok;
}

export async function deactivatePlugin( host: PluginsHost, row: InstalledPlugin ): Promise< boolean > {
	await askBeforeSelfDeactivate( host, [ row.plugin ] );
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

export async function deletePlugin( host: PluginsHost, row: InstalledPlugin ): Promise< boolean > {
	const ok = await host.dispatch(
		'delete',
		{ plugin: row.plugin },
		{
			confirm: {
				title: __( 'Delete plugin?', 'desktop-mode' ),
				message: sprintf(

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

export async function installBySlug( host: PluginsHost, slug: string, name: string ): Promise< boolean > {
	try {
		await host.rest.installPluginBySlug( slug );
	} catch ( err ) {
		host.toast(
			sprintf(

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

			__( 'Installed %s.', 'desktop-mode' ),
			decodeHTML( name ),
		),
	);
	host.broadcastChange( { plugin: slug, action: 'install' } );
	host.refreshMenu();
	return true;
}
