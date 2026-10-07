import { __, sprintf } from '@openstation/app';
import { activatePlugin, askBeforeSelfDeactivate, deactivatePlugin, deletePlugin, leaveAfterSelfMutation, selfGone } from './mutations';
import { enqueueUpdateJob } from './update-queue';
import {
	describeError,
	isActiveStatus,
	type BusyState,
	type InstalledPlugin,
	type PluginsHost,
	type PluginStatus,
} from './types';

export const freshBusy = (): BusyState => ( {
	updating: new Set(),
	autoUpdating: new Set(),
	optimistic: new Map(),
} );

function button( label: string, variant: string, size = 'small' ): HTMLElement {
	const b = document.createElement( 'os-button' );
	b.setAttribute( 'variant', variant );
	if ( size ) {
		b.setAttribute( 'size', size );
	}
	b.textContent = label;
	return b;
}

export function setBusy( btn: HTMLElement | null, label?: string ): () => void {
	if ( ! btn ) {
		return () => undefined;
	}
	const original = btn.textContent ?? '';
	btn.setAttribute( 'busy', '' );
	btn.setAttribute( 'disabled', '' );
	btn.setAttribute( 'aria-busy', 'true' );
	if ( label !== undefined ) {
		btn.textContent = label;
	}
	return () => {
		btn.removeAttribute( 'busy' );
		btn.removeAttribute( 'disabled' );
		btn.removeAttribute( 'aria-busy' );
		btn.textContent = original;
	};
}

function canManage( row: InstalledPlugin ): { activate: boolean; deactivate: boolean; delete: boolean } {
	return (
		row.openstation_can_manage ?? {
			activate: row.status === 'inactive',
			deactivate: isActiveStatus( row.status ),
			delete: row.status === 'inactive',
		}
	);
}

export function pluginActionButtons(
	host: PluginsHost,
	row: InstalledPlugin,
	opts: { size?: string; onDone?: ( ok: boolean, verb: 'update' | 'activate' | 'deactivate' | 'delete' ) => void } = {},
): HTMLElement[] {
	const size = opts.size ?? 'small';
	const done = ( verb: 'update' | 'activate' | 'deactivate' | 'delete' ) => ( ok: boolean | void ): void =>
		opts.onDone?.( ok !== false, verb );
	const out: HTMLElement[] = [];
	const can = canManage( row );
	const update = row.openstation_update_available;
	if ( host.extra.caps.update && update?.available ) {
		if ( update.package ) {
			const updating = host.busy.updating.has( row.plugin );
			const btn = button(
				updating
					? __( 'Updating…', 'desktop-mode' )
					: __( 'Update', 'desktop-mode' ),
				'primary',
				size,
			);
			if ( updating ) {
				btn.setAttribute( 'disabled', '' );
				btn.setAttribute( 'aria-busy', 'true' );
			}
			btn.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				void runUpdate( host, row ).then( done( 'update' ) );
			} );
			out.push( btn );
		} else {
			const hint = document.createElement( 'span' );
			hint.className = 'os-plugins__update-hint';
			hint.textContent = __( 'Auto-update unavailable', 'desktop-mode' );
			hint.title = __(
				'This plugin does not ship a wp.org download package. Update it manually from its source.',
				'desktop-mode',
			);
			out.push( hint );
		}
	}
	if ( host.extra.caps.activate && can.activate ) {
		const btn = button( __( 'Activate', 'desktop-mode' ), 'primary', size );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void runOptimistic( host, row, 'active', () => activatePlugin( host, row ) ).then( done( 'activate' ) );
		} );
		out.push( btn );
	} else if ( host.extra.caps.activate && can.deactivate ) {
		const btn = button( __( 'Deactivate', 'desktop-mode' ), 'secondary', size );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void runOptimistic( host, row, 'inactive', () => deactivatePlugin( host, row ) ).then( done( 'deactivate' ) );
		} );
		out.push( btn );
	}
	if ( host.extra.caps.delete && can.delete ) {
		const btn = button( __( 'Delete', 'desktop-mode' ), 'danger', size );
		btn.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			void deletePlugin( host, row ).then( done( 'delete' ) );
		} );
		out.push( btn );
	}
	return out;
}

