/**
 * `<os-user-profile>` — the read-only surfaces over the insights
 * payload: the sidebar summary (avatar, roles, completeness, KPI
 * tiles, 12-month sparkline) and the activity feed below the form
 * (recent posts + comments, sessions and app-password summary). Pure
 * painters: the element fetches the payload once and hands it to both.
 */

import { __, _n, formatDate, sprintf } from '@openstation/app';
import { relativeTimeNode, serverDateMs } from './client';
import type { ProfileConfig, UserInsightsPayload } from './types';

const CARD = 'border:1px solid var(--os-ui-border, #dcdcde);border-radius:10px;padding:14px 16px;';
const MUTED_HEAD =
	'color:var(--os-ui-fg-muted, #50575e);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;';
const CHIP =
	'display:inline-flex;padding:2px 8px;border-radius:10px;background:var(--os-ui-badge-info-bg, rgba(34,113,177,0.10));color:var(--os-ui-info-fg, #0a4b78);font-size:11px;font-weight:600;';

function div( css: string, text?: string | Node ): HTMLElement {
	const el = document.createElement( 'div' );
	el.style.cssText = css;
	if ( typeof text === 'string' ) {
		el.textContent = text;
	} else if ( text ) {
		el.appendChild( text );
	}
	return el;
}

/** The "Loading…" placeholder both regions show while the payload is on its way. */
export function paintInsightsLoading( host: HTMLElement ): void {
	host.replaceChildren(
		div(
			'display:flex;align-items:center;justify-content:center;padding:32px;color:var(--os-ui-fg-muted, #50575e);font-size:13px;',
			__( 'Loading insights…' ),
		),
	);
}

/** The failure both regions show. */
export function paintInsightsError( host: HTMLElement, err: unknown ): void {
	const msg = document.createElement( 'p' );
	msg.style.cssText = 'padding:24px;color:var(--os-ui-danger, #b32d2e);font-size:13px;text-align:center;';
	// translators: %s is an error message.
	msg.textContent = sprintf( __( 'Could not load insights (%s).' ), String( ( err as Error )?.message ?? err ) );
	host.replaceChildren( msg );
}

/** The compact summary for the sidebar (`<aside>`). */
export function paintAside( host: HTMLElement, data: UserInsightsPayload, cfg: ProfileConfig ): void {
	host.replaceChildren( buildAsideSummary( data, cfg ), buildAsideStatGrid( data ), buildContentSparkline( data ) );
}

/** The full-width activity feed below the form. */
export function paintActivity( host: HTMLElement, data: UserInsightsPayload ): void {
	const wrap = document.createElement( 'div' );
	wrap.className = 'os-user-edit__activity';
	const heading = document.createElement( 'h3' );
	heading.textContent = __( 'Recent activity' );
	heading.style.cssText =
		'margin:24px 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--os-ui-fg-muted, #50575e);';
	wrap.append( heading, buildRecentLists( data ), buildSecurityPanel( data ) );
	host.replaceChildren( wrap );
}

/** Role chips, labelled from the catalogue the host ships. */
export function roleChips( roles: string[], cfg: ProfileConfig ): HTMLElement {
	const wrap = div( 'display:flex;flex-wrap:wrap;gap:4px;justify-content:center;' );
	const labels = cfg.allRoles ?? {};
	for ( const role of roles ) {
		const chip = document.createElement( 'span' );
		chip.textContent = labels[ role ] ?? role;
		chip.style.cssText = CHIP;
		wrap.appendChild( chip );
	}
	if ( roles.length === 0 ) {
		const noRole = document.createElement( 'span' );
		noRole.textContent = __( 'No role' );
		noRole.style.cssText = 'font-size:11px;color:var(--os-ui-fg-muted, #8c8f94);';
		wrap.appendChild( noRole );
	}
	return wrap;
}

