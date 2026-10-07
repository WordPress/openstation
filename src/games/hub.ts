import '../ui/components/os-button/os-button';
import '../ui/components/os-empty-state/os-empty-state';

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

const ROOT = '[data-os-games-root]';
const GRID = '[data-os-games-grid]';
const DETAIL = '[data-os-games-detail]';

function currentUserId(): number {
	const wpGlobal = window.wp as
		| { os?: { config?: { currentUserId?: number } } }
		| undefined;
	return Number( wpGlobal?.os?.config?.currentUserId ) || 0;
}

export function buildGameIcon( icon: string ): HTMLElement {
	if ( icon.startsWith( 'data:' ) || /^https?:\/\//.test( icon ) ) {
		const img = document.createElement( 'img' );
		img.src = icon;
		img.alt = '';
		img.className = 'os-games__icon-img';
		return img;
	}
	const span = document.createElement( 'span' );
	span.className = `dashicons ${ icon || 'dashicons-admin-generic' } os-games__icon-dashicon`;
	span.setAttribute( 'aria-hidden', 'true' );
	return span;
}

export function renderGamesHub( body: HTMLElement ): ( () => void ) | void {
	const root = body.querySelector< HTMLElement >( ROOT );
	const grid = body.querySelector< HTMLElement >( GRID );
	const detail = body.querySelector< HTMLElement >( DETAIL );
	if ( ! root || ! grid || ! detail ) {
		return;
	}

	const teardowns: Array< () => void > = [];

	let detailTeardowns: Array< () => void > = [];
	let selectedId: string | null = null;

	const disposeDetail = (): void => {
		for ( const fn of detailTeardowns ) {
			try {
				fn();
			} catch {

			}
		}
		detailTeardowns = [];
	};

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

	const renderDetail = ( game: GameRegistryEntry ): void => {
		disposeDetail();
		detail.hidden = false;
		detail.innerHTML = '';

		const hero = document.createElement( 'div' );
		hero.className = 'os-games__hero';

		const visual = document.createElement( 'div' );
		visual.className = 'os-games__hero-visual';
		visual.appendChild( buildGameIcon( game.icon ) );
		hero.appendChild( visual );

		const info = document.createElement( 'div' );
		info.className = 'os-games__hero-info';
		const title = document.createElement( 'h2' );
		title.className = 'os-games__hero-title';
		title.textContent = game.title;
		info.appendChild( title );
		if ( game.description ) {
			const desc = document.createElement( 'p' );
			desc.className = 'os-games__hero-desc';
			desc.textContent = game.description;
			info.appendChild( desc );
		}

		const playtime = document.createElement( 'div' );
		playtime.className = 'os-games__hero-playtime';
		playtime.hidden = true;
		info.appendChild( playtime );
		let playtimeStale = false;
		detailTeardowns.push( () => {
			playtimeStale = true;
		} );
		const playtimeStat = ( label: string, value: string ): HTMLElement => {
			const stat = document.createElement( 'span' );
			stat.className = 'os-games__playtime-stat';
			const labelEl = document.createElement( 'span' );
			labelEl.className = 'os-games__playtime-label';
			labelEl.textContent = label;
			stat.appendChild( labelEl );
			const valueEl = document.createElement( 'span' );
			valueEl.className = 'os-games__playtime-value';
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

			} );
		hero.appendChild( info );

		const actions = document.createElement( 'div' );
		actions.className = 'os-games__hero-actions';
		const play = document.createElement( 'os-button' );
		play.setAttribute( 'variant', 'primary' );
		play.setAttribute( 'size', 'lg' );
		play.textContent = __( 'Play' );
		play.addEventListener( 'click', () => {
			play.setAttribute( 'disabled', '' );
			void launchGame( game.id )
				.catch( ( err ) => {
					if ( typeof console !== 'undefined' ) {
						console.error(
							'[openstation] game launch failed:',
							err,
						);
					}
				} )
				.finally( () => {
					play.removeAttribute( 'disabled' );
				} );
		} );
		actions.appendChild( play );
		const challenge = document.createElement( 'os-button' );
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

		const scoreboardSection = document.createElement( 'section' );
		scoreboardSection.className = 'os-games__section';
		const scoreboardHeading = document.createElement( 'h3' );
		scoreboardHeading.className = 'os-games__section-heading';
		scoreboardHeading.textContent = __( 'Scoreboard' );
		scoreboardSection.appendChild( scoreboardHeading );
		const scoreboardHost = document.createElement( 'div' );
		scoreboardSection.appendChild( scoreboardHost );
		detail.appendChild( scoreboardSection );
		detailTeardowns.push( renderScoreboard( scoreboardHost, game ) );

		const challengesSection = document.createElement( 'section' );
		challengesSection.className = 'os-games__section';
		const challengesHeading = document.createElement( 'h3' );
		challengesHeading.className = 'os-games__section-heading';
		challengesHeading.textContent = __( 'Challenges' );
		challengesSection.appendChild( challengesHeading );
		const challengesHost = document.createElement( 'div' );
		challengesSection.appendChild( challengesHost );
		detail.appendChild( challengesSection );
		detailTeardowns.push( renderChallengesView( challengesHost, game.id ) );
	};

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
				'os-games__tile--selected',
				isSelected,
			);
			tile.setAttribute( 'aria-selected', isSelected ? 'true' : 'false' );
		}
		renderDetail( game );
	};

	const buildTile = ( entry: GameRegistryEntry ): HTMLElement => {
		const tile = document.createElement( 'button' );
		tile.type = 'button';
		tile.className = 'os-games__tile';
		tile.setAttribute( 'data-game-id', entry.id );
		tile.setAttribute( 'role', 'option' );
		tile.setAttribute( 'aria-selected', 'false' );

		const visual = document.createElement( 'span' );
		visual.className = 'os-games__tile-visual';
		visual.appendChild( buildGameIcon( entry.icon ) );
		tile.appendChild( visual );

		const title = document.createElement( 'span' );
		title.className = 'os-games__tile-title';
		title.textContent = entry.title;
		tile.appendChild( title );

		tile.addEventListener( 'click', () => select( entry.id ) );
		return tile;
	};

	const paintGrid = (): void => {
		grid.innerHTML = '';
		const games = registry.all();
		if ( games.length === 0 ) {
			const empty = document.createElement( 'os-empty-state' );
			empty.setAttribute( 'icon', 'games' );
			empty.setAttribute( 'heading', __( 'No games installed' ) );
			empty.setAttribute(
				'description',
				__( 'Plugins can add games with openstation_register_game().' ),
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

			}
		}
	};
}
