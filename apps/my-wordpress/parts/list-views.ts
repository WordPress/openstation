/**
 * My WordPress — the list surfaces.
 *
 * Part of the `my-wordpress` client view: imported by the
 * `my-wordpress.os.ts` entry. This part paints what a section LISTS:
 * the root folder grid, the tile canvas with its ghosts and sentinel,
 * the context menu (running the shared WP Explorer filters), the
 * Edit… quick-edit modal and the media zoom overlay.
 *
 * @public
 */

import { __, _n, html, sprintf, type TemplateResult } from '@openstation/app';
import { openUserEditWindow } from '../../../src/posts-window/user-edit-target';
import {
	shell,
	uiOf,
	type Ctx,
	type ListItem,
	type MenuOption,
	type SectionDef,
} from './types';
import {
	actionContext,
	buildMenuOptions,
	glyph,
	resolveActions,
	resolveBanding,
	runAction,
	withSendToHeading,
} from './helpers';

export function renderRoot( ctx: Ctx ): TemplateResult {
	const { data, state } = ctx;
	const inGroup = state.group;
	const loose = data.sections.filter( ( s ) =>
		inGroup ? s.group === inGroup : ! s.group,
	);
	const folders = inGroup
		? []
		: data.groups.map( ( g ) => ( {
			...g,
			count: data.sections
				.filter( ( s ) => s.group === g.id )
				.reduce( ( sum, s ) => sum + s.count, 0 ),
		} ) );
	const ui = uiOf( ctx );
	// Finder semantics, like WP Explorer's root: a single click only
	// SELECTS the folder tile; double click (or Enter) navigates in.
	const folderTile = (
		key: string,
		label: string,
		icon: TemplateResult,
		count: number,
		go: () => void,
	): TemplateResult => html`
		<button
			type="button"
			class="os-mywp__tile ${ ui.folderSel === key ? 'is-selected' : '' }"
			aria-pressed=${ ui.folderSel === key ? 'true' : 'false' }
			@click=${ () => {
				ui.folderSel = key;
				ctx.repaint();
			} }
			@dblclick=${ () => {
				ui.folderSel = null;
				go();
			} }
			@keydown=${ ( e: KeyboardEvent ) => {
				if ( e.key === 'Enter' ) {
					e.preventDefault();
					ui.folderSel = null;
					go();
				}
			} }
		>
			${ icon }
			<span class="os-mywp__tile-label">${ label } · ${ count }</span>
		</button>
	`;
	// A section's icon is normally a dashicon, or a plugin brand mark
	// masked to the text colour. The Agents tile is a PORTRAIT — the
	// same robot avatar `get_avatar()` serves — and a portrait drawn
	// through a monochrome mask is a filled circle, so it renders as
	// the image it is, exactly as WP Explorer's os-tile paints it.
	const sectionIcon = ( s: { kind: string; icon: string } ): TemplateResult =>
		s.kind === 'agent' && /^(https?:|data:)/.test( s.icon )
			? html`<img class="os-mywp__icon-img" src=${ s.icon } alt="" width="48" height="48" />`
			: glyph( s.icon, 'os-mywp__tile-icon' );
	return html`
		${ inGroup
			? html`<div
				class="os-my-wordpress__group-extras"
				data-mywp-group-extras=${ inGroup }
				os-preserve
			></div>`
			: '' }
		<div class="os-mywp__root" role="list">
			${ loose.map( ( s ) => folderTile(
				`section:${ s.id }`,
				s.label,
				sectionIcon( s ),
				s.count,
				() => void ctx.dispatch( 'go', { group: inGroup, section: s.id } ),
			) ) }
			${ folders.map( ( g ) => folderTile(
				`group:${ g.id }`,
				g.label,
				glyph( g.icon, 'os-mywp__tile-icon' ),
				g.count,
				() => void ctx.dispatch( 'go', { group: g.id } ),
			) ) }
		</div>
	`;
}