async function runOptimistic(
	host: PluginsHost,
	row: InstalledPlugin,
	next: PluginStatus,
	run: () => Promise< boolean >,
): Promise< boolean > {
	host.busy.optimistic.set( row.plugin, next );
	host.repaint();
	try {
		return await run();
	} finally {
		host.busy.optimistic.delete( row.plugin );
		host.repaint();
	}
}

async function updateAndRefresh( host: PluginsHost, row: InstalledPlugin ) {
	return enqueueUpdateJob( async () => {
		try {
			return await host.rest.updateInstalledPlugin( row );
		} finally {
			await host.refresh();
		}
	} );
}

async function runUpdate( host: PluginsHost, row: InstalledPlugin ): Promise< boolean > {
	if ( host.busy.updating.has( row.plugin ) ) {
		return false;
	}
	host.busy.updating.add( row.plugin );
	host.repaint();
	let ok = false;
	try {
		const result = await updateAndRefresh( host, row );
		host.toast(
			sprintf(

				__( '%1$s updated to %2$s.', 'desktop-mode' ),
				row.name || row.plugin,
				result.newVersion,
			),
		);
		host.broadcastChange( { plugin: row.plugin, action: 'update' } );
		ok = true;
	} catch ( err ) {
		if ( isUpToDateError( err ) ) {
			host.toast(
				sprintf(

					__( '%s is already up to date.', 'desktop-mode' ),
					row.name || row.plugin,
				),
			);
			host.broadcastChange( { plugin: row.plugin, action: 'update' } );
			ok = true;
		} else {
			host.toast(
				sprintf(

					__( 'Update of %1$s failed: %2$s', 'desktop-mode' ),
					row.name || row.plugin,
					describeError( err ),
				),
				6000,
			);
		}
	} finally {
		host.busy.updating.delete( row.plugin );

		host.repaint();
		host.refreshMenu();
	}
	return ok;
}

export function isUpToDateError( err: unknown ): boolean {
	const code = ( err as { code?: string } )?.code;
	if ( code === 'up_to_date' ) {
		return true;
	}
	const message = ( err as { message?: string } )?.message;
	const coreMessage = window.wp?.i18n?.__?.( 'The plugin is at the latest version.' );
	return !! coreMessage && message === coreMessage;
}

export async function runToggleAutoUpdate( host: PluginsHost, row: InstalledPlugin ): Promise< void > {
	const meta = row.openstation_auto_update;
	if ( host.busy.autoUpdating.has( row.plugin ) || ! meta || meta.forced !== null || ! meta.supported ) {
		return;
	}
	const wasEnabled = meta.enabled;
	host.busy.autoUpdating.add( row.plugin );
	host.repaint();
	try {
		await host.rest.toggleAutoUpdate( row, wasEnabled ? 'disable' : 'enable' );
		host.toast(
			sprintf(
				wasEnabled
					? __( 'Auto-updates disabled for %s.', 'desktop-mode' )
					: __( 'Auto-updates enabled for %s.', 'desktop-mode' ),
				row.name || row.plugin,
			),
		);
		host.broadcastChange( { plugin: row.plugin, action: 'auto-update' } );
		await host.refresh();
	} catch ( err ) {
		host.toast(
			sprintf(

				__( 'Could not toggle auto-updates for %1$s: %2$s', 'desktop-mode' ),
				row.name || row.plugin,
				describeError( err ),
			),
			6000,
		);
	} finally {
		host.busy.autoUpdating.delete( row.plugin );
		host.repaint();
	}
}

export interface BulkButton {
	label: string;
	variant: 'primary' | 'secondary' | 'danger';
	run: () => void;
}

