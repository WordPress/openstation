/**
 * `<wpd-role-picker>` — chip multi-select over the site's eligible
 * roles (server-injected via `desktopModeConfig.shareEligibleRoles`).
 *
 * Use:
 *
 * ```html
 * <wpd-role-picker selected="editor,author"></wpd-role-picker>
 * ```
 *
 * Emits `wpd-role-toggle { slug, selected }` whenever a chip is
 * clicked. The parent owns the source of truth — the component
 * just reflects the `selected` CSV attribute.
 *
 * @since 0.18.0
 */

import { Component, defineComponent, html } from '../../core';
import { rolePickerStyles } from './wpd-role-picker.styles';

interface EligibleRole {
	slug: string;
	name: string;
}

export class WpdRolePicker extends Component {
	static props = [ 'selected', 'roles' ] as const;
	static styles = [ rolePickerStyles ];

	static help = {
		title: 'Role picker',
		summary:
			'Chip multi-select for WordPress roles. Reads eligible roles from desktopModeConfig.shareEligibleRoles; emits wpd-role-toggle { slug, selected } on every change.',
		status: 'experimental',
		since: '0.18.0',
		props: [
			{
				name: 'selected',
				type: 'csv role slugs',
				description: 'Comma-separated role slugs that are currently selected.',
			},
			{
				name: 'roles',
				type: 'JSON',
				description: 'Override the source of eligible roles (defaults to the global config).',
			},
		],
		events: [
			{
				name: 'wpd-role-toggle',
				description: 'Emitted on every click. Detail: `{ slug, selected }`.',
			},
		],
	} as const;

	private _selectedSet(): Set< string > {
		const raw = this.getAttribute( 'selected' ) || '';
		return new Set(
			raw
				.split( ',' )
				.map( ( s ) => s.trim() )
				.filter( ( s ) => s !== '' ),
		);
	}

	private _roles(): EligibleRole[] {
		const attr = this.getAttribute( 'roles' );
		if ( attr ) {
			try {
				const parsed = JSON.parse( attr );
				if ( Array.isArray( parsed ) ) {
					return parsed as EligibleRole[];
				}
			} catch ( e ) {
				// Ignore invalid JSON.
			}
		}
		return ( window.desktopModeConfig?.shareEligibleRoles || [] ) as EligibleRole[];
	}

	private _onToggle = ( slug: string ): void => {
		const selected = ! this._selectedSet().has( slug );
		this.emit( 'wpd-role-toggle', { slug, selected } );
	};

	protected render() {
		const roles = this._roles();
		if ( roles.length === 0 ) {
			return html`<span class="empty">No eligible roles.</span>`;
		}
		const set = this._selectedSet();
		return html`
			${ roles.map( ( r ) => {
				const isSelected = set.has( r.slug );
				return html`
					<button
						type="button"
						class="chip"
						aria-pressed=${ isSelected ? 'true' : 'false' }
						@click=${ () => this._onToggle( r.slug ) }
					>${ r.name }</button>
				`;
			} ) }
		`;
	}
}
defineComponent( 'wpd-role-picker', WpdRolePicker );
