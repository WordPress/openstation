import { Component, defineComponent, html } from '../../core';
import { osIcon } from '../../icons';

import { styles } from './os-category-picker.styles';
import '../os-chip/os-chip';
import {
	OsCrumbChain,
	type OsCrumbSegment,
} from '../os-crumb-chain/os-crumb-chain';
import '../os-crumb-chain/os-crumb-chain';

export interface OsCategoryItem {
	id: number;
	name: string;
	parent: number;
}

interface TreeNode {
	item: OsCategoryItem;
	children: TreeNode[];
	depth: number;
}

const UNCATEGORIZED_SLUG = 'uncategorized';
const UNCATEGORIZED_DEFAULT_ID = 1;

function _isUncategorized( item: OsCategoryItem ): boolean {
	if ( item.id === UNCATEGORIZED_DEFAULT_ID ) {
		return true;
	}
	return ( item.name || '' ).toLowerCase() === UNCATEGORIZED_SLUG;
}

export class OsCategoryPicker extends Component {
	static props = [
		'placeholder',
		'add-label',
		'disabled',
		'readonly',
		'open',
		'loading',
		'max-visible',
	] as const;
	static styles = [ styles ];

	static help = {
		title: 'Category picker',
		summary:
			'Hierarchical multi-select for taxonomy terms. Compact chip row + tree popover with search, collapsible branches, indent guides, keyboard navigation. Aligns with WordPress core: any subset selectable, "Uncategorized" rendered as a muted dashed sentinel when the value is empty.',
		status: 'stable',
		props: [
			{
				name: 'placeholder',
				type: 'string',
				default: 'Search categories…',
				description: 'Native placeholder for the picker search input.',
			},
			{
				name: 'add-label',
				type: 'string',
				default: 'Categorize',
				description:
					'Currently inert — labeled the dedicated trigger button, which was replaced by the click-to-open cell. Parsed but unused.',
			},
			{
				name: 'disabled',
				type: 'boolean attribute',
				description: 'Disables every interactive surface.',
			},
			{
				name: 'readonly',
				type: 'boolean attribute',
				description:
					'Prevents opening the picker and hides the per-segment remove buttons on the crumb chains.',
			},
			{
				name: 'open',
				type: 'boolean attribute',
				description:
					'Two-way reflected: present while the picker popover is open. Setting it externally opens / closes the popover.',
			},
			{
				name: 'loading',
				type: 'boolean attribute',
				description:
					'Show a "Loading categories…" spinner inside the popover. Use while the consumer is fetching the term list.',
			},
			{
				name: 'max-visible',
				type: 'integer (string)',
				default: '2',
				description:
					'Currently inert — configured the "+N" overflow chip, which was replaced by the crumb-chain rendering. Parsed but unused.',
			},
		],
		events: [
			{
				name: 'os-categories-change',
				description:
					'Fires when the user toggles a row in the picker. Detail carries the new full id list — consumer mutates `value` (optimistically) and runs REST.',
				detail: '{ value: number[] }',
			},
			{
				name: 'os-categories-open',
				description: 'Fires when the popover opens.',
				detail: '{}',
			},
			{
				name: 'os-categories-close',
				description: 'Fires when the popover closes.',
				detail: '{}',
			},
			{
				name: 'os-categories-create',
				description:
					'Fires when the user submits the inline create-child input. Consumer is expected to POST to the taxonomy REST endpoint, append the new term to `items`, and (optionally) auto-select it by adding the new id to `value`. Picker shows a per-row spinner while the create is in flight; the consumer clears it by calling `picker.endCreating( parent )` on success or `picker.failCreating( parent )` on error.',
				detail: '{ name: string; parent: number }',
			},
			{
				name: 'os-categories-delete',
				description:
					'Fires when the per-row × button is activated. The button only renders on hover/keyboard-focus and is suppressed for the WP Uncategorized fallback. Consumer is responsible for confirmation + REST + invalidating any cached tree (typically broadcasts `os.term.changed`).',
				detail: '{ id: number; name: string }',
			},
		],

		example: html`
			<os-category-picker placeholder="Search categories…"></os-category-picker>
		`,
		exampleInit: ( root: HTMLElement ) => {
			const picker = root.querySelector( 'os-category-picker' );
			if ( ! picker ) {
				return;
			}
			const p = picker as OsCategoryPicker;
			p.items = [
				{ id: 1, name: 'Uncategorised', parent: 0 },
				{ id: 2, name: 'Tech', parent: 0 },
				{ id: 3, name: 'Web Dev', parent: 2 },
				{ id: 4, name: 'Frontend', parent: 3 },
				{ id: 5, name: 'Backend', parent: 3 },
				{ id: 6, name: 'Announcements', parent: 0 },
			];
			p.value = [ 4 ];
		},
	} as const;