function renderTile( ctx: Ctx, section: SectionDef, item: ListItem, order: number[] ): TemplateResult {
	const { state } = ctx;
	const isSelected = state.selected.includes( item.id );
	const isOpen = state.item === item.id;
	const select = ( e: MouseEvent ): void => {
		ctx.local( 'select', {
			item: item.id,
			ctrl: e.ctrlKey || e.metaKey,
			shift: e.shiftKey,
			order,
		} );
		if ( ! e.ctrlKey && ! e.metaKey && ! e.shiftKey ) {
			void ctx.dispatch( 'open', { item: item.id } );
		}
	};
	const activate = (): void => {
		// A plugin may claim "the user opened this person" — WP
		// Explorer's `os.my-wordpress.user-activate` seam, verbatim.
		// A shop's Customers folder opens the customer window; the
		// built-in fallthrough keeps double-click meaning something
		// when no subscriber answers.
		if ( section.kind === 'user' ) {
			const handled = shell().hooks?.applyFilters(
				'os.my-wordpress.user-activate',
				false,
				{
					entityId: section.id,
					kind: section.kind,
					item: item as unknown as Record< string, unknown >,
				},
			);
			if ( handled === true ) {
				return;
			}
			// The built-in answer, WP Explorer's: opening a person is
			// their activity footprint — the profile editor stays one
			// right-click (or pane button) away.
			void ctx.dispatch( 'footprint', { user: item.id, name: item.title } );
			return;
		}
		if ( item.canEdit ) {
			void ctx.dispatch( 'edit', { item: item.id } );
		}
	};
	return html`
		<div
			class="os-mywp__cell ${ isOpen ? 'is-open' : '' }"
			data-item-id=${ String( item.id ) }
			data-mywp-drag=${ section.kind === 'user' ? 'user' : section.post_type }
			role="option"
			aria-selected=${ isSelected ? 'true' : 'false' }
			@click=${ select }
			@dblclick=${ activate }
			@contextmenu=${ ( e: MouseEvent ) => {
				e.preventDefault();
				e.stopPropagation();
				uiOf( ctx ).menu = { x: e.clientX, y: e.clientY, item };
				ctx.repaint();
			} }
		>
			<span class="os-mywp__tilebox">
				<os-tile
					kind="entry"
					type=${ section.kind === 'user' ? 'user' : section.post_type }
					ref=${ String( item.id ) }
					label=${ item.title }
					icon=${ item.thumb ? '' : section.icon }
					thumbnail=${ item.thumb }
					status=${ item.status && item.status !== 'publish' && section.kind === 'post' ? item.status : '' }
					?selected=${ isSelected }
				></os-tile>
				${ item.lockedBy
					? html`<span class="os-mywp__lock" title=${ sprintf(
						/* translators: %s: user display name. */
						__( '%s is editing' ),
						item.lockedBy,
					) }>🔒</span>`
					: '' }
			</span>
		</div>
	`;
}

