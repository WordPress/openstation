import {
	__,
	createListTableSync,
	defineApp,
	html,
	sprintf,
	statusControl,
	type ListTableSync,
	type MenuTab,
	type TemplateResult,
	type ViewContext,
} from '@openstation/app';
import type { ListTableLike } from '@openstation/app';
import { ActivitySummary } from './parts/activity-summary';
import { RolesSummary } from './parts/roles-summary';
import { PeopleFeed } from './parts/people-feed';
import { peopleCards, rolesView, syncPeopleControls } from './parts/people';
import '../../src/ui/components/os-progress-bar/os-progress-bar';
import { activityView } from './parts/activity';
import type { ContributionKind } from './parts/activity-model';
import { activityStyles } from './parts/activity.styles';
import { peopleStyles } from './parts/people.styles';
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

const TOAST_MS: Record< string, number | undefined > = { success: 5000, error: 8000, info: undefined };

type Ctx = ViewContext< UsersState, UsersData >;

interface UiState {
	feed: PeopleFeed;
	roles: RolesSummary;
	activity: ActivitySummary;
	view: string;
	contribution: ContributionKind;
	options: boolean;
	cache: UserCellCache;
	sync: ListTableSync< UserListItem >;

	selected: number[];

	rows: Map< number, string >;

	bulkRole: string;

	reassign: { id: number; name: string } | null;

	addForm: AddUserFormSync;
	profileWired: boolean;
}