	private _items: OsCategoryItem[] = [];
	private _value: number[] = [];
	private _query = '';

	private _collapsed: Set< number > = new Set();
	private _focusedRow = -1;

	private _creatingValues: Map< number, string > = new Map();
	private _creatingPending: Set< number > = new Set();

	get items(): OsCategoryItem[] {
		return this._items;
	}
	set items( next: readonly OsCategoryItem[] | null | undefined ) {
		this._items = Array.isArray( next ) ? next.slice() : [];
		this.requestUpdate();
	}

	get value(): number[] {
		return this._value;
	}
	set value( next: readonly number[] | null | undefined ) {
		this._value = Array.isArray( next ) ? next.slice() : [];
		this.requestUpdate();
	}

	get isOpen(): boolean {
		return ( this as unknown as { open: string | null } ).open !== null;
	}

	public openPicker(): void {
		if ( this.isOpen ) {
			return;
		}
		( this as unknown as { open: string } ).open = '';
		this._query = '';
		this._focusedRow = 0;

		this.emit( 'os-categories-open', {} );
		queueMicrotask( () => {
			this._positionPopover();
			this._searchInput?.focus();
		} );
	}

	public closePicker(): void {
		if ( ! this.isOpen ) {
			return;
		}
		( this as unknown as { open: null } ).open = null;
		this._query = '';
		this._focusedRow = -1;
		this.emit( 'os-categories-close', {} );
		this.requestUpdate();
	}

	connectedCallback(): void {
		super.connectedCallback();
		document.addEventListener( 'pointerdown', this._onDocPointerDown, true );
		document.addEventListener( 'keydown', this._onDocKeydown, true );

		window.addEventListener( 'resize', this._onLayoutChange, { passive: true } );
		window.addEventListener( 'scroll', this._onLayoutChange, {
			passive: true,
			capture: true,
		} );
	}

	disconnectedCallback(): void {
		document.removeEventListener( 'pointerdown', this._onDocPointerDown, true );
		document.removeEventListener( 'keydown', this._onDocKeydown, true );
		window.removeEventListener( 'resize', this._onLayoutChange );
		window.removeEventListener( 'scroll', this._onLayoutChange, { capture: true } );
	}

	private get _searchInput(): HTMLInputElement | null {
		return this.shadowRoot?.querySelector< HTMLInputElement >( '.os-cat__search' ) ?? null;
	}

	protected render() {
		const isOpen = this.isOpen;
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const readonly =
			( this as unknown as { readonly: string | null } ).readonly !== null;
		const loading =
			( this as unknown as { loading: string | null } ).loading !== null;
		const addLabel =
			( this as unknown as { 'add-label': string | null } )[ 'add-label' ] ||
			'Categorize';
		const placeholder =
			( this as unknown as { placeholder: string | null } ).placeholder ||
			'Search categories…';
		const maxVisible = Math.max(
			0,
			parseInt(
				( this as unknown as { 'max-visible': string | null } )[ 'max-visible' ] ||
					'2',
				10,
			) || 2,
		);

		return html`
			<span class="os-cat" role="group">
				${ this._renderChipRow( maxVisible, readonly, disabled, addLabel ) }
				${ isOpen
					? this._renderPopover( placeholder, loading )
					: html`` }
			</span>
		`;
	}

