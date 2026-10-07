import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import '../../../src/ui/components/os-avatar/os-avatar';
import '../../../src/ui/components/os-stat/os-stat';
import '../../../src/ui/components/os-checkbox/os-checkbox';
import '../../../src/ui/components/os-action-menu/os-action-menu';
import { applyAvatarSrc, pickAvatarUrl } from '../../../src/ui/util/avatar-resolve';
import { openProfile } from './table';
import type { RoleGroup } from './roles-summary';
import type { ProfileConfig, RowActions, UserListItem } from './types';

export interface PeopleOptions {
	cfg: ProfileConfig;
	actions: RowActions;
	selected: number[];
	select( id: number, selected: boolean ): void;
}
export function recentSignIns( rows: UserListItem[] ): UserListItem[] {
	return rows.filter( ( row ) => typeof row.openstation_last_login === 'number' && row.openstation_last_login > 0 ).sort( ( a, b ) => b.openstation_last_login! - a.openstation_last_login! );
}
const roleLabel = ( role: string, cfg: ProfileConfig ): string => cfg.allRoles?.[ role ] || role || __( 'No role' );
export function avatar( row: UserListItem, size = 48 ): TemplateResult {
	return html`<os-avatar data-people-avatar=${ pickAvatarUrl( row.avatar_urls ) || '' } name=${ row.name } size=${ size } presence=${ row.openstation_presence || '' }></os-avatar>`;
}
function presence( row: UserListItem ): string {
	if ( row.openstation_presence === 'online' ) {
		return __( 'Online now' );
	}
	if ( row.openstation_presence === 'inactive' ) {
		return __( 'Away' );
	}
	return __( 'Offline' );
}
function lastLogin( row: UserListItem ): TemplateResult | string {
	return row.openstation_last_login ? html`<span>${ __( 'Last sign-in' ) } <os-relative-time datetime=${ new Date( row.openstation_last_login * 1000 ).toISOString() }></os-relative-time></span>` : __( 'No sign-in recorded' );
}

function accountMenu( row: UserListItem, cfg: ProfileConfig, actions: RowActions ): TemplateResult {
	return html`<os-action-menu text=${ __( 'Actions' ) } label=${ sprintf( __( 'Actions for %s' ), row.name ) } @os-context-menu-pick=${ ( e: Event ) => {
		const id = ( e as CustomEvent ).detail.id;
		if ( id === 'profile' ) {
			openProfile( row.id, actions );
		}
		if ( ! cfg.canEdit || ! row.openstation_can_edit ) {
			return;
		}
		if ( id === 'reset' ) {
			actions.onSendReset( row );
		}
		if ( id === 'welcome' ) {
			actions.onResendWelcome( row );
		}
	} }>
		<os-context-menu-option data-menu-item-id="profile" icon="dashicons-id">${ __( 'View profile' ) }</os-context-menu-option>
		${ cfg.canEdit && row.openstation_can_edit ? html`
			<os-context-menu-option heading>${ __( 'Account emails' ) }</os-context-menu-option>
			<os-context-menu-option data-menu-item-id="reset" icon="dashicons-lock">${ __( 'Send password reset' ) }</os-context-menu-option>
			<os-context-menu-option data-menu-item-id="welcome" icon="dashicons-email-alt">${ __( 'Resend welcome' ) }</os-context-menu-option>` : '' }
	</os-action-menu>`;
}
function joined( row: UserListItem ): string {
	const date = new Date( row.registered_date || '' );
	return Number.isNaN( date.getTime() ) ? '—' : date.toLocaleDateString( undefined, { month: 'short', year: 'numeric' } );
}
export function peopleCards( rows: UserListItem[], opts: PeopleOptions, tail: TemplateResult, loading: boolean ): TemplateResult {
	const { cfg, actions } = opts;
	const selectable = cfg.canEdit || cfg.canPromote || cfg.canDelete;
	return html`<div class="os-people__cards" aria-label=${ __( 'People directory' ) }>
		${ rows.length ? rows.map( ( row ) => html`<article class="os-people__card ${ opts.selected.includes( row.id ) ? 'is-selected' : '' }" data-person-id=${ row.id }>
			<header class="os-people__id-header"><span class="os-people__issuer"><span class="dashicons dashicons-id-alt" aria-hidden="true"></span> OPENSTATION <span>/ ${ __( 'MEMBER' ) }</span></span>
				${ row.id === cfg.currentUserId ? html`<span class="os-people__you">${ __( 'You' ) }</span>` : '' }
				${ selectable ? html`<os-checkbox class="os-people__select" aria-label=${ sprintf( __( 'Select %s' ), row.name ) } ?checked=${ opts.selected.includes( row.id ) } @os-checkbox-change=${ ( e: Event ) => opts.select( row.id, ( e as CustomEvent ).detail.checked ) }></os-checkbox>` : '' }
			</header>
			<div class="os-people__identity">
				<div class="os-people__portrait">${ avatar( row, 64 ) }<span class="os-people__member-number" title=${ __( 'WordPress user ID' ) }>#${ String( row.id ).padStart( 5, '0' ) }</span></div>
				<div class="os-people__credentials"><h3><os-button variant="ghost" title=${ row.name } @click=${ () => openProfile( row.id, actions ) }>${ row.name || row.slug }</os-button></h3>
					<p class="os-people__handle">@${ row.slug }</p>
					<div class="os-people__roles">${ ( row.roles.length ? row.roles : [ '' ] ).map( ( role ) => html`<span>${ roleLabel( role, cfg ) }</span>` ) }</div>
					<p class="os-people__email" title=${ row.email || '' }>${ row.email || __( 'No email available' ) }</p>
					<p class="os-people__joined">${ __( 'Member since' ) } <time datetime=${ row.registered_date || '' }>${ joined( row ) }</time></p>
				</div>
			</div>
			<div class="os-people__stats" aria-label=${ __( 'Published contributions' ) }>
				<os-stat value=${ String( row.openstation_user_stats?.posts ?? '—' ) } label=${ __( 'Posts' ) }></os-stat>
				<os-stat value=${ String( row.openstation_user_stats?.pages ?? '—' ) } label=${ __( 'Pages' ) }></os-stat>
				<os-stat value=${ String( row.openstation_user_stats?.comments ?? '—' ) } label=${ __( 'Comments' ) }></os-stat>
				<span class="os-people__seal" aria-hidden="true"><span class="dashicons dashicons-admin-users"></span></span>
			</div>
			<footer><span class="os-people__presence" data-presence=${ row.openstation_presence || 'offline' } title=${ __( 'Current presence' ) }>${ presence( row ) }</span><span class="os-people__last-login">${ lastLogin( row ) }</span>${ accountMenu( row, cfg, actions ) }</footer>
		</article>` ) : html`<div class="os-people__empty"><span class="dashicons dashicons-admin-users" aria-hidden="true"></span><h3>${ loading ? __( 'Meeting your people…' ) : __( 'No people match this view.' ) }</h3><p>${ __( 'Try another search, presence or role filter.' ) }</p></div>` }
		${ tail }
	</div>`;
}

