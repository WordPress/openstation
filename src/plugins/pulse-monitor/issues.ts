/**
 * Pulse Monitor — the Issues window.
 *
 * The trace says something is wrong; this says what. A native window,
 * opened from the readout (widget card, reserved band), from the
 * settings form, or from the command palette, with:
 *
 *   - the diagnosis: rhythm, score, and each item holding the score
 *     down with what it costs, what it means and, where there is one,
 *     the screen that fixes it (Site Health);
 *   - every failure this page saw — newest first, with the URL, method,
 *     status, owning window and, for script errors, file and line.
 *
 * It holds a reference on the shared hub while open, so it keeps
 * listening even with no monitor on the desk.
 */

import { __, sprintf } from '../../i18n';
import '../../ui/components/os-button/os-button';
import { rhythmLabel, type HealthReading, type Penalty, type PenaltyTopic } from './health';
import { acquirePulseHub } from './hub';
import type { Incident } from './incidents';
import { spikeLabel } from './sources';

export const ISSUES_WINDOW_ID = 'desktop-mode/pulse-issues';

const STYLE_ID = 'os-pulse-issues-style';

function ensureStyle(): void {
	if ( document.getElementById( STYLE_ID ) ) {
		return;
	}
	const style = document.createElement( 'style' );
	style.id = STYLE_ID;
	style.textContent = `
.os-pulse-issues {
	box-sizing: border-box;
	height: 100%;
	overflow: auto;
	padding: 16px 20px 24px;
	color: var( --os-ui-fg, currentColor );
	font-size: 13px;
	line-height: 1.45;
}
.os-pulse-issues h3 { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var( --os-ui-fg, currentColor ); }
.os-pulse-issues__muted { color: var( --os-ui-fg-muted, currentColor ); }
.os-pulse-issues__status { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.os-pulse-issues__score { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.os-pulse-issues__dot { inline-size: 10px; block-size: 10px; border-radius: 50%; display: inline-block; }
.os-pulse-issues__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.os-pulse-issues__item {
	padding: 8px 10px;
	border-radius: 8px;
	background: color-mix( in srgb, var( --os-ui-fg, #888 ) 5%, transparent );
}
.os-pulse-issues__row { display: flex; gap: 10px; align-items: baseline; }
.os-pulse-issues__points { font-variant-numeric: tabular-nums; font-weight: 700; min-inline-size: 3ch; color: #ffb020; }
.os-pulse-issues__when { font-variant-numeric: tabular-nums; color: var( --os-ui-fg-muted, currentColor ); min-inline-size: 8ch; }
.os-pulse-issues__what { font-weight: 600; }
.os-pulse-issues__meta {
	margin-block-start: 2px;
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	font-size: 11px;
	color: var( --os-ui-fg-muted, currentColor );
	overflow-wrap: anywhere;
}
.os-pulse-issues__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
`;
	document.head.appendChild( style );
}

/** What a penalty means, in a sentence. */
function explain( topic: PenaltyTopic ): string {
	switch ( topic ) {
		case 'failures':
			return __( 'Requests from this browser that got a 4xx or 5xx answer, or none at all, in the last minute. They are listed under Recent problems.' );
		case 'latency':
			return __( 'The slowest 5 % of the last minute’s requests took longer than 0.8 s. Calls that are long by design (AI, uploads) count for at most 10 s each.' );
		case 'js-errors':
			return __( 'Script errors in the shell or inside a window. Each is listed below with its file and line.' );
		case 'session':
			return __( 'Your login expired. Sign in again to keep working.' );
		case 'site-health-critical':
		case 'site-health-recommended':
			return __( 'From the last Site Health check. Open Site Health for the details and how to fix each one.' );
		case 'server-errors':
			return __( 'Other people’s requests — visitors, bots, apps — that ended in a server error. URLs are not relayed, for privacy; the server’s error log has them.' );
		case 'cron':
			return __( 'Scheduled tasks are running late. WP-Cron only runs when the site gets traffic, and fails when the site cannot call itself. Site Health’s scheduled events and loopback tests say which.' );
	}
	return '';
}

function adminUrl( path: string ): string {
	const ajax = ( window as unknown as { ajaxurl?: string } ).ajaxurl;
	return ajax ? ajax.replace( /admin-ajax\.php.*$/, path ) : path;
}

/** Open an admin screen as a window, the way the shell's own notices do. */
function openAdminScreen( path: string, title: string, icon: string ): void {
	const manager = ( window.wp as unknown as {
		os?: { windowManager?: { open?: ( cfg: Record< string, unknown > ) => unknown } };
	} | undefined )?.os?.windowManager;
	const id = path.replace( /[^a-z0-9]+/gi, '-' ).replace( /-+$/, '' );
	void manager?.open?.( { id, baseId: id, url: adminUrl( path ), title, icon } );
}

function fixFor( topic: PenaltyTopic ): HTMLElement | null {
	if ( topic !== 'site-health-critical' && topic !== 'site-health-recommended' && topic !== 'cron' ) {
		return null;
	}
	const button = document.createElement( 'os-button' );
	button.setAttribute( 'variant', 'secondary' );
	button.textContent = __( 'Open Site Health' );
	button.addEventListener( 'click', () => openAdminScreen( 'site-health.php', __( 'Site Health' ), 'dashicons-heart' ) );
	return button;
}