/** Aside top — avatar + name + role chips + completeness bar. */
function buildAsideSummary( data: UserInsightsPayload, cfg: ProfileConfig ): HTMLElement {
	const card = div(
		[
			'display:flex',
			'flex-direction:column',
			'align-items:center',
			'text-align:center',
			'gap:6px',
			'padding:16px',
			'border:1px solid var(--os-ui-border, #dcdcde)',
			'border-radius:12px',
			'background:var(--os-ui-card-bg, var(--os-ui-surface, #f6f7f7))',
		].join( ';' ),
	);

	const avatar = document.createElement( 'img' );
	avatar.src = data.avatarUrl;
	avatar.alt = '';
	avatar.style.cssText = 'width:72px;height:72px;border-radius:50%;flex-shrink:0;';
	card.appendChild( avatar );
	card.appendChild( div( 'font-size:15px;font-weight:600;letter-spacing:-0.01em;', data.displayName || `#${ data.userId }` ) );
	card.appendChild( roleChips( data.roles, cfg ) );

	const completeness = data.profileCompleteness;
	if ( completeness && completeness.total > 0 ) {
		const cwrap = div( 'display:flex;flex-direction:column;gap:4px;width:100%;margin-top:6px;' );
		const top = div(
			'display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--os-ui-fg-muted, #50575e);',
		);
		const lbl = document.createElement( 'span' );
		lbl.textContent = __( 'Profile completeness' );
		const pct = document.createElement( 'span' );
		pct.style.cssText = 'font-variant-numeric:tabular-nums;font-weight:600;';
		pct.textContent = `${ completeness.percent }%`;
		top.append( lbl, pct );
		cwrap.appendChild( top );
		const track = div(
			'height:4px;border-radius:999px;background:var(--os-ui-holo-track, rgba(0,0,0,0.06));position:relative;overflow:hidden;',
		);
		track.appendChild(
			div(
				`position:absolute;inset:0;width:${ completeness.percent }%;background:var(--wp-admin-theme-color, #2271b1);transition:width 360ms ease;`,
			),
		);
		cwrap.appendChild( track );
		card.appendChild( cwrap );
	}
	return card;
}