export function renderList( ctx: Ctx, section: SectionDef, items: ListItem[] ): TemplateResult {
	if ( items.length === 0 ) {
		return html`
			<os-empty-state icon=${ section.icon.startsWith( 'dashicons-' ) ? section.icon : 'dashicons-portfolio' }>
				${ ctx.state.query ? __( 'Nothing matches the search.' ) : __( 'Nothing here yet.' ) }
			</os-empty-state>
		`;
	}
	const ui = uiOf( ctx );
	const canvasMenu = ( e: MouseEvent ): void => {
		e.preventDefault();
		ui.menu = { x: e.clientX, y: e.clientY, item: null };
		ctx.repaint();
	};
	const hasMore = ui.pageCount > Math.max( ...Array.from( ui.pages.keys() ), 1 );
	// The page being fetched paints as skeleton tiles — WP Explorer's
	// loading placeholders. They occupy the incoming page's real
	// footprint, so the scroll height settles once instead of jumping.
	const ghosts = ui.loadingPage > 0 && ! ui.pages.has( ui.loadingPage ) && hasMore
		? Math.max( 1, Math.min( ctx.data.list?.perPage ?? 24, ui.total - items.length ) )
		: 0;
	const ghostCells = html`
		${ Array.from( { length: ghosts }, ( _unused, i ) => html`
			<div class="os-mywp__cell os-mywp__cell--ghost" data-ghost-index=${ String( i ) } aria-hidden="true">
				<span class="os-mywp__ghost">
					<span class="os-mywp__ghost-visual"></span>
					<span class="os-mywp__ghost-label"></span>
				</span>
			</div>
		` ) }
	`;

	// Banded layout — WP Explorer's `os.my-wordpress.list-bands`
	// filter, verbatim: bands in declared order, rows grouped by the
	// subscriber's assigner, unassigned rows in an unlabelled band at
	// the end. Shift-selection extends across the VISUAL order.
	const banding = resolveBanding( shell().hooks, section );
	if ( banding ) {
		const known = new Set( banding.bands.map( ( b ) => b.id ) );
		const byBand = new Map< string, ListItem[] >();
		const unfiled: ListItem[] = [];
		for ( const row of items ) {
			const id = banding.assign( row );
			if ( id !== null && known.has( id ) ) {
				byBand.set( id, [ ...( byBand.get( id ) ?? [] ), row ] );
			} else {
				unfiled.push( row );
			}
		}
		const sorted = [ ...banding.bands ].sort(
			( a, b ) => ( a.order ?? 0 ) - ( b.order ?? 0 ),
		);
		const order = [
			...sorted.flatMap( ( band ) => byBand.get( band.id ) ?? [] ),
			...unfiled,
		].map( ( i ) => i.id );
		return html`
			<div
				class="os-mywp__tiles os-mywp__canvas os-mywp__tiles--banded"
				role="listbox"
				aria-multiselectable="true"
				@contextmenu=${ canvasMenu }
			>
				${ sorted.map( ( band ) => {
					const rows = byBand.get( band.id ) ?? [];
					// Bands with a declared expected count are laid out
					// before their rows land; ones without appear with
					// their first row.
					if ( rows.length === 0 && ! ( ( band.count ?? 0 ) > 0 ) ) {
						return '';
					}
					return html`
						<section class="os-mywp__band" data-band=${ band.id }>
							<h3 class="os-mywp__band-head ${ band.tone ? `os-mywp__band-head--${ band.tone }` : '' }">
								<span>${ band.label }</span>
								<span class="os-mywp__band-count">${ rows.length }</span>
							</h3>
							<div class="os-mywp__band-grid" role="presentation">
								${ rows.map( ( row ) => renderTile( ctx, section, row, order ) ) }
							</div>
						</section>
					`;
				} ) }
				${ unfiled.length > 0
					? html`<div class="os-mywp__band-grid" role="presentation">
						${ unfiled.map( ( row ) => renderTile( ctx, section, row, order ) ) }
					</div>`
					: '' }
				${ ghosts > 0
					? html`<div class="os-mywp__band-grid" role="presentation">${ ghostCells }</div>`
					: '' }
				${ hasMore ? html`<div class="os-mywp__sentinel" data-mywp-sentinel></div>` : '' }
			</div>
		`;
	}

	const order = items.map( ( i ) => i.id );
	return html`
		<div
			class="os-mywp__tiles os-mywp__canvas"
			role="listbox"
			aria-multiselectable="true"
			@contextmenu=${ canvasMenu }
		>
			${ items.map( ( item ) => renderTile( ctx, section, item, order ) ) }
			${ ghostCells }
			${ hasMore ? html`<div class="os-mywp__sentinel" data-mywp-sentinel></div>` : '' }
		</div>
	`;
}