	private _renderChipRow(
		_maxVisible: number,
		readonly: boolean,
		disabled: boolean,
		_addLabel: string,
	) {
		const selectedItems = this._selectedItemsInOrder();

		if ( selectedItems.length === 0 ) {
			return html`
				<span class="os-cat__chips" role="list">
					<span
						class="os-cat__uncategorized"
						title=${ 'Posts with no category appear as "Uncategorized" in WordPress.' }
						@click=${ this._onCellClick }
					>${ 'Uncategorized' }</span>
				</span>
			`;
		}

		const chains = this._buildChains( selectedItems );
		return html`
			<div
				class="os-cat__chains"
				role="list"
				@click=${ this._onCellClick }
			>
				${ chains.map( ( chain ) =>
					this._renderChain( chain, readonly, disabled ),
				) }
			</div>
		`;
	}

	private _buildChains(
		selectedItems: OsCategoryItem[],
	): Array< { id: number; segments: OsCrumbSegment[] } > {
		const byId = new Map< number, OsCategoryItem >();
		for ( const item of this._items ) {
			byId.set( item.id, item );
		}
		const selectedIds = new Set( selectedItems.map( ( s ) => s.id ) );

		const hasSelectedDescendant = ( ancestorId: number ): boolean => {
			for ( const otherId of selectedIds ) {
				if ( otherId === ancestorId ) {
					continue;
				}
				let cursor = byId.get( otherId );
				let safety = 16;
				while ( cursor && safety-- > 0 ) {
					if ( cursor.parent === ancestorId ) {
						return true;
					}
					if ( ! cursor.parent ) {
						break;
					}
					cursor = byId.get( cursor.parent );
				}
			}
			return false;
		};

		const chainLeaves = selectedItems.filter(
			( item ) => ! hasSelectedDescendant( item.id ),
		);

		const chains: Array< { id: number; segments: OsCrumbSegment[] } > = [];
		for ( const leaf of chainLeaves ) {
			const path: OsCategoryItem[] = [];
			let cursor: OsCategoryItem | undefined = leaf;
			let safety = 16;
			while ( cursor && safety-- > 0 ) {
				if ( cursor === leaf || selectedIds.has( cursor.id ) ) {
					path.unshift( cursor );
				}
				if ( ! cursor.parent ) {
					break;
				}
				cursor = byId.get( cursor.parent );
			}

			const segments = path.map( ( item ) => ( {
				id: item.id,
				name: item.name,
			} ) );
			chains.push( { id: leaf.id, segments } );
		}
		return chains;
	}

	private _renderChain(
		chain: { id: number; segments: OsCrumbSegment[] },
		readonly: boolean,
		disabled: boolean,
	) {
		const removable = ! readonly && ! disabled;

		const onRemove = ( e: Event ): void => {
			e.stopPropagation();
			const detail = ( e as CustomEvent< { index?: number } > ).detail;
			const startIdx =
				typeof detail?.index === 'number'
					? detail.index
					: chain.segments.length - 1;
			const idsToRemove = new Set< number >();
			for ( const seg of chain.segments.slice( startIdx ) ) {
				if ( typeof seg.id === 'number' ) {
					idsToRemove.add( seg.id );
				}
			}
			const next = this._value.filter(
				( id ) => ! idsToRemove.has( id ),
			);
			if ( next.length === this._value.length ) {
				return;
			}
			this.emit( 'os-categories-change', { value: next } );
		};

		const el = document.createElement( 'os-crumb-chain' ) as OsCrumbChain;
		el.segments = chain.segments;
		if ( removable ) {
			el.setAttribute( 'removable', '' );
		}
		el.addEventListener( 'os-chain-remove', onRemove );
		return html`<div role="listitem">${ el }</div>`;
	}

	private _onCellClick = ( e: Event ): void => {
		const target = e.target as HTMLElement | null;
		if ( target?.closest( '.os-cat-node' ) ) {
			return;
		}
		if ( this.isOpen ) {
			return;
		}
		const disabled =
			( this as unknown as { disabled: string | null } ).disabled !== null;
		const readonly =
			( this as unknown as { readonly: string | null } ).readonly !== null;
		if ( disabled || readonly ) {
			return;
		}
		this.openPicker();
	};