/** Aside KPI tiles — 2x2 grid of compact stat cards. */
function buildAsideStatGrid( data: UserInsightsPayload ): HTMLElement {
	const grid = div( 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;' );
	const tile = ( label: string, value: string | Node, sub?: string ): HTMLElement => {
		const card = div(
			'border:1px solid var(--os-ui-border, #dcdcde);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:1px;min-width:0;',
		);
		card.appendChild(
			div( 'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:var(--os-ui-fg-muted, #50575e);font-weight:600;', label ),
		);
		card.appendChild( div( 'font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;', value ) );
		if ( sub ) {
			const subEl = div(
				'font-size:10px;color:var(--os-ui-fg-muted, #8c8f94);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
				sub,
			);
			subEl.title = sub;
			card.appendChild( subEl );
		}
		return card;
	};

	const stats = data.stats;
	grid.appendChild(
		tile(
			__( 'Posts' ),
			String( stats.posts ),
			// translators: %d is a count of pages.
			stats.pages > 0 ? sprintf( _n( '+ %d page', '+ %d pages', stats.pages ), stats.pages ) : undefined,
		),
	);
	grid.appendChild(
		tile(
			__( 'Comments' ),
			String( stats.commentsAuthored ),
			// translators: %d is a count of received comments.
			stats.commentsReceived > 0 ? sprintf( __( '%d received' ), stats.commentsReceived ) : undefined,
		),
	);
	grid.appendChild(
		tile(
			__( 'Last login' ),
			stats.lastLoginAt ? relativeTimeNode( stats.lastLoginAt ) : __( 'Never' ),
			stats.lastLoginAt ? formatDate( stats.lastLoginAt * 1000, 'long' ) : undefined,
		),
	);
	let memberValue = '—';
	if ( stats.daysSinceRegistration !== null ) {
		// translators: %d is a number of days.
		memberValue = sprintf( _n( '%d day', '%d days', stats.daysSinceRegistration ), stats.daysSinceRegistration );
	}
	grid.appendChild(
		tile( __( 'Member' ), memberValue, stats.registeredAt ? formatDate( stats.registeredAt * 1000, 'long' ) : undefined ),
	);
	return grid;
}

function buildContentSparkline( data: UserInsightsPayload ): HTMLElement {
	const wrap = div( `${ CARD }margin:0 0 22px;` );
	const head = div( 'display:flex;justify-content:space-between;align-items:baseline;margin:0 0 8px;' );
	head.appendChild( div( 'font-size:13px;font-weight:600;', __( 'Posts published — last 12 months' ) ) );
	const total = data.contentByMonth.reduce( ( s, m ) => s + m.count, 0 );
	// translators: %d is a count of posts.
	head.appendChild( div( 'font-size:11px;color:var(--os-ui-fg-muted, #50575e);', sprintf( __( '%d total' ), total ) ) );
	wrap.appendChild( head );

	if ( data.contentByMonth.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.style.cssText = 'margin:0;color:var(--os-ui-fg-muted, #50575e);font-size:12px;';
		empty.textContent = __( 'No activity in the last 12 months.' );
		wrap.appendChild( empty );
		return wrap;
	}

	const max = Math.max( 1, ...data.contentByMonth.map( ( m ) => m.count ) );
	const columns = `grid-template-columns:repeat(${ data.contentByMonth.length }, 1fr);`;
	const bars = div( `display:grid;${ columns }gap:4px;align-items:end;height:60px;` );
	for ( const month of data.contentByMonth ) {
		const col = div( 'display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;' );
		const bar = div(
			[
				'width:100%',
				`height:${ Math.max( 3, Math.round( ( month.count / max ) * 100 ) ) }%`,
				'background:var(--wp-admin-theme-color, #2271b1)',
				month.count === 0 ? 'opacity:0.18' : 'opacity:1',
				'border-radius:3px 3px 0 0',
				'transition:height 360ms ease',
			].join( ';' ),
		);
		// translators: %1$s is a YYYY-MM month, %2$d is post count.
		bar.title = sprintf( __( '%1$s — %2$d posts' ), month.month, month.count );
		col.appendChild( bar );
		bars.appendChild( col );
	}
	wrap.appendChild( bars );

	const labels = div( `display:grid;${ columns }gap:4px;margin-top:4px;font-size:10px;color:var(--os-ui-fg-muted, #8c8f94);text-align:center;` );
	for ( const month of data.contentByMonth ) {
		const span = document.createElement( 'span' );
		const parts = month.month.split( '-' );
		span.textContent = parts.length === 2 ? parts[ 1 ] : month.month;
		labels.appendChild( span );
	}
	wrap.appendChild( labels );
	return wrap;
}

interface RecentItem {
	primary: string;
	when: string;
	context?: string;
	tag: string | null;
	badge: string | null;
}

function buildRecentLists( data: UserInsightsPayload ): HTMLElement {
	const wrap = div( 'display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;margin:0 0 22px;' );
	wrap.appendChild(
		buildRecentList(
			__( 'Recent posts' ),
			__( 'No recent posts.' ),
			data.recentPosts.map( ( p ) => ( {
				primary: p.title,
				when: p.dateGmt,
				tag: p.status !== 'publish' ? p.status : null,
				// translators: %d is a count of comments.
				badge: p.commentCount > 0 ? sprintf( __( '%d 💬' ), p.commentCount ) : null,
			} ) ),
		),
	);
	wrap.appendChild(
		buildRecentList(
			__( 'Recent comments' ),
			__( 'No recent comments.' ),
			data.recentComments.map( ( c ) => ( {
				primary: c.excerpt || __( '(empty comment)' ),
				when: c.dateGmt,
				// translators: %s is a post title.
				context: c.postTitle ? sprintf( __( 'on "%s"' ), c.postTitle ) : undefined,
				tag: c.approved ? null : __( 'pending' ),
				badge: null,
			} ) ),
		),
	);
	return wrap;
}

function buildRecentList( title: string, emptyText: string, items: RecentItem[] ): HTMLElement {
	const card = div( `${ CARD }min-width:0;` );
	card.appendChild( div( 'font-size:13px;font-weight:600;margin:0 0 10px;', title ) );
	if ( items.length === 0 ) {
		const empty = document.createElement( 'p' );
		empty.style.cssText = 'margin:0;color:var(--os-ui-fg-muted, #50575e);font-size:12px;';
		empty.textContent = emptyText;
		card.appendChild( empty );
		return card;
	}
	const list = document.createElement( 'ul' );
	list.style.cssText = 'list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;';
	for ( const item of items ) {
		const li = document.createElement( 'li' );
		li.style.cssText = 'min-width:0;';
		const top = div( 'display:flex;align-items:baseline;gap:6px;min-width:0;' );
		const primary = document.createElement( 'span' );
		primary.style.cssText =
			'font-size:13px;line-height:1.35;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		primary.textContent = item.primary;
		primary.title = item.primary;
		top.appendChild( primary );
		if ( item.tag ) {
			const tag = document.createElement( 'span' );
			tag.style.cssText =
				'font-size:10px;text-transform:uppercase;letter-spacing:0.04em;background:var(--os-ui-badge-neutral-bg, rgba(0,0,0,0.06));padding:1px 6px;border-radius:8px;flex-shrink:0;';
			tag.textContent = item.tag;
			top.appendChild( tag );
		}
		if ( item.badge ) {
			const badge = document.createElement( 'span' );
			badge.style.cssText = 'font-size:11px;color:var(--os-ui-fg-muted, #50575e);flex-shrink:0;';
			badge.textContent = item.badge;
			top.appendChild( badge );
		}
		li.appendChild( top );
		const meta = div( 'font-size:11px;color:var(--os-ui-fg-muted, #8c8f94);' );
		if ( item.context ) {
			meta.append( item.context, ' · ' );
		}
		meta.appendChild( Number.isFinite( serverDateMs( item.when ) ) ? relativeTimeNode( item.when ) : document.createTextNode( '—' ) );
		li.appendChild( meta );
		list.appendChild( li );
	}
	card.appendChild( list );
	return card;
}

function buildSecurityPanel( data: UserInsightsPayload ): HTMLElement {
	const card = div( CARD );
	card.appendChild( div( 'font-size:13px;font-weight:600;margin:0 0 10px;', __( 'Active sessions & app access' ) ) );
	const grid = div( 'display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;' );

	const tile = ( label: string, value: string, sub: string | Node ): HTMLElement => {
		const el = div( 'display:flex;flex-direction:column;gap:2px;font-size:12px;' );
		el.append( div( MUTED_HEAD, label ), div( 'font-size:18px;font-weight:600;', value ), div( 'color:var(--os-ui-fg-muted, #8c8f94);', sub ) );
		return el;
	};

	grid.appendChild(
		tile(
			__( 'Active sessions' ),
			String( data.sessions.length ),
			data.sessions.some( ( s ) => s.current ) ? __( 'Includes the current device.' ) : __( 'Logged in across multiple devices.' ),
		),
	);
	const apps = data.applicationPasswords;
	let appSub: string | Node;
	if ( apps.lastUsedAt && apps.lastUsedName ) {
		const frag = document.createDocumentFragment();
		// translators: %s is the app password name.
		frag.append( sprintf( __( '"%s" last used' ), apps.lastUsedName ), ' ', relativeTimeNode( apps.lastUsedAt ) );
		appSub = frag;
	} else {
		appSub = apps.total ? __( 'No recent use.' ) : __( 'No app passwords issued yet.' );
	}
	grid.appendChild( tile( __( 'Application passwords' ), String( apps.total ), appSub ) );
	card.appendChild( grid );
	return card;
}
