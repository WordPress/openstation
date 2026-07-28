/**
 * Desktop Mode — Games hub window body (Steam-library style).
 *
 * Enhances the PHP template skeleton (`includes/games/window.php`):
 * a compact game grid across the top; selecting a game reveals the
 * detail panel below it — icon, title, description, **Play** and
 * **Challenge** actions, then the game's scoreboard and its
 * challenges. One surface, no tabs.
 *
 * The grid paints from the shared games registry and repaints live
 * as plugins register/unregister games mid-session; the first game
 * auto-selects so the window is never empty.
 */

// Side-effect imports — register the `<wpd-*>` components this module
// constructs. `defineComponent` is idempotent across bundles.
import '../ui/components/wpd-button/wpd-button';
import '../ui/components/wpd-empty-state/wpd-empty-state';

import { __, sprintf } from '../i18n';
import { showToast } from '../toast';
import * as registry from './registry';
import { launchGame } from './launch';
import { formatPlaytime, sumPlaytimeSince } from './playtime';
import { fetchPlaytime, fetchScores } from './rest';
import { openChallengeDialog } from './challenge-dialog';
import { renderScoreboard } from './scoreboard';
import { renderChallengesView } from './challenges-view';
import type { GameRegistryEntry } from './types';

const ROOT = '[data-desktop-mode-games-root]';
const GRID = '[data-desktop-mode-games-grid]';
const DETAIL = '[data-desktop-mode-games-detail]';

function currentUserId(): number {
	const wpGlobal = window.wp as
		| { desktop?: { config?: { currentUserId?: number } } }
		| undefined;
	return Number( wpGlobal?.desktop?.config?.currentUserId ) || 0;
}

/**
 * Render a game icon — dashicon class, or image URL / data URI.
 */
export function buildGameIcon( icon: string ): HTMLElement {
	if ( icon.startsWith( 'data:' ) || /^https?:\/\//.test( icon ) ) {
		const img = document.createElement( 'img' );
		img.src = icon;
		img.alt = '';
		img.className = 'desktop-mode-games__icon-img';
		return img;
	}
	const span = document.createElement( 'span' );
	span.className = `dashicons ${ icon || 'dashicons-admin-generic' } desktop-mode-games__icon-dashicon`;
	span.setAttribute( 'aria-hidden', 'true' );
	return span;
}

/**
 * The render callback published on
 * `window.desktopModeNativeWindows['desktop-mode-games']`.
 */
