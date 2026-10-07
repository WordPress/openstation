import { __, html, sprintf, type TemplateResult } from '@openstation/app';
import '../../../src/ui/components/os-histogram/os-histogram';
import '../../../src/ui/components/os-segmented/os-segmented';
import { avatar } from './people';
import { openProfile } from './table';
import { activityModel, contribution, contributors, type ContributionKind, type ActivitySnapshot } from './activity-model';
import type { ProfileConfig, RowActions, UserListItem } from './types';

const number = ( value: number ): string => value.toLocaleString();
const kindLabel = ( kind: ContributionKind ): string => ( { posts: __( 'Posts' ), pages: __( 'Pages' ), comments: __( 'Comments' ) } )[ kind ];
function person( row: UserListItem, actions: RowActions ): TemplateResult {
	return html`<os-button variant="ghost" class="os-community__person" @click=${ () => openProfile( row.id, actions ) }>${ row.name || row.slug }</os-button>`;
}
function metric( value: string, label: string, note: string, icon: string ): TemplateResult {
	return html`<article class="os-community__metric"><span class="dashicons ${ icon }" aria-hidden="true"></span><strong>${ value }</strong><div><h3>${ label }</h3><p>${ note }</p></div></article>`;
}
export function activityView( rows: UserListItem[] | ActivitySnapshot, actions: RowActions, cfg: ProfileConfig, kind: ContributionKind, pick: ( value: ContributionKind ) => void ): TemplateResult {
	const model = Array.isArray( rows ) ? { ...activityModel( rows ), total: rows.length, onlineCount: rows.filter( ( r ) => r.openstation_presence === 'online' ).length, awayCount: rows.filter( ( r ) => r.openstation_presence === 'inactive' ).length } : rows;
	const ranked = Array.isArray( rows ) ? contributors( rows, kind ) : rows.leaders[ kind ];
	const top = ranked[ 0 ];
	const present = [ ...model.online, ...model.away ];
	const max = top ? contribution( top, kind ) : 1;
	const published = model.totals.posts + model.totals.pages;
	return html`<div class="os-community">
		<div class="os-community__metrics" aria-label=${ __( 'Community overview' ) }>
			${ metric( number( model.onlineCount ), __( 'Online now' ), sprintf( __( '%d away at last refresh' ), model.awayCount ), 'dashicons-admin-users' ) }
			${ metric( number( model.recent ), __( 'New accounts' ), __( 'Registered in the last 30 days' ), 'dashicons-welcome-add-page' ) }
			${ metric( number( model.active30 ), __( 'Checked in' ), __( 'Latest sign-in within 30 days' ), 'dashicons-clock' ) }
			${ metric( model.known ? number( model.contributors ) : '—', __( 'Contributors' ), __( 'Published work or approved comments' ), 'dashicons-edit' ) }
		</div>
		<div class="os-community__grid">
			<section class="os-community__panel os-community__work">
				<header><div><span class="os-community__eyebrow">${ __( 'MADE BY YOUR PEOPLE' ) }</span><h3>${ __( 'The work we share' ) }</h3></div><span class="os-community__stamp" aria-hidden="true">↗</span></header>
				<div class="os-community__totals"><div><strong>${ model.known ? number( published ) : '—' }</strong><span>${ __( 'published pieces' ) }</span></div><p>${ sprintf( __( '%1$s posts · %2$s pages · %3$s approved comments' ), model.known ? number( model.totals.posts ) : '—', model.known ? number( model.totals.pages ) : '—', model.known ? number( model.totals.comments ) : '—' ) }</p></div>
				<os-segmented label=${ __( 'Rank contributions by' ) } value=${ kind } @os-pick=${ ( e: Event ) => {
					const value = ( e as CustomEvent ).detail.value;
					if ( [ 'posts', 'pages', 'comments' ].includes( value ) ) {
						pick( value );
					}
				} }>${ ( [ 'posts', 'pages', 'comments' ] as const ).map( ( value ) => html`<os-segment value=${ value }>${ kindLabel( value ) }</os-segment>` ) }</os-segmented>
				${ top ? html`<div class="os-community__spotlight">${ avatar( top, 58 ) }<div><span class="os-community__eyebrow">${ __( 'LEADING THIS COMMUNITY' ) }</span>${ person( top, actions ) }<p>${ top.roles.map( ( role ) => cfg.allRoles?.[ role ] || role ).join( ' · ' ) }</p></div><strong>${ number( contribution( top, kind ) ) }<small>${ kindLabel( kind ) }</small></strong></div>` : html`<p class="os-community__empty">${ __( 'No contributions of this kind yet.' ) }</p>` }
				<ol class="os-community__leaders" start="2">${ ranked.slice( 1, 6 ).map( ( row, index ) => html`<li><span class="os-community__rank">${ index + 2 }</span>${ avatar( row, 30 ) }<div>${ person( row, actions ) }<div class="os-community__track" aria-hidden="true"><i style=${ `inline-size:${ contribution( row, kind ) / max * 100 }%` }></i></div></div><strong>${ number( contribution( row, kind ) ) }</strong></li>` ) }</ol>
				<p class="os-community__footnote">${ __( 'All-time published work and approved comments.' ) }${ model.known < model.total ? ` ${ sprintf( __( 'Content counts are unavailable for %d profiles.' ), model.total - model.known ) }` : '' }</p>
			</section>
			<section class="os-community__panel os-community__presence-panel">
				<header><div><span class="os-community__eyebrow">${ __( 'AT LAST REFRESH' ) }</span><h3>${ __( 'Around the station' ) }</h3></div><span class="os-community__status-dot" data-online=${ model.onlineCount > 0 } aria-hidden="true"></span></header>
				<div class="os-community__presence-summary"><strong>${ number( model.onlineCount + model.awayCount ) }</strong><p>${ __( 'online or away' ) }<span>${ sprintf( __( '%1$d online · %2$d away' ), model.onlineCount, model.awayCount ) }</span></p></div>
				<div class="os-community__present">${ present.slice( 0, 6 ).map( ( row ) => html`<div>${ avatar( row, 38 ) }<div>${ person( row, actions ) }<p>${ row.openstation_presence === 'online' ? __( 'Online now' ) : __( 'Away' ) }${ row.id === cfg.currentUserId ? ` · ${ __( 'You' ) }` : '' }</p></div></div>` ) }</div>
				${ present.length ? '' : html`<p class="os-community__empty">${ __( 'A quiet moment. Nobody across this site is marked online or away.' ) }</p>` }
				<p class="os-community__footnote">${ model.onlineCount + model.awayCount > 6 ? sprintf( __( 'And %d more across this site.' ), model.onlineCount + model.awayCount - 6 ) : '' }${ __( 'Presence is a snapshot, refreshed with this view.' ) }${ model.unknownPresence ? ` ${ sprintf( __( '%d profiles have no presence data.' ), model.unknownPresence ) }` : '' }</p>
			</section>
			<section class="os-community__panel os-community__arrivals">
				<header><div><span class="os-community__eyebrow">${ __( 'ROOM FOR SOMEONE NEW' ) }</span><h3>${ __( 'New faces, new possibilities' ) }</h3></div><span class="dashicons dashicons-groups" aria-hidden="true"></span></header>
				<p class="os-community__description">${ __( 'Account registrations over the last eight weeks. Each bar is one week.' ) }</p>
				<os-histogram height="135" aria-label=${ __( 'Weekly account registrations across this site' ) } series=${ JSON.stringify( [ { key: 'accounts', label: __( 'New accounts' ), tone: 'info' } ] ) } columns=${ JSON.stringify( model.weeks ) } start=${ model.start } end=${ model.end } empty=${ __( 'No registrations in these eight weeks.' ) }></os-histogram>
				<h4>${ __( 'Newest accounts' ) }</h4><div class="os-community__newcomers">${ model.registered.slice( 0, 4 ).map( ( row ) => html`<div>${ avatar( row, 34 ) }<div>${ person( row, actions ) }<p>${ __( 'Registered' ) } <os-relative-time datetime=${ row.registered_date || '' }></os-relative-time></p></div></div>` ) }</div>
				${ model.registered.length ? '' : html`<p class="os-community__empty">${ __( 'No registration dates available.' ) }</p>` }
			</section>
			<section class="os-community__panel os-community__checkins">
				<header><div><span class="os-community__eyebrow">${ __( 'FAMILIAR FACES' ) }</span><h3>${ __( 'Latest check-ins' ) }</h3></div><span class="dashicons dashicons-clock" aria-hidden="true"></span></header>
				<p class="os-community__description">${ __( 'One latest recorded sign-in per person.' ) }</p>
				<ol class="os-community__timeline">${ model.logins.slice( 0, 6 ).map( ( row ) => html`<li>${ avatar( row, 34 ) }<div>${ person( row, actions ) }<p><os-relative-time datetime=${ new Date( row.openstation_last_login! * 1000 ).toISOString() }></os-relative-time></p></div><span class="os-community__login-mark" aria-hidden="true">↗</span></li>` ) }</ol>
				${ model.logins.length ? '' : html`<p class="os-community__empty">${ __( 'No sign-ins recorded across this site yet.' ) }</p>` }
				<p class="os-community__footnote">${ sprintf( __( '%d profiles have no recorded sign-in. This is not a complete login history.' ), model.unrecorded ) }</p>
			</section>
		</div>
	</div>`;
}
