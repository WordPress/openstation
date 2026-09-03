/**
 * Users — the client view of the Users app.
 *
 * The 1:1 rebuild of the legacy Users window's body: the same tab
 * strip (All users / Add new / Profile), toolbar, `<os-table>` painted
 * through the cell renderers in `parts/table.ts`, bulk bar, pager and
 * phone layout. What the framework absorbed: the REST client and its
 * config blob (actions + `data()` + `ctx.extra`), the pager and
 * status-control wiring (`pager()` / `statusControl()`), the
 * `os.user.changed` subscription (`watch( 'user' )`), and the
 * hand-built toolbar wiring — the view is a function of state.
 *
 * `<os-user-profile>` (`parts/os-user-profile.ts`) is the whole
 * profile surface, shared with the User Edit app; the Profile tab
 * pins it to the viewer, a row click opens the User Edit window on
 * someone else through the shared door in `src/open-targets/`.
 *
 * @public
 */

import {
	__,
	defineApp,
	html,
	pager,
	sprintf,
	statusControl,
	type TemplateResult,
	type ViewContext,
} from '@openstation/app';
import { isMobileStamped } from '../../src/mode/stamp';
import { stackOnPhone } from '../../src/ui/components/os-table/stack-on-phone';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import { addUserForm, syncAddUserForm } from './parts/add-user';
import './parts/os-user-profile';
import {
	STATUS_SEGMENTS,
	applyStatusFilter,
	buildColumns,
	forgetRow,
	openProfile,
	type UserCellCache,
} from './parts/table';
import type { ProfileConfig, UserListItem, UsersData, UsersState } from './parts/types';

const APP_ID = 'desktop-mode-users';

type Ctx = ViewContext< UsersState, UsersData >;

/** Client-only per-window state — none of it may reach the server. */
interface UiState {
	cache: UserCellCache;
	/** The selected row ids. */
	selected: number[];
	/** page|perPage|search|status — a change clears the selection. */
	listKey: string;
	/** Per-row change detection, so only a changed row's cells rebuild. */
	rows: Map< number, string >;
	/** Whether the columns were last built for a phone (`null`: not yet). */
	phoneColumns: boolean | null;
	wired: boolean;
	/** The bulk bar's role pick. */
	bulkRole: string;
	/** The `created` counter the Add User form was last reset for. */
	createdPainted: number;
}

const freshUi = (): UiState => ( {
	cache: new Map(),
	selected: [],
	listKey: '',
	rows: new Map(),
	phoneColumns: null,
	wired: false,
	bulkRole: '',
	createdPainted: 0,
} );

const table = ( ctx: Ctx ): OsTable< UserListItem > | null =>
	ctx.root.querySelector< OsTable< UserListItem > >( '[data-os-posts-table]' );

const cfgOf = ( ctx: Ctx ): ProfileConfig => ctx.extra as ProfileConfig;

/** The selection at CLICK time, so the confirm count and the payload describe one set. */
function selectedIds( ctx: Ctx ): number[] {
	return Array.from( table( ctx )?.selection ?? [] ).map( ( id ) => Number( id ) ).filter( ( id ) => id > 0 );
}

function clearSelection( ctx: Ctx ): void {
	table( ctx )?.clearSelection();
	ctx.ui( freshUi ).selected = [];
}

async function applyBulkRole( ctx: Ctx ): Promise< void > {
	const ui = ctx.ui( freshUi );
	const role = ui.bulkRole;
	const ids = selectedIds( ctx );
	if ( ! role || ids.length === 0 ) {
		return;
	}
	const ok = await ctx.dispatch( 'bulk-role', { ids, role }, {
		confirm: {
			title: __( 'Change role for selected users?' ),
			message: sprintf(
				// translators: %1$d is a user count, %2$s is a role label.
				__( "Set %1$d user(s)' role to %2$s?" ),
				ids.length,
				cfgOf( ctx ).assignableRoles?.[ role ] ?? role,
			),
			label: __( 'Set role' ),
		},
	} );
	if ( ok ) {
		// Drop the selection so a second Apply can't silently re-target
		// the same (possibly now off-page) set.
		clearSelection( ctx );
	}
}