export function rolesView( groups: RoleGroup[], choose: ( role: string ) => void ): TemplateResult {
	return html`<div class="os-people__role-grid">${ groups.map( ( group ) => html`<article class="os-people__room">
		<div class="os-people__orbit"><div class="os-people__orbit-center"><strong>${ group.total }</strong><span>${ group.label }</span></div>
		${ group.members.slice( 0, 8 ).map( ( row, index ) => {
			const angle = index / Math.min( group.members.length, 8 ) * Math.PI * 2 - Math.PI / 2;
			return html`<span class="os-people__satellite" style=${ `inset-inline-start:${ 50 + Math.cos( angle ) * 42 }%;inset-block-start:${ 50 + Math.sin( angle ) * 42 }%` } title=${ row.name }>${ avatar( row, 36 ) }</span>`;
		} ) }</div>
		<p>${ group.members.slice( 0, 3 ).map( ( row ) => row.name ).join( ', ' ) }${ group.total > 3 ? '…' : '' }</p>
		<os-button variant="secondary" ?disabled=${ group.total === 0 } @click=${ () => choose( group.role ) }>${ __( 'Meet this group' ) } ↗</os-button>
	</article>` ) }
	${ groups.length ? '' : html`<p class="os-people__empty">${ __( 'No role groups found.' ) }</p>` }
	</div>`;
}

export function syncPeopleControls( root: HTMLElement ): void {
	queueMicrotask( () => {
		root.querySelectorAll< HTMLElement >( '[data-people-avatar]' ).forEach( ( node ) => {
			const src = node.getAttribute( 'data-people-avatar' ) || '';
			if ( node.dataset.avatarResolved !== src ) {
				node.dataset.avatarResolved = src; applyAvatarSrc( node, src );
			}
		} );
		root.querySelectorAll( '.os-people__select, [data-os-users-search]' ).forEach( ( node ) => node.shadowRoot?.querySelector( 'input' )?.setAttribute( 'aria-label', node.getAttribute( 'aria-label' ) || '' ) );
	} );
}