export function renderGamesHub( body: HTMLElement ): ( () => void ) | void {
	const root = body.querySelector< HTMLElement >( ROOT );
	const grid = body.querySelector< HTMLElement >( GRID );
	const detail = body.querySelector< HTMLElement >( DETAIL );
	if ( ! root || ! grid || ! detail ) {
		return;
	}

	const teardowns: Array< () => void > = [];
	/** Teardowns owned by the current detail render. */
	let detailTeardowns: Array< () => void > = [];
	let selectedId: string | null = null;

	const disposeDetail = (): void => {
		for ( const fn of detailTeardowns ) {
			try {
				fn();
			} catch {
				/* one bad teardown must not strand the rest */
			}
		}
		detailTeardowns = [];
	};

	// --- Challenge with my best score --------------------------------
	const challengeFromBest = async (
		game: GameRegistryEntry,
	): Promise< void > => {
		const viewerId = currentUserId();
		const mine = await fetchScores( game.id, {
			perPage: 1,
			userId: viewerId,
		} );
		const best = mine.scores[ 0 ];
		if ( ! best ) {
			showToast( {
				message: sprintf(
					/* translators: %s: game title. */
					__( 'Play %s first — you need a score to challenge with.' ),
					game.title,
				),
			} );
			return;
		}
		await openChallengeDialog( {
			game: game.id,
			gameTitle: game.title,
			score: best.score,
			meta: best.meta,
		} );
	};

	// --- Detail panel ------------------------------------------------
	const renderDetail = ( game: GameRegistryEntry ): void => {
		disposeDetail();
		detail.hidden = false;
		detail.innerHTML = '';

		// Hero row: icon + title/description + actions.
		const hero = document.createElement( 'div' );
		hero.className = 'desktop-mode-games__hero';

		const visual = document.createElement( 'div' );
		visual.className = 'desktop-mode-games__hero-visual';
		visual.appendChild( buildGameIcon( game.icon ) );
		hero.appendChild( visual );

		const info = document.createElement( 'div' );
		info.className = 'desktop-mode-games__hero-info';
		const title = document.createElement( 'h2' );
		title.className = 'desktop-mode-games__hero-title';
		title.textContent = game.title;
		info.appendChild( title );
		if ( game.description ) {
			const desc = document.createElement( 'p' );
			desc.className = 'desktop-mode-games__hero-desc';
			desc.textContent = game.description;
			info.appendChild( desc );
		}

		// Steam-style play-time strip — lifetime total plus the
		// last-two-weeks figure from the daily buckets. Filled in
		// async, hidden until the viewer actually has time on the
		// clock for this game.
		const playtime = document.createElement( 'div' );
		playtime.className = 'desktop-mode-games__hero-playtime';
		playtime.hidden = true;
		info.appendChild( playtime );
		let playtimeStale = false;
		detailTeardowns.push( () => {
			playtimeStale = true;
		} );
		const playtimeStat = ( label: string, value: string ): HTMLElement => {
			const stat = document.createElement( 'span' );
			stat.className = 'desktop-mode-games__playtime-stat';
			const labelEl = document.createElement( 'span' );
			labelEl.className = 'desktop-mode-games__playtime-label';
			labelEl.textContent = label;
			stat.appendChild( labelEl );
			const valueEl = document.createElement( 'span' );
			valueEl.className = 'desktop-mode-games__playtime-value';
			valueEl.textContent = value;
			stat.appendChild( valueEl );
			return stat;
		};
		void fetchPlaytime()
			.then( ( res ) => {
				const total = Number( res.playtime[ game.id ] ) || 0;
				if ( playtimeStale || total < 1 ) {
					return;
				}
				const recent = sumPlaytimeSince(
					res.daily?.[ game.id ] ?? {},
					res.today,
					14,
				);
				if ( recent > 0 ) {
					playtime.appendChild(
						playtimeStat(
							__( 'Play time (last two weeks)' ),
							formatPlaytime( recent ),
						),
					);
				}
				playtime.appendChild(
					playtimeStat(
						__( 'Play time (total)' ),
						formatPlaytime( total ),
					),
				);
				playtime.hidden = false;
			} )
			.catch( () => {
				/* stays hidden — play time is decorative here */
			} );
		hero.appendChild( info );

		const actions = document.createElement( 'div' );
		actions.className = 'desktop-mode-games__hero-actions';
		const play = document.createElement( 'wpd-button' );
		play.setAttribute( 'variant', 'primary' );
		play.setAttribute( 'size', 'lg' );
		play.textContent = __( 'Play' );
		play.addEventListener( 'click', () => {
			play.setAttribute( 'disabled', '' );
			void launchGame( game.id )
				.catch( ( err ) => {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[desktop-mode] game launch failed:',
							err,
						);
					}
				} )
				.finally( () => {
					play.removeAttribute( 'disabled' );
				} );
		} );
		actions.appendChild( play );
		const challenge = document.createElement( 'wpd-button' );
		challenge.setAttribute( 'variant', 'secondary' );
		challenge.textContent = __( 'Challenge…' );
		challenge.addEventListener( 'click', () => {
			challenge.setAttribute( 'disabled', '' );
			void challengeFromBest( game ).finally( () => {
				challenge.removeAttribute( 'disabled' );
			} );
		} );
		actions.appendChild( challenge );
		hero.appendChild( actions );

		detail.appendChild( hero );

		// Scoreboard section.
		const scoreboardSection = document.createElement( 'section' );
		scoreboardSection.className = 'desktop-mode-games__section';
		const scoreboardHeading = document.createElement( 'h3' );
		scoreboardHeading.className = 'desktop-mode-games__section-heading';
		scoreboardHeading.textContent = __( 'Scoreboard' );
		scoreboardSection.appendChild( scoreboardHeading );
		const scoreboardHost = document.createElement( 'div' );
		scoreboardSection.appendChild( scoreboardHost );
		detail.appendChild( scoreboardSection );
		detailTeardowns.push( renderScoreboard( scoreboardHost, game ) );

		// Challenges section (this game only).
		const challengesSection = document.createElement( 'section' );
		challengesSection.className = 'desktop-mode-games__section';
		const challengesHeading = document.createElement( 'h3' );
		challengesHeading.className = 'desktop-mode-games__section-heading';
		challengesHeading.textContent = __( 'Challenges' );
		challengesSection.appendChild( challengesHeading );
		const challengesHost = document.createElement( 'div' );
		challengesSection.appendChild( challengesHost );
		detail.appendChild( challengesSection );
		detailTeardowns.push( renderChallengesView( challengesHost, game.id ) );
	};

	// --- Grid --------------------------------------------------------
	const select = ( id: string ): void => {
		const game = registry.get( id );
		if ( ! game ) {
			return;
		}
		selectedId = id;
		for ( const tile of Array.from(
			grid.querySelectorAll< HTMLElement >( '[data-game-id]' ),
		) ) {
			const isSelected = tile.getAttribute( 'data-game-id' ) === id;
			tile.classList.toggle(
				'desktop-mode-games__tile--selected',
				isSelected,
			);
			tile.setAttribute( 'aria-selected', isSelected ? 'true' : 'false' );
		}
		renderDetail( game );
	};

	const buildTile = ( entry: GameRegistryEntry ): HTMLElement => {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.className = 'desktop-mode-games__tile';
		tile.setAttribute( 'data-game-id', entry.id );
		tile.setAttribute( 'role', 'option' );
		tile.setAttribute( 'aria-selected', 'false' );

		const visual = document.createElement( 'span' );
		visual.className = 'desktop-mode-games__tile-visual';
		visual.appendChild( buildGameIcon( entry.icon ) );
		tile.appendChild( visual );

		const title = document.createElement( 'span' );
		title.className = 'desktop-mode-games__tile-title';
		title.textContent = entry.title;
		tile.appendChild( title );

		tile.addEventListener( 'click', () => select( entry.id ) );
		return tile;
	};

	const paintGrid = (): void => {
		grid.innerHTML = '';
		const games = registry.all();
		if ( games.length === 0 ) {
			const empty = document.createElement( 'wpd-empty-state' );
			empty.setAttribute( 'icon', 'games' );
			empty.setAttribute( 'heading', __( 'No games installed' ) );
			empty.setAttribute(
				'description',
				__( 'Plugins can add games with desktop_mode_register_game().' ),
			);
			grid.appendChild( empty );
			disposeDetail();
			detail.hidden = true;
			detail.innerHTML = '';
			selectedId = null;
			return;
		}
		for ( const entry of games ) {
			grid.appendChild( buildTile( entry ) );
		}
		// Keep (or establish) a selection: the previous game if it
		// still exists, the first game otherwise.
		const keep =
			selectedId && games.some( ( game ) => game.id === selectedId )
				? selectedId
				: games[ 0 ].id;
		select( keep );
	};

	paintGrid();
	teardowns.push( registry.subscribe( paintGrid ) );

	return () => {
		disposeDetail();
		for ( const fn of teardowns ) {
			try {
				fn();
			} catch {
				/* one bad teardown must not strand the rest */
			}
		}
	};
}
