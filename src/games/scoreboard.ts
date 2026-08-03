/**
 * OpenStation — per-game scoreboard section.
 *
 * Renders one game's leaderboard (`GET /desktop-mode/v1/games/
 * {game}/scores`) into a `<os-table>` whose columns derive from
 * the game's declared `scoreColumns` — a fixed Player column first,
 * a Date column last. Rows belonging to the current user carry a
 * "Challenge…" action that opens the send-challenge dialog
 * pre-filled with that score.
 *
 * Hosted by the Games hub's detail panel (Steam-library style):
 * one instance per selected game, torn down on re-selection.
 */

// Side-effect imports — register the `<os-*>` components this module
// constructs. `defineComponent` is idempotent across bundles.
import '../ui/components/os-avatar/os-avatar';
import '../ui/components/os-button/os-button';
import '../ui/components/os-relative-time/os-relative-time';
import '../ui/components/os-table/os-table';

import { __ } from '../i18n';
import { fetchScores } from './rest';
import { openChallengeDialog } from './challenge-dialog';
import type { OsTable, OsTableColumn } from '../ui/components/os-table/os-table';
import type { GameRegistryEntry, GameScoreRow } from './types';

const PER_PAGE = 25;

function currentUserId(): number {
	const wpGlobal = window.wp as
		| { os?: { config?: { currentUserId?: number } } }
		| undefined;
	return Number( wpGlobal?.os?.config?.currentUserId ) || 0;
}

/** Seconds → `m:ss` for `type: 'time'` columns. */
export function formatTimeValue( value: unknown ): string {
	const seconds = Math.max( 0, Math.round( Number( value ) || 0 ) );
	const minutes = Math.floor( seconds / 60 );
	const rest = seconds % 60;
	return `${ minutes }:${ String( rest ).padStart( 2, '0' ) }`;
}

function buildColumns( game: GameRegistryEntry ): OsTableColumn< GameScoreRow >[] {
	const columns: OsTableColumn< GameScoreRow >[] = [
		{
			key: 'userName',
			label: __( 'Player' ),
			render: ( _value, row ) => {
				const cell = document.createElement( 'span' );
				// The cell lands inside `<os-table>`'s shadow DOM,
				// where light-DOM stylesheets (games.css) can't reach
				// — style inline, same as the Users window's identity
				// cell.
				cell.style.cssText =
					'display:inline-flex;align-items:center;gap:8px;min-width:0;';
				const avatar = document.createElement( 'os-avatar' );
				avatar.setAttribute( 'src', row.userAvatar );
				avatar.setAttribute( 'name', row.userName );
				avatar.setAttribute( 'size', 'xs' );
				avatar.setAttribute( 'user-id', String( row.userId ) );
				cell.appendChild( avatar );
				const name = document.createElement( 'span' );
				name.textContent = row.userName;
				cell.appendChild( name );
				return cell;
			},
		},
	];
	for ( const column of game.scoreColumns ) {
		columns.push( {
			key: column.key,
			label: column.label,
			render: ( _value, row ) => {
				const raw =
					'score' === column.key ? row.score : row.meta[ column.key ];
				if ( raw === undefined || raw === null ) {
					return '—';
				}
				if ( 'time' === column.type ) {
					return formatTimeValue( raw );
				}
				return String( raw );
			},
		} );
	}
	columns.push( {
		key: 'createdAtMs',
		label: __( 'When' ),
		render: ( _value, row ) => {
			const time = document.createElement( 'os-relative-time' );
			time.setAttribute(
				'datetime',
				new Date( row.createdAtMs ).toISOString(),
			);
			return time;
		},
	} );
	columns.push( {
		key: '__actions',
		label: '',
		render: ( _value, row ) => {
			if ( row.userId !== currentUserId() ) {
				return '';
			}
			const btn = document.createElement( 'os-button' );
			btn.setAttribute( 'variant', 'secondary' );
			btn.setAttribute( 'size', 'sm' );
			btn.textContent = __( 'Challenge…' );
			btn.addEventListener( 'click', () => {
				openChallengeDialog( {
					game: game.id,
					gameTitle: game.title,
					score: row.score,
					meta: row.meta,
				} );
			} );
			return btn;
		},
	} );
	return columns;
}

/**
 * Mount one game's scoreboard into its container. Returns a
 * teardown.
 */
export function renderScoreboard(
	container: HTMLElement,
	game: GameRegistryEntry,
): () => void {
	container.innerHTML = '';

	const tableHost = document.createElement( 'div' );
	tableHost.className = 'os-games__scoreboard-table';
	container.appendChild( tableHost );

	const pager = document.createElement( 'div' );
	pager.className = 'os-games__pager';
	container.appendChild( pager );

	let page = 1;
	let total = 0;
	let loadSeq = 0;
	let disposed = false;

	const table = document.createElement( 'os-table' ) as OsTable< GameScoreRow >;
	table.setAttribute( 'sticky-header', '' );
	table.setAttribute( 'hover', '' );
	table.setAttribute( 'striped', '' );
	const empty = document.createElement( 'div' );
	empty.setAttribute( 'slot', 'empty' );
	empty.className = 'os-games__scoreboard-empty';
	empty.textContent = __( 'No scores yet — be the first to play!' );
	table.appendChild( empty );
	tableHost.appendChild( table );
	table.columns = buildColumns( game );
	table.data = [];

	const paintPager = (): void => {
		pager.innerHTML = '';
		const pages = Math.max( 1, Math.ceil( total / PER_PAGE ) );
		if ( pages <= 1 ) {
			return;
		}
		const prev = document.createElement( 'os-button' );
		prev.setAttribute( 'variant', 'ghost' );
		prev.textContent = __( 'Previous' );
		if ( page <= 1 ) {
			prev.setAttribute( 'disabled', '' );
		}
		prev.addEventListener( 'click', () => void load( page - 1 ) );
		const label = document.createElement( 'span' );
		label.className = 'os-games__pager-label';
		label.textContent = `${ page } / ${ pages }`;
		const next = document.createElement( 'os-button' );
		next.setAttribute( 'variant', 'ghost' );
		next.textContent = __( 'Next' );
		if ( page >= pages ) {
			next.setAttribute( 'disabled', '' );
		}
		next.addEventListener( 'click', () => void load( page + 1 ) );
		pager.append( prev, label, next );
	};

	const load = async ( toPage: number ): Promise< void > => {
		const seq = ++loadSeq;
		table.setAttribute( 'loading', '' );
		try {
			const result = await fetchScores( game.id, {
				page: toPage,
				perPage: PER_PAGE,
			} );
			// Out-of-order guard — only the latest request paints.
			if ( disposed || seq !== loadSeq ) {
				return;
			}
			page = toPage;
			total = result.total;
			table.data = result.scores;
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error( '[openstation] scoreboard load failed:', err );
			}
		} finally {
			if ( ! disposed && seq === loadSeq ) {
				table.removeAttribute( 'loading' );
				paintPager();
			}
		}
	};

	void load( 1 );

	return () => {
		disposed = true;
	};
}
