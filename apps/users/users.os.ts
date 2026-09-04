/**
 * Users — the client view of the Users app.
 *
 * The tab strip (All users / Add new / Profile), the toolbar (presence
 * segments, search, Add new), the `<os-table>` painted through the
 * cell renderers in `parts/table.ts`, the bulk bar (a role change, a
 * reassign-and-delete) in the toolbar on a desk and along the bottom
 * on a phone, and the pager. The table is a preserved element the
 * framework's `createListTableSync()` keeps in step from `updated()`.
 *
 * The Profile tab hosts `<os-user-profile>` from the companion bundle
 * (`apps/users/profile/`), fed this app's facts, REST access and toast
 * as properties, and pinned to the viewer only while the tab is open.
 *
 * @public
 */

import {
	__,
	createListTableSync,
	defineApp,
	html,
	pager,
	sprintf,
	statusControl,
	type ListTableSync,
	type TemplateResult,
	type ViewContext,
} from '@openstation/app';
import type { ListTableLike } from '@openstation/app';
import { isMobileStamped } from '../../src/mode/stamp';
import type { OsTable } from '../../src/ui/components/os-table/os-table';
import { addUserForm, syncAddUserForm, type AddUserFormSync } from './parts/add-user';
import type { OsUserProfile } from './profile/index';
import {
	SORT_KEYS,
	STATUS_SEGMENTS,
	applyStatusFilter,
	buildColumns,
	forgetRow,
	openProfile,
	rowKey,
	type UserCellCache,
} from './parts/table';
import type { ProfileConfig, RowActions, UserListItem, UsersData, UsersState } from './parts/types';

const APP_ID = 'desktop-mode-users';

/** How long a toast dwells: errors longer, so the reason can be read. */
const TOAST_MS: Record< string, number | undefined > = { success: 5000, error: 8000, info: undefined };

type Ctx = ViewContext< UsersState, UsersData >;

/** Client-only per-window state — none of it may reach the server. */
interface UiState {
	cache: UserCellCache;
	sync: ListTableSync< UserListItem >;
	/** The selected row ids. */
	selected: number[];
	/** What each row last painted as, so only a changed row's cells rebuild. */
	rows: Map< number, string >;
	/** The bulk bar's role pick. */
	bulkRole: string;
	/** Who inherits the content of deleted users (single site). */
	reassign: { id: number; name: string } | null;
	/** The Add User form's last painted answer. */
	addForm: AddUserFormSync;
	profileWired: boolean;
}

const freshUi = (): UiState => ( {
	cache: new Map(),
	sync: createListTableSync< UserListItem >(),
	selected: [],
	rows: new Map(),
	bulkRole: '',
	reassign: null,
	addForm: { created: 0, error: '', field: '' },
	profileWired: false,
} );

const table = ( ctx: Ctx ): OsTable< UserListItem > | null =>
	ctx.root.querySelector< OsTable< UserListItem > >( '[data-os-users-table]' );

const cfgOf = ( ctx: Ctx ): ProfileConfig => ctx.extra as ProfileConfig;