	private _renderPopover( placeholder: string, loading: boolean ) {
		const tree = this._buildTree();
		const filtered = this._filterTree( tree, this._query );
		const flat = this._flattenForDisplay( filtered );

		if ( this._focusedRow >= flat.length ) {
			this._focusedRow = flat.length > 0 ? flat.length - 1 : -1;
		}

		return html`
			<div class="os-cat__popover" role="dialog" aria-label="Choose categories">
				<input
					class="os-cat__search"
					type="text"
					autocomplete="off"
					placeholder=${ placeholder }
					.value=${ this._query }
					@input=${ ( e: Event ) => this._onSearchInput( e ) }
					@keydown=${ ( e: KeyboardEvent ) => this._onSearchKeydown( e, flat ) }
				/>
				<div class="os-cat__tree" role="listbox" aria-multiselectable="true">
					${ this._renderCreateRow( 0, 12, 0, '' ) }
					${ this._renderTreeBody( loading, flat ) }
				</div>
				<div class="os-cat__footer">
					<span class="dashicons dashicons-info-outline" aria-hidden="true"></span>
					<span>
						Posts with no category appear as
						<strong>Uncategorized</strong>.
					</span>
				</div>
			</div>
		`;
	}

	private _renderTreeBody(
		loading: boolean,
		flat: Array< { node: TreeNode; visible: boolean; hasChildren: boolean } >,
	) {
		if ( loading ) {
			return html`
				<div class="os-cat__loading">
					<span class="os-cat__loading-spinner" aria-hidden="true"></span>
					${ 'Loading categories…' }
				</div>
			`;
		}
		if ( flat.length === 0 ) {
			return html`
				<div class="os-cat__empty">
					${ this._items.length === 0
						? 'No categories yet — create one in WordPress to assign.'
						: 'No matches.' }
				</div>
			`;
		}
		return flat.map( ( entry, idx ) => this._renderRow( entry, idx, flat.length ) );
	}

	private _renderRow(
		entry: { node: TreeNode; visible: boolean; hasChildren: boolean },
		idx: number,
		_total: number,
	) {
		const { node, hasChildren } = entry;
		const isSelected = this._value.includes( node.item.id );
		const isExpanded = ! this._collapsed.has( node.item.id );
		const indent = 12 + node.depth * 16;
		const guide = node.depth > 0 ? node.depth * 16 : 0;
		const isFocused = idx === this._focusedRow;

		return html`
			<div class="os-cat__row-block">
				<div
					class="os-cat__row"
					role="option"
					aria-selected=${ isSelected ? 'true' : 'false' }
					data-selected=${ isSelected ? 'true' : 'false' }
					data-expanded=${ isExpanded ? 'true' : 'false' }
					data-focused=${ isFocused ? 'true' : 'false' }
					data-row-id=${ String( node.item.id ) }
					style=${ `--os-ui-cat-row-indent: ${ indent }px; --os-ui-cat-guide-width: ${ guide }px;` }
					@mouseenter=${ () => {
						this._focusedRow = idx;
						this.requestUpdate();
					} }
					@click=${ ( e: MouseEvent ) => {
						e.preventDefault();
						this._toggleSelection( node.item.id );
					} }
				>
					${ hasChildren
						? html`<button
								type="button"
								class="os-cat__expander"
								aria-label=${ isExpanded ? 'Collapse' : 'Expand' }
								@click=${ ( e: MouseEvent ) => {
									e.stopPropagation();
									this._toggleExpand( node.item.id );
								} }
							>${ _iconCaretRight() }</button>`
						: html`<span class="os-cat__expander os-cat__expander--placeholder" aria-hidden="true">${ _iconCaretRight() }</span>` }
					<span class="os-cat__check" aria-hidden="true">${ _iconCheck() }</span>
					<span class="os-cat__label">${ this._highlight( node.item.name, this._query ) }</span>
					${ _isUncategorized( node.item )
						? html``
						: html`<button
								type="button"
								class="os-cat__delete"
								aria-label=${ `Delete ${ node.item.name }` }
								title=${ `Delete ${ node.item.name }` }
								@click=${ ( e: MouseEvent ) =>
									this._onDeleteClick( e, node.item ) }
							>${ _iconCrossSmall() }</button>` }
				</div>
				${ isExpanded && ! _isUncategorized( node.item )
					? this._renderCreateRow(
						node.item.id,
						12 + ( node.depth + 1 ) * 16,
						( node.depth + 1 ) * 16,
						node.item.name,
					)
					: html`` }
			</div>
		`;
	}