export function renderMenu( ctx: Ctx, section: SectionDef ): TemplateResult | '' {
	const ui = uiOf( ctx );
	if ( ! ui.menu ) {
		return '';
	}
	const { x, y, item } = ui.menu;
	const close = (): void => {
		uiOf( ctx ).menu = null;
		ctx.repaint();
	};
	const sortValue = ctx.state.sort || 'default';

	// An action from the menu applies to the whole selection when the
	// clicked item is part of one, to just the item otherwise.
	let targets: number[] = [];
	if ( item ) {
		targets = ctx.state.selected.includes( item.id ) && ctx.state.selected.length > 1
			? ctx.state.selected
			: [ item.id ];
	}
	const allItems = Array.from( ui.pages.values() ).flat();

	let options: MenuOption[] = [];
	if ( item ) {
		const menuActions = resolveActions(
			ctx.data.previewActions,
			actionContext( section, item, 'menu' ),
			shell().hooks,
		);
		options = buildMenuOptions( section, item, menuActions );
		// The SAME filter WP Explorer runs — plugin entries, the
		// agents' "Send to …" rows included, appear here unchanged.
		const merged = shell().hooks?.applyFilters(
			'os.my-wordpress.tile-context-menu',
			options,
			{ entityId: section.id, kind: section.kind, item: item as unknown as Record< string, unknown > },
		);
		if ( Array.isArray( merged ) ) {
			options = withSendToHeading( options, merged as MenuOption[] );
		}
	}

	const pick = ( e: Event ): void => {
		const id = String( ( e as CustomEvent< { id?: string } > ).detail?.id ?? '' );
		close();
		if ( id.startsWith( 'sort:' ) ) {
			ctx.local( 'set-sort', { sort: id.slice( 'sort:'.length ) } );
			void ctx.dispatch( 'sort' );
			return;
		}
		if ( id === 'refresh' ) {
			void ctx.dispatch( 'refresh' );
			return;
		}
		if ( ! item ) {
			return;
		}
		const picked = options.find( ( o ) => o.id === id );
		if ( picked?.onSelect ) {
			// A plugin-injected entry (an agent's "Send to", …) owns
			// its own behaviour.
			picked.onSelect();
			return;
		}
		if ( id === 'open' ) {
			// Posts navigate INTO their detail folder (author,
			// comments, revisions, …); users, media and flat sections
			// (whose rows are not posts) open the pane.
			if ( section.kind === 'post' && ! section.flat ) {
				void ctx.dispatch( 'into', { item: item.id } );
			} else {
				void ctx.dispatch( 'open', { item: item.id } );
			}
		} else if ( id === 'edit' ) {
			// A person's "Edit profile" opens the shared profile
			// window, exactly as the pane's button does; everything
			// else goes to its editor through the server.
			if ( section.kind === 'user' ) {
				openUserEditWindow( item.id, {
					source: 'my-wordpress-app/context-menu',
					fallback: () => void ctx.dispatch( 'edit', { item: item.id } ),
				} );
			} else {
				void ctx.dispatch( 'edit', { item: item.id } );
			}
		} else if ( id === 'quick-edit' ) {
			uiOf( ctx ).quickEdit = {
				ids: targets,
				status: '',
				comments: '',
				author: '',
				sticky: '',
				categories: [],
				tags: [],
			};
			ctx.repaint();
		} else if ( id === 'publish' ) {
			void ctx.dispatch( 'quick-edit', { items: targets, status: 'publish' } );
		} else if ( id === 'copy-link' ) {
			const links = allItems
				.filter( ( i ) => targets.includes( i.id ) )
				.map( ( i ) => i.link )
				.filter( Boolean );
			void navigator.clipboard?.writeText( links.join( '\n' ) );
			ctx.host.toast?.( {
				message: sprintf(
					/* translators: %d: link count. */
					__( 'Copied %d links.' ),
					links.length,
				),
			} );
		} else if ( id === 'trash' ) {
			// Same confirmation as the preview pane's Trash button — an
			// action reached from the menu must not skip the dialog its
			// button twin shows.
			const confirm = {
				message:
					targets.length > 1
						? sprintf(
							/* translators: %d: selected item count. */
							__( 'Move %d items to the Trash?' ),
							targets.length,
						)
						: __( 'Move this to the Trash?' ),
				label: __( 'Trash' ),
				danger: true,
			};
			if ( targets.length > 1 ) {
				void ctx.dispatch( 'bulk-trash', {}, { confirm } );
			} else {
				void ctx.dispatch( 'trash', { item: item.id }, { confirm } );
			}
		} else {
			const action = resolveActions(
				ctx.data.previewActions,
				actionContext( section, item, 'menu' ),
				shell().hooks,
			).find( ( a ) => a.id === id );
			if ( action ) {
				runAction( action, actionContext( section, item, 'menu' ) );
			}
		}
	};
	return html`
		<div
			class="os-mywp__menu-backdrop"
			@click=${ close }
			@contextmenu=${ ( e: Event ) => {
				e.preventDefault();
				close();
			} }
		></div>
		<os-context-menu
			open
			class="os-mywp__menu"
			style="position:fixed;left:${ x }px;top:${ y }px;visibility:hidden"
			@os-context-menu-pick=${ pick }
		>
			${ item
				? options.map( ( o ) => ( o.heading
					? html`<os-context-menu-option heading>${ o.label }</os-context-menu-option>`
					: html`
						<os-context-menu-option
							id=${ o.id }
							icon=${ o.icon ?? '' }
							?danger=${ !! o.danger }
							?disabled=${ !! o.disabled }
						>${ o.label }</os-context-menu-option>
					` ) )
				: html`
					<os-context-menu-option heading>${ __( 'Sort by' ) }</os-context-menu-option>
					${ Object.entries( ctx.data.sortOptions ).map( ( [ value, label ] ) => html`
						<os-context-menu-option id=${ 'sort:' + value } icon=${ value === sortValue ? 'dashicons-yes' : '' }>
							${ label }
						</os-context-menu-option>
					` ) }
					<os-context-menu-option id="refresh" icon="dashicons-update">${ __( 'Refresh' ) }</os-context-menu-option>
				` }
		</os-context-menu>
	`;
}