export function bulkButtons( host: PluginsHost, selectedIds: string[], clear: () => void ): BulkButton[] {
	const { caps } = host.extra;
	const selected = host.installed.filter( ( r ) => selectedIds.includes( r.plugin ) );
	const out: BulkButton[] = [];
	if ( caps.update ) {
		const updatable = selected.filter(
			( r ) => !! r.openstation_update_available?.available && !! r.openstation_update_available.package,
		);
		if ( updatable.length > 0 ) {
			out.push( {
				label: sprintf(

					__( 'Update %d', 'desktop-mode' ),
					updatable.length,
				),
				variant: 'primary',
				run: () => void runBulkUpdate( host, updatable ).then( clear ),
			} );
		}
	}
	if ( caps.activate ) {
		const activatable = selected.filter( ( r ) => r.status === 'inactive' && canManage( r ).activate );
		if ( activatable.length > 0 ) {
			out.push( {
				label: __( 'Activate', 'desktop-mode' ),
				variant: 'primary',
				run: () => void runBulk( host, activatable, 'activate' ).then( clear ),
			} );
		}
		const deactivatable = selected.filter( ( r ) => isActiveStatus( r.status ) && canManage( r ).deactivate );
		if ( deactivatable.length > 0 ) {
			out.push( {
				label: __( 'Deactivate', 'desktop-mode' ),
				variant: 'secondary',
				run: () => void runBulk( host, deactivatable, 'deactivate' ).then( clear ),
			} );
		}
	}
	if ( caps.delete ) {
		const deletable = selected.filter( ( r ) => r.status === 'inactive' && canManage( r ).delete );
		if ( deletable.length > 0 ) {
			out.push( {
				label: __( 'Delete', 'desktop-mode' ),
				variant: 'danger',
				run: () => void runBulk( host, deletable, 'delete' ).then( clear ),
			} );
		}
	}
	return out;
}

async function runBulk( host: PluginsHost, rows: InstalledPlugin[], verb: 'activate' | 'deactivate' | 'delete' ): Promise< void > {
	const plugins = rows.map( ( r ) => r.plugin );
	if ( verb === 'deactivate' ) {
		await askBeforeSelfDeactivate( host, plugins );
	}
	const ok = await host.dispatch(
		'bulk',
		{ plugins, do: verb },
		verb === 'delete'
			? {
				confirm: {
					title: __( 'Delete selected plugins?', 'desktop-mode' ),
					message: sprintf(

						__( 'Permanently delete %d plugin(s)? Their files will be removed from disk. This cannot be undone.', 'desktop-mode' ),
						rows.length,
					),
					label: __( 'Delete', 'desktop-mode' ),
					danger: true,
				},
			}
			: {},
	);
	if ( ! ok ) {
		return;
	}
	if ( verb !== 'activate' && plugins.some( ( plugin ) => selfGone( host, plugin ) ) ) {
		leaveAfterSelfMutation( host, verb === 'delete' );
		return;
	}
	host.broadcastChange( { action: 'bulk' }, plugins );
}

async function runBulkUpdate( host: PluginsHost, rows: InstalledPlugin[] ): Promise< void > {
	let succeeded = 0;
	let failed = 0;
	for ( const row of rows ) {
		host.busy.updating.add( row.plugin );
		host.repaint();
		try {
			await updateAndRefresh( host, row );
			succeeded++;
		} catch {
			failed++;
		} finally {
			host.busy.updating.delete( row.plugin );
			host.repaint();
		}
	}
	if ( succeeded > 0 ) {
		host.broadcastChange( { action: 'bulk' }, rows.map( ( r ) => r.plugin ) );
	}
	host.refreshMenu();
	const noun = __( 'updated', 'desktop-mode' );
	host.toast(
		failed === 0
			? sprintf(

				__( '%1$d plugin(s) %2$s.', 'desktop-mode' ),
				succeeded,
				noun,
			)
			: sprintf(

				__( '%1$d %3$s, %2$d failed.', 'desktop-mode' ),
				succeeded,
				failed,
				noun,
			),
		5000,
	);
}