	private _renderCreateRow(
		parentId: number,
		indent: number,
		guide: number,
		parentName: string,
	) {
		const value = this._creatingValues.get( parentId ) ?? '';
		const pending = this._creatingPending.has( parentId );
		const placeholder =
			parentId === 0
				? 'Add new category…'
				: `Add child of "${ parentName }"…`;
		return html`
			<div
				class="os-cat__create-row"
				style=${ `--os-ui-cat-row-indent: ${ indent }px; --os-ui-cat-guide-width: ${ guide }px;` }
				@click=${ ( e: MouseEvent ) => e.stopPropagation() }
			>
				<div class="os-cat__create-wrap">
					<input
						class="os-cat__create-input"
						type="text"
						autocomplete="off"
						spellcheck="false"
						placeholder=${ placeholder }
						aria-label=${ placeholder }
						.value=${ value }
						?disabled=${ pending }
						@input=${ ( e: Event ) =>
							this._onCreateInput( e, parentId ) }
						@keydown=${ ( e: KeyboardEvent ) =>
							this._onCreateKeydown( e, parentId ) }
					/>
					${ pending
						? html`<span class="os-cat__create-spinner" aria-hidden="true"></span>`
						: html`<button
								type="button"
								class="os-cat__create-submit"
								aria-label=${ parentId === 0
									? 'Create category'
									: `Create child of ${ parentName }` }
								?disabled=${ value.trim().length === 0 }
								@click=${ ( e: MouseEvent ) => {
									e.stopPropagation();
									this._submitCreate( parentId );
								} }
							>${ _iconPlusSmall() }</button>` }
				</div>
			</div>
		`;
	}

	private _onCreateInput( e: Event, parentId: number ): void {
		const value = ( e.target as HTMLInputElement ).value;
		if ( value === '' ) {
			this._creatingValues.delete( parentId );
		} else {
			this._creatingValues.set( parentId, value );
		}

		this.requestUpdate();
	}

	private _onCreateKeydown( e: KeyboardEvent, parentId: number ): void {
		if ( e.key === 'Escape' ) {
			e.preventDefault();
			this._creatingValues.delete( parentId );
			this.requestUpdate();
			return;
		}
		if ( e.key === 'Enter' ) {
			e.preventDefault();
			this._submitCreate( parentId );
		}
	}

	private _submitCreate( parentId: number ): void {
		const name = ( this._creatingValues.get( parentId ) ?? '' ).trim();
		if ( ! name || this._creatingPending.has( parentId ) ) {
			return;
		}
		this._creatingPending.add( parentId );
		this.requestUpdate();
		this.emit( 'os-categories-create', { name, parent: parentId } );
	}

	public endCreating( parent = 0 ): void {
		this._creatingPending.delete( parent );
		this._creatingValues.delete( parent );
		this.requestUpdate();
	}

	public failCreating( parent = 0, _error?: string ): void {
		this._creatingPending.delete( parent );
		this.requestUpdate();
	}

	private _buildTree(): TreeNode[] {
		const byId = new Map< number, TreeNode >();
		for ( const item of this._items ) {
			byId.set( item.id, { item, children: [], depth: 0 } );
		}
		const roots: TreeNode[] = [];
		for ( const node of byId.values() ) {
			const parentId = node.item.parent;
			if ( parentId && byId.has( parentId ) ) {
				const parentNode = byId.get( parentId )!;
				parentNode.children.push( node );
			} else {
				roots.push( node );
			}
		}

		const setDepth = ( node: TreeNode, depth: number ): void => {
			node.depth = depth;
			for ( const child of node.children ) {
				setDepth( child, depth + 1 );
			}
		};
		for ( const root of roots ) {
			setDepth( root, 0 );
		}

		const sortRecursive = ( nodes: TreeNode[] ): void => {
			nodes.sort( ( a, b ) => {
				const aUncat = _isUncategorized( a.item );
				const bUncat = _isUncategorized( b.item );
				if ( aUncat !== bUncat ) {
					return aUncat ? -1 : 1;
				}
				return a.item.name.localeCompare( b.item.name );
			} );
			for ( const n of nodes ) {
				sortRecursive( n.children );
			}
		};
		sortRecursive( roots );
		return roots;
	}

