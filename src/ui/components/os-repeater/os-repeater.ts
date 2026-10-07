import { Component, defineComponent, html } from '../../core';
import { styles } from './os-repeater.styles';
import '../os-button/os-button';
import '../os-icon/os-icon';

export class OsRepeater extends Component {
	static props = [
		'add-label',
		'empty-text',
		'disabled',
		'reorderable',
		'min',
		'max',
		'row-label',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Repeater',
		summary:
			'Add / remove / reorder a list of rows whose content you supply. Owns the chrome and the keyboard model; the consumer owns the data and applies every change. Keyed by stable strings so a remove or a move never rebuilds the rows that did not change.',
		status: 'stable',
		props: [
			{
				name: 'keys',
				type: 'string[] (JS property)',
				description:
					'One stable key per row, in display order. Each row element carries `slot="row-<key>"`.',
			},
			{
				name: 'add-label',
				type: 'string',
				default: 'Add row',
				description: 'Label on the add button.',
			},
			{
				name: 'empty-text',
				type: 'string',
				description: 'Shown in place of the rows when there are none.',
			},
			{
				name: 'row-label',
				type: 'string',
				default: 'Row',
				description:
					'Singular noun used to build the accessible names of the per-row buttons ("Remove choice", "Move choice up").',
			},
			{
				name: 'reorderable',
				type: 'boolean',
				default: 'false',
				description: 'Show the move up / move down buttons.',
			},
			{
				name: 'min',
				type: 'number',
				description:
					'Remove is disabled at this many rows. A list that must keep one row sets `min="1"`.',
			},
			{
				name: 'max',
				type: 'number',
				description: 'Add is disabled at this many rows.',
			},
			{
				name: 'disabled',
				type: 'boolean',
				default: 'false',
				description: 'Disables every control.',
			},
		],
		slots: [
			{
				name: 'row-<key>',
				description: 'One per entry in `keys` — the row content.',
			},
			{
				name: 'empty',
				description:
					'Rich replacement for `empty-text` when there are no rows.',
			},
			{
				name: 'footer',
				description: 'Content beside the add button.',
			},
		],
		events: [
			{
				name: 'os-repeater-add',
				description:
					'Add button pressed. Detail: `{ keys }` — the current list, unchanged.',
			},
			{
				name: 'os-repeater-remove',
				description:
					'Remove pressed on a row. Detail: `{ key, index, keys }`, where `keys` is a copy with the row already dropped.',
			},
			{
				name: 'os-repeater-move',
				description:
					'Row moved. Detail: `{ key, from, to, keys }`, where `keys` is a copy in the new order.',
			},
		],
		cssProps: [
			{ name: '--os-ui-repeater-gap' },
			{ name: '--os-ui-repeater-row-bg' },
			{ name: '--os-ui-surface', description: 'Row background falls through to this.' },
			{ name: '--os-ui-border', description: 'Row hairline.' },
		],
		example: html`
			<os-repeater add-label="Add choice" row-label="choice" reorderable>
			</os-repeater>
		`,
	} as const;

	private _keys: string[] = [];

	public get keys(): string[] {
		return this._keys;
	}
	public set keys( next: readonly string[] ) {
		this._keys = Array.isArray( next ) ? [ ...next ] : [];
		this.requestUpdate();
	}

	private get isDisabled(): boolean {
		return this.hasAttribute( 'disabled' );
	}

	private numeric( name: 'min' | 'max' ): number | null {
		const raw = this.getAttribute( name );
		if ( raw === null || raw.trim() === '' ) {
			return null;
		}
		const value = Number( raw );
		return Number.isFinite( value ) ? value : null;
	}

	private onAdd = (): void => {
		if ( this.isDisabled ) {
			return;
		}
		this.emit( 'os-repeater-add', { keys: [ ...this._keys ] } );
	};

	private onRemove( key: string ): void {
		if ( this.isDisabled ) {
			return;
		}
		const index = this._keys.indexOf( key );
		this.emit( 'os-repeater-remove', {
			key,
			index,
			keys: this._keys.filter( ( k ) => k !== key ),
		} );
	}

	private onMove( key: string, delta: -1 | 1 ): void {
		if ( this.isDisabled ) {
			return;
		}
		const from = this._keys.indexOf( key );
		const to = from + delta;
		if ( from < 0 || to < 0 || to >= this._keys.length ) {
			return;
		}
		const keys = [ ...this._keys ];
		keys.splice( to, 0, ...keys.splice( from, 1 ) );
		this.emit( 'os-repeater-move', { key, from, to, keys } );
	}

	private onKeydown = ( e: KeyboardEvent ): void => {
		if ( ! e.altKey || ! this.hasAttribute( 'reorderable' ) ) {
			return;
		}
		let delta = 0;
		if ( e.key === 'ArrowUp' ) {
			delta = -1;
		} else if ( e.key === 'ArrowDown' ) {
			delta = 1;
		}
		if ( delta === 0 ) {
			return;
		}
		const host = ( e.target as HTMLElement | null )?.closest?.(
			'[slot^="row-"]',
		);
		const key = host?.getAttribute( 'slot' )?.slice( 'row-'.length );
		if ( ! key ) {
			return;
		}
		e.preventDefault();
		this.onMove( key, delta as -1 | 1 );
	};

	protected render() {
		const keys = this._keys;
		const disabled = this.isDisabled;
		const reorderable = this.hasAttribute( 'reorderable' );

		const attrs = this as unknown as Record< string, string | null >;
		const rowLabel = attrs[ 'row-label' ] || 'row';
		const addLabel = attrs[ 'add-label' ] || 'Add row';
		const emptyText = attrs[ 'empty-text' ] || '';
		const min = this.numeric( 'min' );
		const max = this.numeric( 'max' );
		const canRemove = min === null || keys.length > min;
		const canAdd = max === null || keys.length < max;

		return html`
			<div class="os-repeater__rows" @keydown=${ this.onKeydown }>
				${ keys.length === 0
		? html`<div class="os-repeater__empty">
							<slot name="empty">${ emptyText }</slot>
					  </div>`
		: keys.map(
			( key, index ) => html`
								<div class="os-repeater__row" data-key=${ key }>
									${ reorderable
				? html`<div class="os-repeater__handles">
													<button
														type="button"
														class="os-repeater__handle"
														?disabled=${ disabled || index === 0 }
														aria-label="Move ${ rowLabel } up"
														@click=${ () => this.onMove( key, -1 ) }
													>
														<os-icon name="arrow-up-alt2" size="14"></os-icon>
													</button>
													<button
														type="button"
														class="os-repeater__handle"
														?disabled=${ disabled ||
													index === keys.length - 1 }
														aria-label="Move ${ rowLabel } down"
														@click=${ () => this.onMove( key, 1 ) }
													>
														<os-icon name="arrow-down-alt2" size="14"></os-icon>
													</button>
											  </div>`
				: null }
									<div class="os-repeater__content">
										<slot name="row-${ key }"></slot>
									</div>
									<button
										type="button"
										class="os-repeater__remove"
										?disabled=${ disabled || ! canRemove }
										aria-label="Remove ${ rowLabel }"
										@click=${ () => this.onRemove( key ) }
									>
										<os-icon name="trash" size="14"></os-icon>
									</button>
								</div>
							`,
		) }
			</div>
			<div class="os-repeater__footer">
				<os-button
					variant="secondary"
					size="small"
					?disabled=${ disabled || ! canAdd }
					@click=${ this.onAdd }
					>${ addLabel }</os-button
				>
				<slot name="footer"></slot>
			</div>
		`;
	}
}
defineComponent( 'os-repeater', OsRepeater );