async function deleteSelected( ctx: Ctx ): Promise< void > {
	const ids = selectedIds( ctx );
	if ( ids.length === 0 ) {
		return;
	}
	const multisite = cfgOf( ctx ).isMultisite === true;
	let message: string;
	if ( multisite ) {
		// translators: %d is a user count.
		message = sprintf( __( 'Remove %d user(s) from this site? Their network account stays.' ), ids.length );
	} else {
		// translators: %d is a user count.
		message = sprintf( __( 'Permanently delete %d user(s)? Their content is deleted too. This cannot be undone.' ), ids.length );
	}
	const ok = await ctx.dispatch( 'bulk-delete', { ids }, {
		confirm: {
			title: multisite ? __( 'Remove selected users from this site?' ) : __( 'Delete selected users?' ),
			message,
			label: multisite ? __( 'Remove' ) : __( 'Delete' ),
			danger: true,
		},
	} );
	if ( ok ) {
		clearSelection( ctx );
	}
}

function sendReset( ctx: Ctx, row: UserListItem ): void {
	void ctx.dispatch( 'send-reset', { id: row.id }, {
		confirm: {
			title: __( 'Send password reset email?' ),
			// translators: %s is a user name.
			message: sprintf( __( 'WordPress will email %s a password-reset link.' ), row.name ),
			label: __( 'Send reset email' ),
		},
	} );
}

function resendWelcome( ctx: Ctx, row: UserListItem ): void {
	void ctx.dispatch( 'resend-welcome', { id: row.id }, {
		confirm: {
			title: __( 'Resend welcome email?' ),
			// translators: %s is a user name.
			message: sprintf( __( 'WordPress will resend the original welcome email to %s.' ), row.name ),
			label: __( 'Resend' ),
		},
	} );
}

/**
 * The selection's actions: the count, the role change (for a viewer
 * who can promote, with roles to assign) and Delete (for one who can
 * delete). In the toolbar on a desk; a bar along the bottom on a phone.
 */
function bulkActions( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	const cfg = cfgOf( ctx );
	const assignable = cfg.assignableRoles ?? {};
	const selecting = ui.selected.length > 0;
	return html`<div
		class="os-app-list__toolbar-right os-posts__toolbar-right ${ phone ? 'os-app-list__bulk--footer' : '' }"
		data-os-posts-bulk
		?hidden=${ ! selecting }
	>
		<span class="os-app-list__count os-posts__count" data-os-posts-count>${ sprintf(
			// translators: %d is a count of selected users.
			__( '%d selected' ),
			ui.selected.length,
		) }</span>
		<span class="os-app-list__bulk-actions os-posts__bulk-actions" data-os-posts-bulk-actions>
			${ cfg.canPromote && Object.keys( assignable ).length > 0
				? html`<span style="display:inline-flex;align-items:center;gap:6px;">
					<select
						class="os-users__bulk-role"
						aria-label=${ __( 'Set role to…' ) }
						@change=${ ( e: Event ) => {
							ui.bulkRole = ( e.currentTarget as HTMLSelectElement ).value;
						} }
					>
						<option value="">${ __( 'Set role to…' ) }</option>
						${ Object.entries( assignable ).map(
							( [ slug, label ] ) => html`<option value=${ slug }>${ label }</option>`,
						) }
					</select>
					<os-button variant="primary" @click=${ () => void applyBulkRole( ctx ) }>${ __( 'Apply' ) }</os-button>
				</span>`
				: '' }
			${ cfg.canDelete
				? html`<os-button variant="danger" @click=${ () => void deleteSelected( ctx ) }>
					<span class="dashicons dashicons-trash" aria-hidden="true"></span>
					${ cfg.isMultisite ? __( 'Remove from site' ) : __( 'Delete' ) }
				</os-button>`
				: '' }
		</span>
	</div>`;
}