	private _filterTree( tree: TreeNode[], query: string ): TreeNode[] {
		const trimmed = query.trim().toLowerCase();
		if ( ! trimmed ) {
			return tree;
		}
		const matches = ( node: TreeNode ): TreeNode | null => {
			const ownMatch = node.item.name.toLowerCase().includes( trimmed );
			if ( ownMatch ) {
				return {
					item: node.item,
					children: node.children.slice(),
					depth: node.depth,
				};
			}
			const childrenMatched = node.children
				.map( matches )
				.filter( ( n ): n is TreeNode => n !== null );
			if ( childrenMatched.length > 0 ) {
				return {
					item: node.item,
					children: childrenMatched,
					depth: node.depth,
				};
			}
			return null;
		};
		return tree
			.map( matches )
			.filter( ( n ): n is TreeNode => n !== null );
	}

	private _flattenForDisplay(
		tree: TreeNode[],
	): Array< { node: TreeNode; visible: boolean; hasChildren: boolean } > {
		const out: Array< {
			node: TreeNode;
			visible: boolean;
			hasChildren: boolean;
		} > = [];
		const isSearching = this._query.trim() !== '';
		const walk = ( nodes: TreeNode[] ): void => {
			for ( const node of nodes ) {
				out.push( {
					node,
					visible: true,
					hasChildren: node.children.length > 0,
				} );

				const collapsed = this._collapsed.has( node.item.id ) && ! isSearching;
				if ( ! collapsed && node.children.length > 0 ) {
					walk( node.children );
				}
			}
		};
		walk( tree );
		return out;
	}

	private _selectedItemsInOrder(): OsCategoryItem[] {
		const byId = new Map< number, OsCategoryItem >();
		for ( const item of this._items ) {
			byId.set( item.id, item );
		}

		const real: OsCategoryItem[] = [];
		const uncatItems: OsCategoryItem[] = [];
		for ( const id of this._value ) {
			const item = byId.get( id );
			if ( ! item ) {
				continue;
			}
			if (
				item.name.toLowerCase() === UNCATEGORIZED_SLUG ||
				item.id === 1
			) {
				uncatItems.push( item );
			} else {
				real.push( item );
			}
		}

		if ( real.length > 0 ) {
			return real;
		}
		return uncatItems.length > 0 ? [] : real;
	}

	private _highlight( label: string, query: string ): unknown {
		const trimmed = query.trim();
		if ( ! trimmed ) {
			return label;
		}
		const lower = label.toLowerCase();
		const needle = trimmed.toLowerCase();
		const idx = lower.indexOf( needle );
		if ( idx === -1 ) {
			return label;
		}
		return html`${ label.slice( 0, idx ) }<span class="os-cat__match"
			>${ label.slice( idx, idx + trimmed.length ) }</span
		>${ label.slice( idx + trimmed.length ) }`;
	}

	private _toggleSelection( id: number ): void {
		const next = this._value.includes( id )
			? this._value.filter( ( v ) => v !== id )
			: [ ...this._value, id ];
		this.emit( 'os-categories-change', { value: next } );
	}

	private _onDeleteClick(
		e: MouseEvent,
		item: OsCategoryItem,
	): void {
		e.stopPropagation();
		e.preventDefault();
		this.emit( 'os-categories-delete', { id: item.id, name: item.name } );
	}

	private _toggleExpand( id: number ): void {
		if ( this._collapsed.has( id ) ) {
			this._collapsed.delete( id );
		} else {
			this._collapsed.add( id );
		}
		this.requestUpdate();
	}

	private _onSearchInput( e: Event ): void {
		this._query = ( e.target as HTMLInputElement ).value;
		this._focusedRow = 0;
		this.requestUpdate();
	}