const say = ( ctx: Ctx, message: string, duration?: number ): void => {
	ctx.host.toast?.( duration ? { message, duration } : { message } );
};

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
	const cfg = cfgOf( ctx );
	const ui = ctx.ui( freshUi );
	const multisite = cfg.isMultisite === true;
	const reassign = multisite ? null : ui.reassign ?? viewerAsReassign( cfg );
	let message: string;
	if ( multisite ) {
		// translators: %d is a user count.
		message = sprintf( __( 'Remove %d user(s) from this site? Their network account stays.' ), ids.length );
	} else if ( reassign ) {
		// translators: %1$d is a user count, %2$s is a user name.
		message = sprintf( __( 'Permanently delete %1$d user(s)? Their content is attributed to %2$s. This cannot be undone.' ), ids.length, reassign.name );
	} else {
		// translators: %d is a user count.
		message = sprintf( __( 'Permanently delete %d user(s)? Their content is deleted too. This cannot be undone.' ), ids.length );
	}
	const ok = await ctx.dispatch( 'bulk-delete', { ids, reassign: reassign?.id ?? 0 }, {
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

/** The viewer, the default heir of deleted users' content — as wp-admin proposes. */
function viewerAsReassign( cfg: ProfileConfig ): { id: number; name: string } | null {
	return cfg.currentUserId ? { id: cfg.currentUserId, name: __( 'you' ) } : null;
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

/** Who deleted users' content goes to: a picker over the site's users, defaulting to the viewer. */
function reassignPicker( ctx: Ctx, ui: UiState, ids: number[] ): TemplateResult {
	const chosen = ui.reassign ?? viewerAsReassign( cfgOf( ctx ) );
	return html`<span class="os-users__reassign">
		<span class="os-users__reassign-label">${ __( 'Attribute content to' ) }</span>
		<strong class="os-users__reassign-name">${ chosen ? chosen.name : '—' }</strong>
		<os-user-search
			class="os-users__reassign-search"
			placeholder=${ __( 'Change…' ) }
			exclude=${ ids.join( ',' ) }
			@os-user-pick=${ ( e: Event ) => {
				const user = ( e as CustomEvent< { user: { id: number; name: string } } > ).detail?.user;
				if ( user ) {
					ui.reassign = { id: user.id, name: user.name };
					ctx.repaint();
				}
			} }
		></os-user-search>
	</span>`;
}

/**
 * The selection's actions: the count, the role change (for a viewer
 * who can promote, with roles to assign), the reassign picker and
 * Delete (for one who can delete). In the toolbar on a desk; a bar
 * along the bottom on a phone.
 */
function bulkActions( ctx: Ctx, ui: UiState, phone: boolean ): TemplateResult {
	const cfg = cfgOf( ctx );
	const assignable = cfg.assignableRoles ?? {};
	const selecting = ui.selected.length > 0;
	return html`<div
		class="os-app-list__toolbar-right ${ phone ? 'os-app-list__bulk--footer' : '' }"
		data-os-users-bulk
		?hidden=${ ! selecting }
	>
		<span class="os-app-list__count" data-os-users-count>${ sprintf(
			// translators: %d is a count of selected users.
			__( '%d selected' ),
			ui.selected.length,
		) }</span>
		<span class="os-app-list__bulk-actions" data-os-users-bulk-actions>
			${ cfg.canPromote && Object.keys( assignable ).length > 0
				? html`<span class="os-users__bulk-group">
					<os-select
						class="os-users__bulk-role"
						aria-label=${ __( 'Set role to…' ) }
						value=${ ui.bulkRole }
						@os-pick=${ ( e: Event ) => {
							ui.bulkRole = String( ( e as CustomEvent< { value: string } > ).detail?.value ?? '' );
						} }
					>
						<os-option value="">${ __( 'Set role to…' ) }</os-option>
						${ Object.entries( assignable ).map( ( [ slug, label ] ) => html`<os-option value=${ slug }>${ label }</os-option>` ) }
					</os-select>
					<os-button variant="primary" @click=${ () => void applyBulkRole( ctx ) }>${ __( 'Apply' ) }</os-button>
				</span>`
				: '' }
			${ cfg.canDelete
				? html`<span class="os-users__bulk-group">
					${ cfg.isMultisite ? '' : reassignPicker( ctx, ui, ui.selected ) }
					<os-button variant="danger" @click=${ () => void deleteSelected( ctx ) }>
						<span class="dashicons dashicons-trash" aria-hidden="true"></span>
						${ cfg.isMultisite ? __( 'Remove from site' ) : __( 'Delete' ) }
					</os-button>
				</span>`
				: '' }
		</span>
	</div>`;
}

function pagerSummary( ctx: Ctx, rows: UserListItem[] ): string {
	const { state, data } = ctx;
	const list = data.list;
	if ( state.status ) {
		// A client-side slice of one page: the server's totals would
		// describe rows the filter hid.
		return sprintf(
			// translators: %1$d is the matching row count, %2$d the page's row count.
			__( '%1$d of %2$d on this page match' ),
			rows.length,
			list.items.length,
		);
	}
	// translators: %1$d current page, %2$d total pages, %3$d total rows.
	return sprintf( __( 'Page %1$d of %2$d · %3$d users' ), list.page, Math.max( 1, list.pages ), list.total );
}

function listPanel( ctx: Ctx, ui: UiState, phone: boolean, rows: UserListItem[] ): TemplateResult {
	const { state, data } = ctx;
	const cfg = cfgOf( ctx );
	const list = data.list;
	const canAct = cfg.canEdit === true || cfg.canPromote === true || cfg.canDelete === true;
	return html`<os-tabpanel for="all" class="os-app-list__panel" ?hidden=${ state.tab !== 'all' }>
		<header class="os-app-list__toolbar" data-os-users-toolbar>
			<div class="os-app-list__toolbar-left">
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
					data-os-users-search
					type="search"
					os-bind="search"
					os-action="filter"
					os-debounce="250"
					placeholder=${ __( 'Search name, username, email…' ) }
				></os-text-field>
			</div>
			${ phone ? '' : bulkActions( ctx, ui, false ) }
			<div class="os-app-list__toolbar-trailing">
				<os-button variant="ghost" os-action="refresh" data-os-users-refresh title=${ __( 'Refresh' ) }>
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
				</os-button>
				${ cfg.canCreate
					? html`<os-button variant="primary" data-os-users-new os-action="tab" os-arg-value="add-new">
						<span class="dashicons dashicons-plus" aria-hidden="true"></span>
						${ __( 'Add new' ) }
					</os-button>`
					: '' }
			</div>
		</header>
		<div class="os-app-list__body" data-os-users-body>
			${ list.error
				? html`<os-notice tone="danger">${ __( 'Could not load users. Try Refresh.' ) } ${ list.error }</os-notice>`
				: html`<os-table
					data-os-users-table
					os-preserve
					selectable=${ canAct ? 'multi' : '' }
					sticky-header
					sticky-columns="1"
					hover
					striped
					bordered
				>
					<div slot="empty" class="os-app-list__empty">
						<span class="dashicons dashicons-admin-users" aria-hidden="true"></span>
						<p>${ __( 'No users found.' ) }</p>
						<p class="os-app-list__empty-hint">${ __( 'Try a different search or change the role filter.' ) }</p>
					</div>
				</os-table>` }
		</div>
		${ phone ? bulkActions( ctx, ui, true ) : '' }
		${ pager( {
			page: list.page,
			pages: list.pages,
			perPage: state.perPage,
			summary: pagerSummary( ctx, rows ),
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
		const rows = applyStatusFilter( ctx.data.list.items, state.status );
		return html`<div class="os-app-list desktop-mode-users" data-os-users-root>
			<os-tabs value=${ state.tab } os-bind="tab" class="os-app-list__tabs os-users__tabs" label=${ __( 'Users' ) } data-os-users-tabs>
				<os-tab value="all">${ __( 'All users' ) }</os-tab>
				${ cfg.canCreate ? html`<os-tab value="add-new">${ __( 'Add new' ) }</os-tab>` : '' }
				<os-tab value="edit" data-os-users-edit-tab>${ __( 'Profile' ) }</os-tab>
			</os-tabs>
			${ listPanel( ctx, ui, phone, rows ) }
			${ cfg.canCreate
				? html`<os-tabpanel for="add-new" class="os-users__add-panel" ?hidden=${ state.tab !== 'add-new' }>
					${ addUserForm( cfg, ( message ) => say( ctx, message ) ) }
				</os-tabpanel>`
				: '' }
			<os-tabpanel for="edit" class="os-users__edit-panel" ?hidden=${ state.tab !== 'edit' }>
				<os-user-profile
					os-preserve
					data-os-user-profile-self
					user-id=${ state.tab === 'edit' && cfg.currentUserId ? String( cfg.currentUserId ) : '' }
				></os-user-profile>
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
		const cfg = cfgOf( ctx );
		ui.addForm = syncAddUserForm( ctx.root, state, ui.addForm );

		// The Profile tab's element takes this app's facts, REST access
		// and toast as properties — once; the attribute drives the rest.
		const profile = ctx.root.querySelector< OsUserProfile >( 'os-user-profile' );
		if ( profile && ! ui.profileWired ) {
			ui.profileWired = true;
			profile.config = cfg;
			profile.fetch = ctx.fetch;
			profile.toast = ( message, kind ) => say( ctx, message, TOAST_MS[ kind ?? 'info' ] );
		}

		const rows = applyStatusFilter( data.list.items, state.status );
		// Only a changed row's cells rebuild; the fingerprint is the sum.
		const next = new Map( rows.map( ( row ) => [ row.id, rowKey( row ) ] ) );
		for ( const [ id, key ] of next ) {
			if ( ui.rows.get( id ) !== key ) {
				forgetRow( ui.cache, id );
			}
		}
		for ( const id of ui.rows.keys() ) {
			if ( ! next.has( id ) ) {
				forgetRow( ui.cache, id );
			}
		}
		ui.rows = next;

		const actions: RowActions = {
			onSendReset: ( row ) => sendReset( ctx, row ),
			onResendWelcome: ( row ) => resendWelcome( ctx, row ),
			toast: ( message ) => say( ctx, message ),
		};
		ui.sync.sync( {
			table: table( ctx ) as unknown as ListTableLike< UserListItem > | null,
			rows,
			listKey: `${ state.page }|${ state.perPage }|${ state.search }|${ state.status }|${ state.orderby }|${ state.order }`,
			fingerprint: Array.from( next.values() ).join( '\n' ),
			columns: ( phone ) => buildColumns( ui.cache, cfg, actions, phone ),
			wire: ( el ) => {
				const t = el as unknown as OsTable< UserListItem >;
				t.getRowId = ( row ) => row.id;
				t.sort = { key: 'identity', direction: state.order === 'desc' ? 'desc' : 'asc' };
				t.addEventListener( 'os-table-selection-change', () => {
					ui.selected = selectedIds( ctx );
					ctx.repaint();
				} );
				// A sortable header: the collection sorts server-side.
				t.addEventListener( 'os-table-sort-change', ( e: Event ) => {
					const sort = ( e as CustomEvent< { sort: { key: string; direction: 'asc' | 'desc' } | null } > ).detail?.sort;
					void ctx.dispatch( 'sort', {
						orderby: sort ? SORT_KEYS[ sort.key ] ?? 'name' : 'name',
						order: sort?.direction ?? 'asc',
					} );
				} );
				// Whole-row click → the User Edit window on THAT user (cells
				// marked `data-noclick` keep their own behaviour).
				t.addEventListener( 'os-table-row-click', ( e: Event ) => {
					const id = ( e as CustomEvent< { row?: UserListItem } > ).detail?.row?.id;
					if ( typeof id === 'number' && id > 0 ) {
						openProfile( id, actions );
					}
				} );
			},
			onSelection: ( kept ) => {
				ui.selected = kept.map( Number );
				queueMicrotask( () => ctx.repaint() );
			},
		} );
	},
} );