function listPanel( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	const { state, data } = ctx;
	const cfg = cfgOf( ctx );
	const list = data.list;
	const canAct = cfg.canEdit === true || cfg.canPromote === true || cfg.canDelete === true;
	return html`<os-tabpanel for="all" class="os-app-list__panel os-posts__panel" ?hidden=${ state.tab !== 'all' }>
		<header class="os-app-list__toolbar os-posts__toolbar" data-os-posts-toolbar>
			<div class="os-app-list__toolbar-left os-posts__toolbar-left">
				${ statusControl( {
					segments: STATUS_SEGMENTS(),
					value: state.status,
					bind: 'status',
					action: 'filter',
					label: __( 'Filter users' ),
					phone,
				} ) }
				<os-text-field
					class="os-app-list__search"
					data-os-posts-search
					type="search"
					os-bind="search"
					os-action="filter"
					os-debounce="250"
					placeholder=${ __( 'Search name, username, email…' ) }
				></os-text-field>
			</div>
			${ phone ? '' : bulkActions( ctx, ui, false ) }
			<div class="os-app-list__toolbar-trailing os-posts__toolbar-trailing">
				<os-button variant="ghost" os-action="refresh" data-os-posts-refresh title=${ __( 'Refresh' ) }>
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
				${ cfg.canCreate
					? html`<os-button variant="primary" data-os-posts-new os-action="tab" os-arg-value="add-new">
						<span class="dashicons dashicons-plus" aria-hidden="true"></span>
						${ __( 'Add new' ) }
					</os-button>`
					: '' }
			</div>
		</header>
		<div class="os-app-list__body os-posts__body" data-os-posts-body>
			${ list.error
				? html`<os-notice tone="danger">${ __( 'Could not load users. Try Refresh.' ) } ${ list.error }</os-notice>`
				: html`<os-table
					data-os-posts-table
					os-preserve
					selectable=${ canAct ? 'multi' : '' }
					sticky-header
					sticky-columns="1"
					hover
					striped
					bordered
				>
					<div slot="empty" class="os-app-list__empty os-posts__empty">
						<span class="dashicons dashicons-admin-users" aria-hidden="true"></span>
						<p>${ __( 'No users found.' ) }</p>
						<p class="os-app-list__empty-hint os-posts__empty-hint">${ __( 'Try a different search or change the role filter.' ) }</p>
					</div>
				</os-table>` }
		</div>
		${ phone ? bulkActions( ctx, ui, true ) : '' }
		${ pager( {
			page: list.page,
			pages: list.pages,
			perPage: state.perPage,
			summary: sprintf(
				// translators: %1$d current page, %2$d total pages, %3$d total rows.
				__( 'Page %1$d of %2$d · %3$d users' ),
				list.page,
				Math.max( 1, list.pages ),
				list.total,
			),
			labels: { previous: __( 'Previous' ), next: __( 'Next' ), perPage: __( 'Per page' ) },
		} ) }
	</os-tabpanel>`;
}