const freshUi = (): UiState => ( {
	feed: new PeopleFeed(), roles: new RolesSummary(), activity: new ActivitySummary(),
	view: 'people', contribution: 'posts',
	options: false,
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

const menuTabs = ( ctx: Ctx ): MenuTab[] =>
	( ctx.extra as { menuTabs?: MenuTab[] } ).menuTabs ?? [];

const say = ( ctx: Ctx, message: string, duration?: number ): void => {
	ctx.host.toast?.( duration ? { message, duration } : { message } );
};

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

				__( "Set %1$d user(s)' role to %2$s?" ),
				ids.length,
				cfgOf( ctx ).assignableRoles?.[ role ] ?? role,
			),
			label: __( 'Set role' ),
		},
	} );
	if ( ok ) {
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
		message = sprintf( __( 'Remove %d user(s) from this site? Their network account stays.' ), ids.length );
	} else if ( reassign ) {
		message = sprintf( __( 'Permanently delete %1$d user(s)? Their content is attributed to %2$s. This cannot be undone.' ), ids.length, reassign.name );
	} else {
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

function viewerAsReassign( cfg: ProfileConfig ): { id: number; name: string } | null {
	return cfg.currentUserId ? { id: cfg.currentUserId, name: __( 'you' ) } : null;
}

function sendReset( ctx: Ctx, row: UserListItem ): void {
	void ctx.dispatch( 'send-reset', { id: row.id }, {
		confirm: {
			title: __( 'Send password reset email?' ),

			message: sprintf( __( 'WordPress will email %s a password-reset link.' ), row.name ),
			label: __( 'Send reset email' ),
		},
	} );
}

function resendWelcome( ctx: Ctx, row: UserListItem ): void {
	void ctx.dispatch( 'resend-welcome', { id: row.id }, {
		confirm: {
			title: __( 'Resend welcome email?' ),

			message: sprintf( __( 'WordPress will resend the original welcome email to %s.' ), row.name ),
			label: __( 'Resend' ),
		},
	} );
}

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

			__( '%d selected' ),
			ui.selected.length,
		) }</span>
		<os-button variant="ghost" @click=${ () => {
 clearSelection( ctx ); ctx.repaint();
} }>${ __( 'Clear selection' ) }</os-button>
		<span class="os-app-list__bulk-actions" data-os-users-bulk-actions>
			${ cfg.canPromote && Object.keys( assignable ).length > 0
				? html`<span class="os-users__bulk-group">
					<os-select
						class="os-users__bulk-role"
						aria-label=${ __( 'Set role to…' ) }
						.value=${ ui.bulkRole }
						placeholder=${ __( 'Set role to…' ) }
						@os-pick=${ ( e: Event ) => {
							ui.bulkRole = String( ( e as CustomEvent< { value: string } > ).detail?.value ?? '' );
						} }
					>
						<os-option .value=${ '' }>${ __( 'Set role to…' ) }</os-option>
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

function actionsOf( ctx: Ctx ): RowActions {
	return { onSendReset: ( row ) => sendReset( ctx, row ), onResendWelcome: ( row ) => resendWelcome( ctx, row ), toast: ( message ) => say( ctx, message ) };
}

function visiblePeople( ctx: Ctx, ui: UiState ): UserListItem[] {
	return applyStatusFilter( ui.feed.items, ctx.state.status );
}

function filterByRole( ctx: Ctx, role: string ): void {
	ctx.state.role = role === '' ? 'none' : role;
	void ctx.dispatch( 'filter', {} );
}

function listPanel( ctx: Ctx, ui: UiState, phone: boolean, rows: UserListItem[] ): TemplateResult {
	const { state, data } = ctx;
	const cfg = cfgOf( ctx );
	const canAct = cfg.canEdit === true || cfg.canPromote === true || cfg.canDelete === true;
	return html`<os-tabpanel for="all" class="os-app-list__panel" ?hidden=${ state.tab !== 'all' }>
		<header class="os-people__hero"><div><span class="os-people__eyebrow">${ __( 'YOUR COMMUNITY' ) }</span><h2>${ __( 'The people behind it.' ) }</h2><p>${ __( 'Get to know the names. See what everyone brings.' ) }</p></div>
		${ cfg.canCreate ? html`<os-button variant="holo" data-os-users-new os-action="tab" os-arg-value="add-new">+ ${ __( 'Add person' ) }</os-button>` : '' }</header>
		<div class="os-people__tools ${ ui.options ? 'is-expanded' : '' }" data-os-users-toolbar>
			<os-text-field id=${ `${ ctx.windowId }-people-search` } class="os-app-list__search" data-os-users-search type="search" os-bind="search" os-action="filter" os-debounce="250" value=${ state.search } aria-label=${ __( 'Search people' ) } placeholder=${ __( 'Search name, username, email…' ) }></os-text-field>
			<os-button class="os-people__options" variant="secondary" @click=${ () => {
 ui.options = ! ui.options; ctx.repaint();
} }>${ __( 'Options' ) }</os-button>
			<os-select class="os-people__extra" aria-label=${ __( 'Filter by role' ) } os-bind="role" os-action="filter" .value=${ state.role } data-os-users-role>
				<os-option .value=${ '' }>${ __( 'Every role' ) }</os-option><os-option value="none">${ __( 'No role' ) }</os-option>${ Object.entries( cfg.allRoles || {} ).map( ( [ role, label ] ) => html`<os-option value=${ role }>${ label }</os-option>` ) }
			</os-select>
			<os-select class="os-people__extra" aria-label=${ __( 'Directory view' ) } value=${ ui.view } @os-pick=${ ( e: Event ) => {
 ui.view = String( ( e as CustomEvent ).detail.value ); ctx.repaint();
} }><os-option value="people">${ __( 'People cards' ) }</os-option><os-option value="table">${ __( 'Details table' ) }</os-option></os-select>
			<os-select class="os-people__extra" aria-label=${ __( 'Sort people' ) } value=${ `${ state.orderby }:${ state.order }` } @os-pick=${ ( e: Event ) => {
 const [ orderby, order ] = String( ( e as CustomEvent ).detail.value ).split( ':' ); void ctx.dispatch( 'sort', { orderby, order } );
} }><os-option value="name:asc">${ __( 'Name A–Z' ) }</os-option><os-option value="name:desc">${ __( 'Name Z–A' ) }</os-option><os-option value="registered_date:desc">${ __( 'Newest members' ) }</os-option><os-option value="registered_date:asc">${ __( 'Longest standing' ) }</os-option><os-option value="email:asc">${ __( 'Email A–Z' ) }</os-option></os-select>
			<span class="os-people__extra">${ statusControl( { segments: STATUS_SEGMENTS(), value: state.status, bind: 'status', action: 'filter', label: __( 'Filter users' ), phone } ) }</span>
			<os-button class="os-people__extra" variant="ghost" os-action="refresh" data-os-users-refresh>${ __( 'Refresh' ) }</os-button>
		</div>
		${ data.list.error ? html`<os-notice tone="danger">${ __( 'Could not load users. Try Refresh.' ) } ${ data.list.error }</os-notice>` : '' }
		<div class="os-people__scope"><span>${ sprintf( __( '%1$d of %2$d people loaded' ), ui.feed.items.length, data.list.total ) }${ state.status || state.role ? ` · ${ rows.length } ${ __( 'match filters' ) }` : '' }</span>${ state.role ? html`<os-button variant="ghost" data-os-users-clear-role @click=${ () => {
 ctx.state.role = ''; void ctx.dispatch( 'filter', {} );
} }>${ __( 'Clear role' ) }</os-button>` : '' }</div>
		<div class="os-people__card-host" ?hidden=${ ui.view !== 'people' } style="display:flex;flex:1;min-height:0;">${ peopleCards( state.tab === 'all' ? rows : [], { cfg, actions: actionsOf( ctx ), selected: ui.selected, select: ( id, checked ) => {
 if ( checked ) {
 table( ctx )?.select( id );
} else {
 table( ctx )?.deselect( id );
}
} }, ui.feed.tail(), ctx.loading ) }</div>
		<div class="os-app-list__body" data-os-users-body ?hidden=${ ui.view !== 'table' }><os-table data-os-users-table os-preserve selectable=${ canAct ? 'multi' : '' } sticky-header sticky-columns="1" hover striped bordered><div slot="empty" class="os-app-list__empty"><p>${ __( 'No users found.' ) }</p></div></os-table></div>
		${ ui.view === 'table' ? ui.feed.tail() : '' }
		${ bulkActions( ctx, ui, true ) }
	</os-tabpanel>`;
}

function insightsPanel( ctx: Ctx, ui: UiState, tab: 'roles' | 'activity' ): TemplateResult {
	const summary = ui.roles;
	const isRoles = tab === 'roles';
	let scope: string;
	let content: TemplateResult;
	if ( isRoles ) {
		scope = summary.data ? sprintf( __( '%d people across this site. Up to 8 faces per role; people can belong to more than one group.' ), summary.data.total ) : __( 'Gathering your role groups…' );
		content = summary.data ? rolesView( summary.data.groups, ( role ) => {
			ctx.local( 'tab', { value: 'all' } ); filterByRole( ctx, role );
		} ) : html`<p class="os-people__empty" role="status">${ summary.error ? __( 'Role groups are unavailable.' ) : __( 'Loading all roles…' ) }</p>`;
	} else {
		const snapshot = ui.activity.data;
		scope = snapshot ? sprintf( __( '%d people across this site.' ), snapshot.total ) : __( 'Gathering the complete community overview' );
		content = snapshot ? activityView( snapshot, actionsOf( ctx ), cfgOf( ctx ), ui.contribution, ( kind ) => {
			ui.contribution = kind; ctx.repaint();
		} ) : html`<section class="os-community__loading" role="status"><h3>${ ui.activity.error ? __( 'The overview could not load. Use Refresh to retry.' ) : __( 'Bringing everyone together…' ) }</h3></section>`;
	}
	return html`<os-tabpanel for=${ tab } class="os-app-list__panel" ?hidden=${ ctx.state.tab !== tab }>
		<header class="os-people__hero"><div><span class="os-people__eyebrow">${ isRoles ? __( 'A PLACE FOR EVERYONE' ) : __( 'THE HUMAN SIDE OF YOUR SITE' ) }</span><h2>${ isRoles ? __( 'Different roles. One community.' ) : __( 'A community, in motion.' ) }</h2><p>${ isRoles ? __( 'Explore the groups that make your site work.' ) : __( 'The people showing up, joining in, and making things happen.' ) }</p></div></header>
		<div class="os-people__scope"><span>${ scope }</span>
		${ isRoles ? html`<os-button variant="ghost" ?disabled=${ summary.loading } @click=${ () => void summary.load( ctx ) }>${ summary.loading ? __( 'Refreshing…' ) : __( 'Refresh' ) }</os-button>` : html`<os-button variant="ghost" ?disabled=${ ui.activity.loading } @click=${ () => void ui.activity.load( ctx ) }>${ __( 'Refresh' ) }</os-button>` }</div>
		${ ( isRoles ? summary.error : ui.activity.error ) ? html`<os-notice tone="danger">${ __( 'Could not refresh this overview. Try Refresh.' ) }</os-notice>` : '' }
		<div class="os-people__insights">${ content }</div>
	</os-tabpanel>`;
}

export default defineApp< UsersState, UsersData >( APP_ID, {
	local: {

		tab: ( state, args ) => {
			state.tab = String( args.value ?? 'all' );
		},
	},

	placeholder: ( state ) => ( {
		list: { items: [], total: 0, pages: 0, page: state.page, perPage: state.perPage },
	} ),

	view: ( ctx ) => {
		const { state } = ctx;
		const cfg = cfgOf( ctx );
		const ui = ctx.ui( freshUi );
		const phone = isMobileStamped();
		ui.feed.reconcile( ctx );
		const rows = visiblePeople( ctx, ui );
		return html`<div class="os-app-list desktop-mode-users" data-os-users-root><style>${ peopleStyles.cssText }${ activityStyles.cssText }</style>
			<os-tabs value=${ state.tab } os-bind="tab" class="os-app-list__tabs os-users__tabs" label=${ __( 'Users' ) } data-os-users-tabs>
				${ menuTabs( ctx ).map(
					( tab ) => html`<os-tab
						value=${ tab.id }
						data-os-users-tab=${ tab.id }
					>${ tab.label }</os-tab>`,
				) }
			</os-tabs>
			${ listPanel( ctx, ui, phone, rows ) }
			${ insightsPanel( ctx, ui, 'roles' ) }
			${ insightsPanel( ctx, ui, 'activity' ) }
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
		const onModeChange = (): void => ctx.repaint();
		document.addEventListener( 'os-mode-changed', onModeChange );
		return () => {
			document.removeEventListener( 'os-mode-changed', onModeChange );
			ctx.ui( freshUi ).feed.dispose();
			ctx.ui( freshUi ).roles.dispose();
			ctx.ui( freshUi ).activity.dispose();
		};
	},

	updated: ( ctx ) => {
		const ui = ctx.ui( freshUi );
		const { state } = ctx;
		const cfg = cfgOf( ctx );
		ui.addForm = syncAddUserForm( ctx.root, state, ui.addForm );

		const profile = ctx.root.querySelector< OsUserProfile >( 'os-user-profile' );
		if ( profile && ! ui.profileWired ) {
			ui.profileWired = true;
			profile.config = cfg;
			profile.fetch = ctx.fetch;
			profile.toast = ( message, kind ) => say( ctx, message, TOAST_MS[ kind ?? 'info' ] );
		}

		syncPeopleControls( ctx.root );
		ui.roles.update( ctx );
		ui.feed.observe( ctx.root );
		ui.activity.update( ctx );
		if ( state.tab !== 'all' ) {
			return;
		}
		const rows = visiblePeople( ctx, ui );

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

		table( ctx )?.toggleAttribute( 'loading', ctx.loading );
		ui.sync.sync( {
			table: table( ctx ) as unknown as ListTableLike< UserListItem > | null,
			rows,
			listKey: `${ state.perPage }|${ state.search }|${ state.role }|${ state.status }|${ state.orderby }|${ state.order }`,
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

				t.addEventListener( 'os-table-sort-change', ( e: Event ) => {
					const sort = ( e as CustomEvent< { sort: { key: string; direction: 'asc' | 'desc' } | null } > ).detail?.sort;
					void ctx.dispatch( 'sort', {
						orderby: sort ? SORT_KEYS[ sort.key ] ?? 'name' : 'name',
						order: sort?.direction ?? 'asc',
					} );
				} );

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
