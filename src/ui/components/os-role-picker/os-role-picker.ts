/**
 * `<os-role-picker>` — chip multi-select over the site's eligible
 * roles (server-injected via `openStationConfig.shareEligibleRoles`).
 *
 * Use:
 *
 * ```html
 * <os-role-picker selected="editor,author"></os-role-picker>
 * ```
 *
 * Emits `os-role-toggle { slug, selected }` whenever a chip is
 * clicked. The parent owns the source of truth — the component
 * just reflects the `selected` CSV attribute.
 */

import { Component, defineComponent, html } from '../../core';
import { rolePickerStyles } from './os-role-picker.styles';

interface EligibleRole {
	slug: string;
	name: string;
}

export class OsRolePicker extends Component {
	static props = [ 'selected', 'roles' ] as const;
	static styles = [ rolePickerStyles ];

	static help = {
		title: 'Role picker',
		summary:
			'Chip multi-select for WordPress roles. Reads eligible roles from openStationConfig.shareEligibleRoles; emits os-role-toggle { slug, selected } on every change.',
		status: 'stable',
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
				name: 'os-role-toggle',
				description: 'Emitted on every click. Detail: `{ slug, selected }`.',
			},
		],
		/*
		 * `roles` is passed here explicitly rather than left to the
		 * global config: a site whose `shareEligibleRoles` is empty —
		 * or a docs pane loaded before that config lands — would
		 * otherwise render an empty row and look broken. The attribute
		 * override is a documented prop, so the example is also
		 * demonstrating it.
		 */
		example: html`
			<os-role-picker
				selected="editor,author"
				roles='[{"slug":"administrator","name":"Administrator"},{"slug":"editor","name":"Editor"},{"slug":"author","name":"Author"},{"slug":"contributor","name":"Contributor"},{"slug":"subscriber","name":"Subscriber"}]'
			></os-role-picker>
		`,
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
		return ( window.openStationConfig?.shareEligibleRoles || [] ) as EligibleRole[];
	}

	private _onToggle = ( slug: string ): void => {
		const selected = ! this._selectedSet().has( slug );
		this.emit( 'os-role-toggle', { slug, selected } );
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
defineComponent( 'os-role-picker', OsRolePicker );