export default defineApp< UsersState, UsersData >( APP_ID, {
	local: {
		// The tab strip and the toolbar's Add new: never a request.
		tab: ( state, args ) => {
			state.tab = String( args.value ?? 'all' );
		},
	},

	view: ( ctx ) => {
		const { state } = ctx;
		const cfg = cfgOf( ctx );
		const ui = ctx.ui( freshUi );
		const phone = isMobileStamped();
		return html`<div class="os-app-list desktop-mode-posts desktop-mode-users" data-os-posts-root>
			<os-tabs
				value=${ state.tab }
				os-bind="tab"
				class="os-app-list__tabs os-users__tabs"
				label=${ __( 'Users' ) }
				data-os-users-tabs
			>
				<os-tab value="all">${ __( 'All users' ) }</os-tab>
				${ cfg.canCreate ? html`<os-tab value="add-new">${ __( 'Add new' ) }</os-tab>` : '' }
				<os-tab value="edit" data-os-users-edit-tab>${ __( 'Profile' ) }</os-tab>
			</os-tabs>
			${ listPanel( ctx, ui, phone ) }
			${ cfg.canCreate
				? html`<os-tabpanel for="add-new" class="os-users__add-panel" ?hidden=${ state.tab !== 'add-new' }>
					${ addUserForm( cfg ) }
				</os-tabpanel>`
				: '' }
			<os-tabpanel for="edit" class="os-users__edit-panel" ?hidden=${ state.tab !== 'edit' }>
				<os-user-profile os-preserve data-os-user-profile-self user-id=${ cfg.currentUserId ?? '' }></os-user-profile>
			</os-tabpanel>
		</div>`;
	},

	mounted: ( ctx ) => {
		// The view reads the shell's mode stamp (the bulk bar's place,
		// the picker, the cards); a crossing between the desk and the
		// phone band is the one change that repaints nothing on its own.
		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		return () => {
			document.removeEventListener( 'os-mode-changed', onModeChange );
		};
	},

	updated: ( ctx ) => {
		const ui = ctx.ui( freshUi );
		const { state, data } = ctx;
		ui.createdPainted = syncAddUserForm( ctx.root, state, ui.createdPainted );

		const el = table( ctx );
		if ( ! el ) {
			return;
		}
		// A card per row on a phone, and the columns built for it.
		const phone = stackOnPhone( el );
		if ( phone !== ui.phoneColumns ) {
			ui.phoneColumns = phone;
			el.columns = buildColumns(
				ui.cache,
				cfgOf( ctx ),
				{
					onSendReset: ( row ) => sendReset( ctx, row ),
					onResendWelcome: ( row ) => resendWelcome( ctx, row ),
				},
				phone,
			);
		}
		if ( ! ui.wired ) {
			ui.wired = true;
			el.getRowId = ( row ) => row.id;
			el.sort = { key: 'name', direction: 'asc' };
			el.addEventListener( 'os-table-selection-change', () => {
				ui.selected = selectedIds( ctx );
				ctx.repaint();
			} );
			// Whole-row click → the User Edit window on THAT user (cells
			// marked `data-noclick` keep their own behaviour).
			el.addEventListener( 'os-table-row-click', ( e: Event ) => {
				const id = ( e as CustomEvent< { row?: UserListItem } > ).detail?.row?.id;
				if ( typeof id === 'number' && id > 0 ) {
					openProfile( id );
				}
			} );
		}
		// A query change replaces the result set — ids picked under the
		// previous view must not ride into the next bulk action.
		const listKey = `${ state.page }|${ state.perPage }|${ state.search }|${ state.status }`;
		if ( listKey !== ui.listKey ) {
			ui.listKey = listKey;
			if ( ( el.selection?.size ?? 0 ) > 0 ) {
				el.clearSelection();
			}
			ui.selected = [];
		}
		// Assign the rows only when something changed, and rebuild only
		// the cells of the rows that did — a profile saved elsewhere
		// repaints its row without flickering the rest.
		const rows = applyStatusFilter( data.list.items, state.status );
		const next = new Map( rows.map( ( row ) => [ row.id, JSON.stringify( row ) ] ) );
		let changed = next.size !== ui.rows.size;
		for ( const [ id, json ] of next ) {
			if ( ui.rows.get( id ) !== json ) {
				changed = true;
				forgetRow( ui.cache, id );
			}
		}
		for ( const id of ui.rows.keys() ) {
			if ( ! next.has( id ) ) {
				changed = true;
				forgetRow( ui.cache, id );
			}
		}
		if ( changed ) {
			ui.rows = next;
			el.data = rows;
			const kept = selectedIds( ctx ).filter( ( id ) => next.has( id ) );
			if ( kept.length !== ( el.selection?.size ?? 0 ) ) {
				el.selection = kept;
				ui.selected = kept;
			}
		}
	},
} );