/** The Edit… quick-edit modal: status + comments over the selection. */
export function renderQuickEdit( ctx: Ctx, section: SectionDef | null ): TemplateResult | '' {
	const ui = uiOf( ctx );
	const qe = ui.quickEdit;
	if ( ! qe || ! section ) {
		return '';
	}
	const close = (): void => {
		ui.quickEdit = null;
		ctx.repaint();
	};
	const apply = (): void => {
		const payload: Record< string, unknown > = { items: qe.ids };
		if ( qe.status ) {
			payload.status = qe.status;
		}
		if ( qe.comments ) {
			payload.comments = qe.comments;
		}
		if ( qe.author ) {
			payload.author = Number( qe.author );
		}
		if ( qe.sticky ) {
			payload.sticky = qe.sticky;
		}
		if ( qe.categories.length > 0 ) {
			payload.categories = qe.categories;
		}
		if ( qe.tags.length > 0 ) {
			// The server takes NAMES and creates what does not exist
			// yet (`wp_set_post_terms` with append) — so a brand-new
			// token never needs an id minted client-side.
			payload.tags = qe.tags.map( ( t ) => t.label ).join( ', ' );
		}
		close();
		void ctx.dispatch( 'quick-edit', payload );
	};
	const noChange: [ string, string ] = [ '', __( '— No change —' ) ];
	const pickInto = ( field: 'status' | 'comments' | 'author' | 'sticky' ) => ( e: Event ): void => {
		qe[ field ] = String( ( e as CustomEvent< { value?: string } > ).detail?.value ?? '' );
	};
	const dropdown = ( label: string, field: 'status' | 'comments' | 'author' | 'sticky', options: Array< [ string, string ] > ): TemplateResult => html`
		<label class="os-mywp__qe-row">
			<span>${ label }</span>
			<os-select value=${ qe[ field ] } @os-pick=${ pickInto( field ) }>
				${ options.map( ( [ value, text ] ) => html`
					<os-option value=${ value } ?selected=${ value === qe[ field ] }>${ text }</os-option>
				` ) }
			</os-select>
		</label>
	`;
	const isPosts = section.post_type === 'post';
	return html`
		<os-modal
			open
			size="sm"
			title=${ sprintf(
				/* translators: 1: entry count, 2: section label. */
				__( 'Edit %1$d %2$s' ),
				qe.ids.length,
				section.label,
			) }
			@os-modal-cancel=${ close }
		>
			<os-notice tone="info" class="os-mywp__qe-notice" not-dismissible>
				${ __(
					'Only the fields you change are applied. Categories and tags are added to what each entry already has.',
				) }
			</os-notice>
			<div class="os-mywp__qe">
				${ dropdown( __( 'Status' ), 'status', [
					noChange,
					[ 'publish', __( 'Published' ) ],
					[ 'pending', __( 'Pending Review' ) ],
					[ 'draft', __( 'Draft' ) ],
					[ 'private', __( 'Private' ) ],
				] ) }
				${ ctx.data.authors.length > 0
					? dropdown( __( 'Author' ), 'author', [
						noChange,
						...ctx.data.authors.map( ( a ): [ string, string ] => [ String( a.id ), a.name ] ),
					] )
					: '' }
				${ dropdown( __( 'Comments' ), 'comments', [
					noChange,
					[ 'open', __( 'Allow' ) ],
					[ 'closed', __( 'Do not allow' ) ],
				] ) }
				${ isPosts
					? dropdown( __( 'Sticky' ), 'sticky', [
						noChange,
						[ 'sticky', __( 'Sticky' ) ],
						[ 'not-sticky', __( 'Not sticky' ) ],
					] )
					: '' }
				${ isPosts && ctx.data.categories.length > 0
					? html`
						<div class="os-mywp__qe-row">
							<span>${ __( 'Add categories' ) }</span>
							<os-category-picker
								.items=${ ctx.data.categories }
								.value=${ qe.categories }
								@os-categories-change=${ ( e: Event ) => {
									// The picker never mutates its own
									// value — the consumer is the truth.
									qe.categories = [
										...( ( e as CustomEvent< { value: number[] } > )
											.detail?.value ?? [] ),
									];
									ctx.repaint();
								} }
							></os-category-picker>
						</div>
					`
					: '' }
				${ isPosts
					? html`
						<div class="os-mywp__qe-row">
							<span>${ __( 'Add tags' ) }</span>
							<os-tag-input
								creatable
								placeholder=${ __( 'Add tags…' ) }
								.value=${ qe.tags }
								.suggestions=${ [] }
								@os-tag-suggest=${ ( e: Event ) => {
									// Suggestions come from the tag list the
									// data payload already holds — filtered
									// here, no request.
									const query = (
										( e as CustomEvent< { query: string } > ).detail
											?.query ?? ''
									).toLowerCase();
									( e.target as HTMLElement & {
										suggestions: Array< { id?: number; label: string } >;
									} ).suggestions = ctx.data.tags
										.filter( ( t ) => t.name.toLowerCase().includes( query ) )
										.map( ( t ) => ( { id: t.id, label: t.name } ) );
								} }
								@os-tag-add=${ ( e: Event ) => {
									const tag = ( e as CustomEvent< {
										tag: { id?: number; label: string };
									} > ).detail?.tag;
									if ( tag && ! qe.tags.some( ( t ) => t.label === tag.label ) ) {
										qe.tags = [ ...qe.tags, tag ];
									}
									ctx.repaint();
								} }
								@os-tag-remove=${ ( e: Event ) => {
									const tag = ( e as CustomEvent< {
										tag: { id?: number; label: string };
									} > ).detail?.tag;
									if ( tag ) {
										qe.tags = qe.tags.filter( ( t ) => t.label !== tag.label );
									}
									ctx.repaint();
								} }
							></os-tag-input>
						</div>
					`
					: '' }
			</div>
			<div slot="footer">
				<os-button variant="ghost" @click=${ close }>${ __( 'Cancel' ) }</os-button>
				<os-button variant="primary" @click=${ apply }>${ __( 'Update' ) }</os-button>
			</div>
		</os-modal>
	`;
}

export function renderZoom( ctx: Ctx ): TemplateResult | '' {
	const ui = uiOf( ctx );
	const detail = ctx.data.detail;
	if ( ! ui.zoom || ! detail?.full ) {
		return '';
	}
	return html`
		<div class="os-mywp__zoom" @click=${ () => {
			ui.zoom = false;
			ctx.repaint();
		} }>
			<img src=${ detail.full } alt=${ detail.title } />
		</div>
	`;
}
