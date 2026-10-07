import { __, formatBytes, html, sprintf, type TemplateResult } from '@openstation/app';
import '../../../src/ui/components/os-table/os-table';
import '../../../src/ui/components/os-action-menu/os-action-menu';
import type { OsTable, OsTableColumn } from '../../../src/ui/components/os-table/os-table';
import { installedTableStyles } from './installed-table.styles';
import { stripHtml } from './html';
import { adoptStyles } from './styles';
import { isActiveStatus, type InstalledPlugin, type PluginsHost } from './types';

export interface InstalledTableState {
	element: OsTable< InstalledPlugin > | null;
	key: string;
}

export interface InstalledTableOptions {
	root: HTMLElement;
	host: PluginsHost;
	rows: InstalledPlugin[];
	selected: string[];
	onSelection: ( ids: string[] ) => void;
	open: ( row: InstalledPlugin ) => void;
	icon: ( row: InstalledPlugin ) => HTMLElement;
	actions: ( row: InstalledPlugin ) => HTMLElement[];
}

function line( text: string, className = '' ): TemplateResult {
	return html`<span class="os-plugins__table-line ${ className }" title=${ text }>${ text }</span>`;
}

function columns( opts: InstalledTableOptions ): OsTableColumn< InstalledPlugin >[] {
	return [
		{
			key: 'name', label: __( 'Plugin', 'desktop-mode' ),
			render: ( _value, row ) => {
				const name = stripHtml( row.name ) || row.plugin;
				return html`<div class="os-plugins__table-identity">${ opts.icon( row ) }<div class="os-plugins__table-copy">
					<span class="os-plugins__table-line os-plugins__table-title" data-plugin-title title=${ name }>${ name }</span>
					${ line( stripHtml( row.author ?? '' ) || row.plugin, 'os-plugins__table-secondary' ) }
				</div></div>`;
			},
		},
		{
			key: 'status', label: __( 'Status', 'desktop-mode' ), width: '140px',
			render: ( _value, row ) => {
				const active = isActiveStatus( row.status );
				let status = active ? __( 'Active', 'desktop-mode' ) : __( 'Inactive', 'desktop-mode' );
				if ( row.status === 'network-active' ) {
					status = __( 'Network active', 'desktop-mode' );
				}
				if ( opts.host.busy.optimistic.has( row.plugin ) ) {
					status = __( 'Changing…', 'desktop-mode' );
				}
				return html`<div class="os-plugins__table-state" data-active=${ String( active ) }>${ line( status ) }</div>`;
			},
		},
		{
			key: 'version', label: __( 'Version', 'desktop-mode' ), width: '142px',
			render: ( _value, row ) => html`<div class="os-plugins__table-version">${ line( row.version || '—' ) }
				${ row.openstation_update_available?.available ? line(
					sprintf( __( 'Update to %s', 'desktop-mode' ), row.openstation_update_available.new_version || '—' ),
					'os-plugins__table-update',
				) : '' }</div>`,
		},
		{
			key: 'size', label: __( 'Size', 'desktop-mode' ), width: '92px', align: 'end',
			render: ( _value, row ) => line( typeof row.openstation_size_kb === 'number' ? formatBytes( row.openstation_size_kb * 1024 ) : '—', 'os-plugins__table-version' ),
		},
		{
			key: 'actions', label: __( 'Actions', 'desktop-mode' ), width: '186px', align: 'end',
			render: ( _value, row ) => {
				const actions = opts.actions( row ).filter( ( el ) => el.tagName === 'OS-BUTTON' );
				const name = stripHtml( row.name ) || row.plugin;
				return html`<div class="os-plugins__table-actions" data-noclick>${ actions[ 0 ] ?? '' }
					<os-action-menu data-plugin-actions=${ row.plugin } text="⋯" label=${ sprintf( __( 'Actions for %s', 'desktop-mode' ), name ) }
						@os-context-menu-pick=${ ( ev: Event ) => {
							const value = ( ev as CustomEvent< { value: string } > ).detail.value;
							if ( value === 'details' ) {
								opts.open( row );
							} else {
								const action = actions[ Number( value ) ];
								if ( action && ! action.hasAttribute( 'disabled' ) ) {
									action.click();
								}
							}
						} }>
						<os-context-menu-option value="details">${ __( 'Plugin details', 'desktop-mode' ) }</os-context-menu-option>
						${ actions.slice( 1 ).map( ( action, index ) => html`<os-context-menu-option value=${ String( index + 1 ) }
							?disabled=${ action.hasAttribute( 'disabled' ) }>${ action.textContent }</os-context-menu-option>` ) }
					</os-action-menu></div>`;
			},
		},
	];
}

export function syncInstalledTable( state: InstalledTableState, opts: InstalledTableOptions ): void {
	const table = opts.root.querySelector< OsTable< InstalledPlugin > >( '[data-os-plugins-table]' );
	if ( ! table ) {
		state.element = null;
		state.key = '';
		return;
	}
	if ( state.element !== table ) {
		state.element = table;
		state.key = '';
		table.getRowId = ( row ) => row.plugin;
		table.columns = columns( opts );
		table.addEventListener( 'os-table-row-click', ( ev ) => opts.open( ( ev as CustomEvent< { row: InstalledPlugin } > ).detail.row ) );
		table.addEventListener( 'os-table-selection-change', () => opts.onSelection( Array.from( table.selection, String ) ) );
		queueMicrotask( () => {
			if ( table.isConnected && table.shadowRoot ) {
				adoptStyles( table.shadowRoot, 'installed-table', installedTableStyles.cssText );
			}
		} );
	}
	const key = JSON.stringify( [ opts.rows, opts.host.extra.caps, [ ...opts.host.busy.updating ], [ ...opts.host.busy.optimistic ] ] );
	if ( state.key !== key ) {
		state.key = key;
		table.data = opts.rows;
	}
	if ( JSON.stringify( Array.from( table.selection, String ) ) !== JSON.stringify( opts.selected ) ) {
		table.selection = opts.selected;
	}
}