function clock( at: number ): string {
	return new Date( at ).toLocaleTimeString( undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' } );
}

function stateColour( reading: HealthReading ): string {
	switch ( reading.state ) {
		case 'healthy':
			return '#3ecf8e';
		case 'strained':
			return '#ffd34d';
		case 'sick':
			return '#ffb020';
		default:
			return '#ff4d4d';
	}
}

function el< K extends keyof HTMLElementTagNameMap >( tag: K, className = '', text = '' ): HTMLElementTagNameMap[ K ] {
	const node = document.createElement( tag );
	if ( className ) {
		node.className = className;
	}
	if ( text ) {
		node.textContent = text;
	}
	return node;
}

function penaltyItem( p: Penalty ): HTMLElement {
	const li = el( 'li', 'os-pulse-issues__item' );
	const row = el( 'div', 'os-pulse-issues__row' );
	row.append( el( 'span', 'os-pulse-issues__points', `−${ Math.round( p.points ) }` ), el( 'span', 'os-pulse-issues__what', p.reason ) );
	li.append( row, el( 'div', 'os-pulse-issues__muted', explain( p.topic ) ) );
	const fix = fixFor( p.topic );
	if ( fix ) {
		fix.style.marginBlockStart = '6px';
		li.append( fix );
	}
	return li;
}

function incidentItem( i: Incident ): HTMLElement {
	const li = el( 'li', 'os-pulse-issues__item' );
	const row = el( 'div', 'os-pulse-issues__row' );
	row.append(
		el( 'span', 'os-pulse-issues__when', clock( i.at ) ),
		el( 'span', 'os-pulse-issues__what', spikeLabel( i.source ) ),
		el( 'span', '', i.detail ),
	);
	li.append( row );
	const meta: string[] = [];
	if ( i.url ) {
		meta.push( `${ i.method ? `${ i.method.toUpperCase() } ` : '' }${ i.url }` );
	}
	if ( i.where ) {
		meta.push( i.where );
	}
	if ( i.windowId ) {
		/* translators: %s: id of the window the problem happened in. */
		meta.push( sprintf( __( 'window: %s' ), i.windowId ) );
	}
	if ( i.server ) {
		meta.push( __( 'site-wide, from the server feed (no URL is relayed)' ) );
	}
	if ( meta.length ) {
		li.append( el( 'div', 'os-pulse-issues__meta', meta.join( '  ·  ' ) ) );
	}
	return li;
}

/** Render the Issues view into `body`. Returns the teardown. */
export function renderIssues( body: HTMLElement ): () => void {
	ensureStyle();
	const { hub, release } = acquirePulseHub();
	const root = el( 'div', 'os-pulse-issues' );
	body.appendChild( root );

	const status = el( 'div', 'os-pulse-issues__status' );
	const whyList = el( 'ul', 'os-pulse-issues__list' );
	const whyEmpty = el( 'p', 'os-pulse-issues__muted', __( 'Nothing is holding the score down.' ) );
	const recentBar = el( 'div', 'os-pulse-issues__bar' );
	const recentTitle = el( 'h3' );
	const clear = document.createElement( 'os-button' );
	clear.setAttribute( 'variant', 'ghost' );
	clear.textContent = __( 'Clear' );
	clear.addEventListener( 'click', () => hub.incidents.clear() );
	recentBar.append( recentTitle, clear );
	const recentList = el( 'ul', 'os-pulse-issues__list' );
	const recentEmpty = el( 'p', 'os-pulse-issues__muted', __( 'No problems since this page loaded.' ) );

	root.append(
		status,
		el( 'h3', '', __( 'Why' ) ),
		whyList,
		whyEmpty,
		recentBar,
		recentList,
		recentEmpty,
	);

	const paintStatus = (): void => {
		const reading = hub.health.read( performance.now() );
		status.replaceChildren();
		const dot = el( 'span', 'os-pulse-issues__dot' );
		dot.style.background = stateColour( reading );
		status.append(
			dot,
			el( 'span', 'os-pulse-issues__score', String( reading.score ) ),
			el( 'span', 'os-pulse-issues__muted', __( '/ 100' ) ),
			el( 'span', 'os-pulse-issues__what', rhythmLabel( reading.state ) ),
		);
		whyList.replaceChildren( ...reading.penalties.map( penaltyItem ) );
		whyEmpty.hidden = reading.penalties.length > 0;
	};
	let queued = 0;
	const paintRecent = (): void => {
		queued = 0;
		const items = hub.incidents.list();
		/* translators: %d: number of problems listed. */
		recentTitle.textContent = items.length ? sprintf( __( 'Recent problems (%d)' ), items.length ) : __( 'Recent problems' );
		recentList.replaceChildren( ...items.map( incidentItem ) );
		recentEmpty.hidden = items.length > 0;
		clear.hidden = items.length === 0;
	};
	paintStatus();
	paintRecent();
	const timer = window.setInterval( paintStatus, 1000 );
	const off = hub.incidents.subscribe( () => {
		if ( ! queued ) {
			queued = window.requestAnimationFrame( paintRecent );
		}
	} );

	return (): void => {
		window.clearInterval( timer );
		window.cancelAnimationFrame( queued );
		off();
		root.remove();
		release();
	};
}

/** Open (or focus) the Issues window. */
export function openIssues(): void {
	const os = ( window.wp as unknown as {
		os?: { registerWindow?: ( def: Record< string, unknown > ) => unknown };
	} | undefined )?.os;
	void os?.registerWindow?.( {
		id: ISSUES_WINDOW_ID,
		title: __( 'Pulse Monitor — Issues' ),
		icon: 'dashicons-heart',
		width: 560,
		height: 620,
		minWidth: 360,
		minHeight: 300,
		render: ( body: HTMLElement ) => renderIssues( body ),
	} );
}