	private _onSearchKeydown(
		e: KeyboardEvent,
		flat: Array< { node: TreeNode; visible: boolean; hasChildren: boolean } >,
	): void {
		switch ( e.key ) {
			case 'ArrowDown': {
				if ( flat.length === 0 ) {
					return;
				}
				e.preventDefault();
				this._focusedRow =
					this._focusedRow + 1 >= flat.length ? 0 : this._focusedRow + 1;
				this.requestUpdate();
				this._scrollFocusedIntoView();
				return;
			}
			case 'ArrowUp': {
				if ( flat.length === 0 ) {
					return;
				}
				e.preventDefault();
				this._focusedRow =
					this._focusedRow <= 0 ? flat.length - 1 : this._focusedRow - 1;
				this.requestUpdate();
				this._scrollFocusedIntoView();
				return;
			}
			case 'ArrowRight': {
				if ( this._focusedRow < 0 || this._focusedRow >= flat.length ) {
					return;
				}
				const entry = flat[ this._focusedRow ];

				if ( entry.hasChildren && this._collapsed.has( entry.node.item.id ) ) {
					e.preventDefault();
					this._toggleExpand( entry.node.item.id );
				}
				return;
			}
			case 'ArrowLeft': {
				if ( this._focusedRow < 0 || this._focusedRow >= flat.length ) {
					return;
				}
				const entry = flat[ this._focusedRow ];

				if ( entry.hasChildren && ! this._collapsed.has( entry.node.item.id ) ) {
					e.preventDefault();
					this._toggleExpand( entry.node.item.id );
				}
				return;
			}
			case 'Enter':
			case ' ': {
				if ( this._focusedRow < 0 || this._focusedRow >= flat.length ) {
					return;
				}
				e.preventDefault();
				const entry = flat[ this._focusedRow ];
				this._toggleSelection( entry.node.item.id );
				return;
			}
			case 'Escape': {
				e.preventDefault();
				this.closePicker();
			}
		}
	}

	private _scrollFocusedIntoView(): void {
		queueMicrotask( () => {
			const tree = this.shadowRoot?.querySelector< HTMLElement >( '.os-cat__tree' );
			if ( ! tree ) {
				return;
			}
			const row = tree.querySelector< HTMLElement >(
				`.os-cat__row[data-focused="true"]`,
			);
			if ( ! row ) {
				return;
			}
			const rRect = row.getBoundingClientRect();
			const tRect = tree.getBoundingClientRect();
			if ( rRect.top < tRect.top ) {
				row.scrollIntoView( { block: 'nearest' } );
			} else if ( rRect.bottom > tRect.bottom ) {
				row.scrollIntoView( { block: 'nearest' } );
			}
		} );
	}

	private _onDocPointerDown = ( e: Event ): void => {
		if ( ! this.isOpen ) {
			return;
		}
		const path = ( e as PointerEvent ).composedPath();
		if ( path.includes( this ) ) {
			return;
		}
		this.closePicker();
	};

	private _onLayoutChange = (): void => {
		if ( ! this.isOpen ) {
			return;
		}
		this.closePicker();
	};

	private _positionPopover(): void {
		const popover = this.shadowRoot?.querySelector< HTMLElement >(
			'.os-cat__popover',
		);
		if ( ! popover ) {
			return;
		}

		const anchorRect = this.getBoundingClientRect();
		const popRect = popover.getBoundingClientRect();
		const viewportW = window.innerWidth;
		const viewportH = window.innerHeight;
		const margin = 8;

		let top = anchorRect.bottom + 4;
		const overflowBottom = top + popRect.height + margin > viewportH;
		const fitsAbove = anchorRect.top - 4 - popRect.height >= margin;
		if ( overflowBottom && fitsAbove ) {
			top = anchorRect.top - 4 - popRect.height;
		} else if ( overflowBottom ) {
			top = Math.max( margin, viewportH - popRect.height - margin );
		}

		let left = anchorRect.left;
		if ( left + popRect.width + margin > viewportW ) {
			left = anchorRect.right - popRect.width;
		}
		left = Math.max(
			margin,
			Math.min( left, viewportW - popRect.width - margin ),
		);

		popover.style.top = `${ top }px`;
		popover.style.left = `${ left }px`;
	}

	private _onDocKeydown = ( e: KeyboardEvent ): void => {
		if ( this.isOpen && e.key === 'Escape' ) {
			e.preventDefault();
			this.closePicker();
		}
	};
}
defineComponent( 'os-category-picker', OsCategoryPicker );

function _iconCaretRight() {
	return osIcon( 'chevron-right', { size: 14 } );
}

function _iconPlusSmall() {
	return osIcon( 'plus', { size: 16 } );
}

function _iconCheck() {
	return osIcon( 'check', { size: null } );
}

function _iconCrossSmall() {
	return osIcon( 'close', { size: null } );
}
