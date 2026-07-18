/**
 * Alphabet Soup — game orchestrator.
 *
 * Owns the run lifecycle (loading → menu → playing → paused →
 * over), the two mode clocks (count-up for Daily, countdown for
 * Time Attack), the wave loop, the drag-to-select input, the HUD +
 * find-list side panel, and the game-over share card. Everything
 * async double-checks `disposed` so closing the window mid-load
 * never leaks a Pixi app.
 *
 * Pixi lifecycle follows the Inkfall precedent: PixiJS from
 * `wp.desktop.loadModules(['pixijs'])`, `sharedTicker: false`, and
 * the options-object destroy — never `destroy( true )`.
 *
 * The puzzle itself is seeded by the current date (`dd-mm-yyyy`) —
 * see `seed.ts` — so every player worldwide stirs the same soup.
 *
 * @since 0.9.8
 */

import { __, sprintf } from '../../i18n';
import { desktopGlobal } from '../desktop-like';
import { loadDictionary, type Dictionary } from '../dictionary';
import { getPixi, type PixiApp, type PixiNamespace } from '../pixi-types';
import {
	renderShareCard,
	shareScoreCard,
	type ShareCardData,
} from '../share-card';
import type { GameLaunchContext } from '../types';
import { createSoupAudio } from './audio';
import { createSoupBoard, WORD_COLORS, type SoupBoard } from './board';
import { createSoupFx, type SoupFx } from './fx';
import {
	DAILY_WAVE_COUNT,
	LOW_TIME_SECONDS,
	SOUP_MODES,
	SOUP_SIZES,
	TIME_ATTACK_START_SECONDS,
	TIME_ATTACK_WAVE_BONUS_SECONDS,
	TIME_ATTACK_WORD_BONUS_SECONDS,
	isFinalDailyWave,
	sizeCells,
	waveConfig,
	type SoupMode,
	type SoupSize,
} from './modes';
import {
	accuracyPercent,
	buildSoupScoreRow,
	createSoupScore,
	recordFind,
	recordMissSelection,
	recordWaveClear,
	type SoupScoreState,
} from './scoring';
import { formatDailySeed, runSeedString, waveRng } from './seed';
import {
	generateSoup,
	lineCells,
	selectionMatches,
	type SoupCell,
	type SoupGrid,
} from './soup-gen';

type RunState = 'loading' | 'menu' | 'playing' | 'paused' | 'over';

/** localStorage key remembering the last mode pick. */
const MODE_STORAGE_KEY = 'desktop-mode/alphabet-soup-mode';

/** localStorage key remembering the last board-size pick. */
const SIZE_STORAGE_KEY = 'desktop-mode/alphabet-soup-size';

/**
 * localStorage key for the played-today ledger. Each (mode, size)
 * puzzle is meant to be played for real ONCE — the word positions
 * can be memorized, so only the first run earns a share card.
 * Shape: `{ "date": "19-07-2026", "seeds": [ "<runSeedString>" ] }`;
 * entries from earlier days are discarded on read.
 */
const PLAYED_STORAGE_KEY = 'desktop-mode/alphabet-soup-played';

/** Cap a frame delta so a background-tab hiccup can't eat the clock. */
const MAX_FRAME_SECONDS = 0.05;

/** Seconds between clearing a wave and serving the next one. */
const WAVE_TRANSITION_SECONDS = 1.4;

function modeLabel( mode: SoupMode ): string {
	return 'time-attack' === mode ? __( 'Time Attack' ) : __( 'Daily' );
}

function modeHint( mode: SoupMode ): string {
	return 'time-attack' === mode
		? __( '90 seconds on the clock — every word buys you more.' )
		: sprintf(
			/* translators: %s: number of waves in a Daily run. */
			__( '%s relaxed waves. No clock pressure, just streaks.' ),
			String( DAILY_WAVE_COUNT ),
		);
}

function sizeLabel( size: SoupSize ): string {
	switch ( size ) {
		case 'big':
			return __( 'Big' );
		case 'medium':
			return __( 'Medium' );
		default:
			return __( 'Small' );
	}
}

/** The board dimensions as a label, e.g. `12×12`. */
function sizeDims( size: SoupSize ): string {
	const cells = sizeCells( size );
	return `${ cells }×${ cells }`;
}

function readStoredMode(): SoupMode {
	try {
		const stored = window.localStorage.getItem( MODE_STORAGE_KEY );
		if ( stored && ( SOUP_MODES as readonly string[] ).includes( stored ) ) {
			return stored as SoupMode;
		}
	} catch {
		/* storage unavailable — default */
	}
	return 'daily';
}

function storeMode( mode: SoupMode ): void {
	try {
		window.localStorage.setItem( MODE_STORAGE_KEY, mode );
	} catch {
		/* storage unavailable — best effort */
	}
}

function readStoredSize(): SoupSize {
	try {
		const stored = window.localStorage.getItem( SIZE_STORAGE_KEY );
		if ( stored && ( SOUP_SIZES as readonly string[] ).includes( stored ) ) {
			return stored as SoupSize;
		}
	} catch {
		/* storage unavailable — default */
	}
	return 'small';
}

function storeSize( size: SoupSize ): void {
	try {
		window.localStorage.setItem( SIZE_STORAGE_KEY, size );
	} catch {
		/* storage unavailable — best effort */
	}
}

/** The seeds already played today (earlier days are discarded). */
function readPlayedToday( dateSeed: string ): Set< string > {
	try {
		const raw = window.localStorage.getItem( PLAYED_STORAGE_KEY );
		if ( ! raw ) {
			return new Set();
		}
		const parsed = JSON.parse( raw ) as {
			date?: string;
			seeds?: string[];
		};
		if ( parsed.date !== dateSeed || ! Array.isArray( parsed.seeds ) ) {
			return new Set();
		}
		return new Set( parsed.seeds );
	} catch {
		return new Set();
	}
}

function markPlayed( dateSeed: string, seed: string ): void {
	try {
		const seeds = readPlayedToday( dateSeed );
		seeds.add( seed );
		window.localStorage.setItem(
			PLAYED_STORAGE_KEY,
			JSON.stringify( { date: dateSeed, seeds: [ ...seeds ] } ),
		);
	} catch {
		/* storage unavailable — every run counts as the first */
	}
}

function formatClock( seconds: number ): string {
	const whole = Math.max( 0, Math.floor( seconds ) );
	const mins = Math.floor( whole / 60 );
	const secs = whole % 60;
	return `${ mins }:${ String( secs ).padStart( 2, '0' ) }`;
}

function cssColor( color: number ): string {
	return `#${ color.toString( 16 ).padStart( 6, '0' ) }`;
}

export function mountAlphabetSoup( ctx: GameLaunchContext ): () => void {
	const root = document.createElement( 'div' );
	root.className = 'soup';
	ctx.container.appendChild( root );

	// --- HUD (DOM, above the canvas) --------------------------------
	const audio = createSoupAudio();

	const hud = document.createElement( 'div' );
	hud.className = 'soup__hud';
	const scoreEl = document.createElement( 'span' );
	scoreEl.className = 'soup__hud-score';
	const streakEl = document.createElement( 'span' );
	streakEl.className = 'soup__hud-streak';
	const timerEl = document.createElement( 'span' );
	timerEl.className = 'soup__hud-timer';
	const waveEl = document.createElement( 'span' );
	waveEl.className = 'soup__hud-wave';
	const soundToggle = document.createElement( 'button' );
	soundToggle.type = 'button';
	soundToggle.className = 'soup__hud-sound';
	const paintSoundToggle = (): void => {
		soundToggle.textContent = audio.isEnabled() ? '🔊' : '🔇';
		soundToggle.setAttribute(
			'aria-label',
			audio.isEnabled()
				? __( 'Mute sound effects' )
				: __( 'Unmute sound effects' ),
		);
		soundToggle.setAttribute(
			'aria-pressed',
			audio.isEnabled() ? 'false' : 'true',
		);
	};
	paintSoundToggle();
	soundToggle.addEventListener( 'click', () => {
		audio.setEnabled( ! audio.isEnabled() );
		paintSoundToggle();
	} );
	hud.append( scoreEl, streakEl, timerEl, waveEl );
	if ( ctx.challenge ) {
		const ribbon = document.createElement( 'span' );
		ribbon.className = 'soup__hud-ribbon';
		ribbon.textContent = sprintf(
			/* translators: 1: challenger display name, 2: score to beat. */
			__( 'Beat %1$s: %2$s' ),
			ctx.challenge.challengerName,
			String( ctx.challenge.scoreToBeat ),
		);
		hud.appendChild( ribbon );
	}
	// Last child — CSS pins it to the far end of the HUD.
	hud.appendChild( soundToggle );
	root.appendChild( hud );

	// --- Stage + find-list side panel -------------------------------
	const body = document.createElement( 'div' );
	body.className = 'soup__body';
	root.appendChild( body );

	const stageEl = document.createElement( 'div' );
	stageEl.className = 'soup__stage';
	body.appendChild( stageEl );

	const wordsPanel = document.createElement( 'aside' );
	wordsPanel.className = 'soup__words';
	const wordsHeading = document.createElement( 'p' );
	wordsHeading.className = 'soup__words-heading';
	const wordsList = document.createElement( 'ul' );
	wordsList.className = 'soup__words-list';
	wordsPanel.append( wordsHeading, wordsList );
	body.appendChild( wordsPanel );

	const overlay = document.createElement( 'div' );
	overlay.className = 'soup__overlay';
	overlay.hidden = true;
	root.appendChild( overlay );

	const showMessage = ( text: string ): void => {
		overlay.hidden = false;
		overlay.innerHTML = '';
		const p = document.createElement( 'p' );
		p.className = 'soup__overlay-message';
		p.textContent = text;
		overlay.appendChild( p );
	};
	showMessage( __( 'Warming up the soup…' ) );

	// --- Run state --------------------------------------------------
	let disposed = false;
	let state: RunState = 'loading';
	let app: PixiApp | null = null;
	let pixi: PixiNamespace | null = null;
	let board: SoupBoard | null = null;
	let fx: SoupFx | null = null;
	let dictionary: Dictionary | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let unsubscribeWindow: ( () => void ) | null = null;
	let tickFn: ( () => void ) | null = null;

	let mode: SoupMode = readStoredMode();
	let size: SoupSize = readStoredSize();
	const dateSeed = formatDailySeed( new Date() );
	let seedString = runSeedString( dateSeed, mode, size );
	/** Whether the current run is the puzzle's first (shareable) one. */
	let officialRun = true;
	let scores: SoupScoreState = createSoupScore();
	let grid: SoupGrid | null = null;
	let wave = 1;
	let foundWords = new Set< number >();
	let chipEls: HTMLElement[] = [];
	let colorCounter = 0;
	let elapsedRun = 0;
	let timeLeft = TIME_ATTACK_START_SECONDS;
	let lastWholeSecond = -1;
	let waveTransition = -1;

	// Live selection drag.
	let anchor: SoupCell | null = null;
	let selection: SoupCell[] = [];

	const fieldWidth = (): number => app?.renderer.width ?? 640;
	const fieldHeight = (): number => app?.renderer.height ?? 480;

	const paintHud = (): void => {
		scoreEl.textContent = sprintf(
			/* translators: %s: current score. */
			__( 'Score %s' ),
			String( scores.score ),
		);
		streakEl.textContent = scores.streak > 1 ? `×${ scores.streak }` : '';
		const clock =
			'time-attack' === mode
				? formatClock( timeLeft )
				: formatClock( elapsedRun );
		timerEl.textContent = `⏱ ${ clock }`;
		timerEl.classList.toggle(
			'soup__hud-timer--low',
			'time-attack' === mode &&
				'playing' === state &&
				timeLeft <= LOW_TIME_SECONDS,
		);
		waveEl.textContent = sprintf(
			/* translators: 1: current wave number, 2: mode label. */
			__( 'Wave %1$s · %2$s' ),
			String( wave ),
			modeLabel( mode ),
		);
	};

	const renderChips = (): void => {
		wordsList.innerHTML = '';
		chipEls = [];
		if ( ! grid ) {
			wordsHeading.textContent = '';
			return;
		}
		wordsHeading.textContent = sprintf(
			/* translators: %s: number of hidden words. */
			__( 'Find %s words' ),
			String( grid.words.length ),
		);
		for ( const entry of grid.words ) {
			const li = document.createElement( 'li' );
			li.className = 'soup__word-chip';
			li.textContent = entry.word.toUpperCase();
			wordsList.appendChild( li );
			chipEls.push( li );
		}
	};

	const markChipFound = ( index: number, color: number ): void => {
		const chip = chipEls[ index ];
		if ( ! chip ) {
			return;
		}
		chip.classList.add( 'soup__word-chip--found' );
		chip.style.borderColor = cssColor( color );
		chip.style.color = cssColor( color );
	};

	const startWave = ( nextWave: number ): void => {
		if ( ! board || ! fx || ! dictionary ) {
			return;
		}
		wave = nextWave;
		waveTransition = -1;
		foundWords = new Set();
		const cfg = waveConfig( mode, size, wave );
		grid = generateSoup( {
			size: cfg.gridSize,
			wordCount: cfg.wordCount,
			minLen: cfg.minLen,
			maxLen: cfg.maxLen,
			dictionary,
			rng: waveRng( seedString, wave ),
		} );
		board.relayout( fieldWidth(), fieldHeight() );
		board.setGrid( grid );
		renderChips();
		fx.banner(
			sprintf(
				/* translators: %s: wave number. */
				__( 'Wave %s' ),
				String( wave ),
			),
			fieldWidth() / 2,
			fieldHeight() / 2,
		);
		paintHud();
	};

	const waveCleared = (): void => {
		if ( ! fx ) {
			return;
		}
		recordWaveClear( scores, wave );
		audio.waveClear();
		fx.confetti( fieldWidth(), WORD_COLORS );
		if ( 'time-attack' === mode ) {
			timeLeft += TIME_ATTACK_WAVE_BONUS_SECONDS;
		}
		if ( 'daily' === mode && isFinalDailyWave( wave ) ) {
			fx.banner(
				__( 'Soup finished!' ),
				fieldWidth() / 2,
				fieldHeight() / 2,
			);
			waveTransition = -1;
			window.setTimeout( () => {
				if ( ! disposed && 'playing' === state ) {
					gameOver( true );
				}
			}, 1200 );
			return;
		}
		waveTransition = WAVE_TRANSITION_SECONDS;
		paintHud();
	};

	const resolveSelection = ( cells: SoupCell[] ): void => {
		if ( ! grid || ! board || ! fx ) {
			return;
		}
		if ( cells.length < 2 ) {
			return;
		}
		const index = selectionMatches( grid, cells );
		if ( index >= 0 && ! foundWords.has( index ) ) {
			foundWords.add( index );
			const entry = grid.words[ index ];
			const color = WORD_COLORS[ colorCounter % WORD_COLORS.length ];
			colorCounter++;
			const points = recordFind( scores, entry.word.length );
			board.lockWord( entry.cells, color );
			markChipFound( index, color );
			audio.found( entry.word.length );
			const mid =
				entry.cells[ Math.floor( entry.cells.length / 2 ) ];
			const midPoint = board.cellCenter( mid );
			fx.floatScore( midPoint.x, midPoint.y - 8, `+${ points }`, color );
			for ( const cell of entry.cells ) {
				const p = board.cellCenter( cell );
				fx.burstAt( p.x, p.y, color );
			}
			if ( 'time-attack' === mode ) {
				timeLeft += TIME_ATTACK_WORD_BONUS_SECONDS;
			}
			if ( foundWords.size >= grid.words.length ) {
				waveCleared();
			}
		} else {
			recordMissSelection( scores );
			board.flashInvalid( cells );
			audio.invalid();
		}
		paintHud();
	};

	// --- Game over + share card -------------------------------------
	const gameOver = ( completed: boolean ): void => {
		state = 'over';
		anchor = null;
		selection = [];
		board?.clearSelection();
		audio.gameOver();
		const row = buildSoupScoreRow( scores, {
			mode,
			size: sizeDims( size ),
			wave,
			elapsedSeconds: elapsedRun,
		} );

		overlay.hidden = false;
		overlay.innerHTML = '';
		const panel = document.createElement( 'div' );
		panel.className = 'soup__over-panel';

		const heading = document.createElement( 'p' );
		heading.className = 'soup__over-heading';
		if ( ctx.challenge ) {
			heading.textContent =
				row.score > ctx.challenge.scoreToBeat
					? __( 'Game Over — challenge beaten!' )
					: __( 'Game Over — challenge missed.' );
		} else if ( completed ) {
			heading.textContent = __( 'Soup finished!' );
		} else {
			heading.textContent = __( 'Time’s up!' );
		}
		panel.appendChild( heading );

		const stats = document.createElement( 'p' );
		stats.className = 'soup__over-stats';
		stats.textContent = sprintf(
			/* translators: 1: score, 2: words found, 3: accuracy percent, 4: best streak, 5: wave reached. */
			__( 'Score %1$s — %2$s words, %3$s%% accuracy, best streak %4$s, wave %5$s.' ),
			String( row.score ),
			String( scores.wordsFound ),
			String( accuracyPercent( scores ) ),
			String( scores.bestStreak ),
			String( wave ),
		);
		panel.appendChild( stats );

		if ( officialRun ) {
			// The shareable score card — first run of this puzzle only
			// (replays could be memorized), and just a generated image.
			const shareData: ShareCardData = {
				gameTitle: __( 'Alphabet Soup' ),
				puzzleLabel: `${ modeLabel( mode ) } · ${ sizeDims( size ) } · ${ dateSeed }`,
				score: row.score,
				scoreLabel: __( 'points' ),
				stats: [
					{ label: __( 'Words' ), value: String( scores.wordsFound ) },
					{ label: __( 'WPM' ), value: String( row.meta.wpm ) },
					{
						label: __( 'Accuracy' ),
						value: `${ accuracyPercent( scores ) }%`,
					},
					{ label: __( 'Streak' ), value: String( scores.bestStreak ) },
					{ label: __( 'Wave' ), value: String( wave ) },
				],
				footer: __( 'WordPress Desktop Mode' ),
			};
			const shareCanvas = document.createElement( 'canvas' );
			shareCanvas.className = 'soup__share-canvas';
			renderShareCard( shareCanvas, shareData );
			panel.appendChild( shareCanvas );

			const shareRow = document.createElement( 'div' );
			shareRow.className = 'soup__share-actions';
			const shareStatus = document.createElement( 'span' );
			shareStatus.className = 'soup__share-status';
			shareStatus.setAttribute( 'role', 'status' );
			const shareButton = document.createElement( 'button' );
			shareButton.type = 'button';
			shareButton.className = 'soup__button soup__button--primary';
			shareButton.textContent = __( 'Share card' );
			shareButton.addEventListener( 'click', () => {
				shareStatus.textContent = '';
				void shareScoreCard(
					shareCanvas,
					`alphabet-soup-${ dateSeed }.png`,
					__( 'Alphabet Soup' ),
				).then( ( outcome ) => {
					if ( disposed ) {
						return;
					}
					switch ( outcome ) {
						case 'shared':
							shareStatus.textContent = __( 'Shared!' );
							break;
						case 'copied':
							shareStatus.textContent =
								__( 'Card copied to your clipboard.' );
							break;
						case 'downloaded':
							shareStatus.textContent = __( 'Card saved as an image.' );
							break;
						default:
							shareStatus.textContent =
								__( 'The card could not be shared.' );
					}
				} );
			} );
			shareRow.appendChild( shareButton );
			shareRow.appendChild( shareStatus );
			panel.appendChild( shareRow );
		} else {
			const replayNote = document.createElement( 'p' );
			replayNote.className = 'soup__over-replay';
			replayNote.textContent = __(
				'Replay run — share cards only go to the first run of each puzzle. A fresh soup is served tomorrow.',
			);
			panel.appendChild( replayNote );
		}

		const saveNote = document.createElement( 'p' );
		saveNote.className = 'soup__over-save';
		saveNote.textContent = __( 'Saving your score…' );
		panel.appendChild( saveNote );
		ctx.submitScore( row ).then(
			() => {
				saveNote.textContent = __( 'Score saved to the scoreboard.' );
			},
			() => {
				saveNote.textContent = __( 'Your score could not be saved.' );
			},
		);

		const actions = document.createElement( 'div' );
		actions.className = 'soup__over-actions';
		const again = document.createElement( 'button' );
		again.type = 'button';
		again.className = 'soup__button';
		again.textContent = __( 'Play again' );
		again.addEventListener( 'click', () => void requestRun( mode, size ) );
		actions.appendChild( again );
		const changeMode = document.createElement( 'button' );
		changeMode.type = 'button';
		changeMode.className = 'soup__button';
		changeMode.textContent = __( 'Change mode' );
		changeMode.addEventListener( 'click', () => showMenu() );
		actions.appendChild( changeMode );
		const quit = document.createElement( 'button' );
		quit.type = 'button';
		quit.className = 'soup__button';
		quit.textContent = __( 'Close' );
		quit.addEventListener( 'click', () => ctx.close() );
		actions.appendChild( quit );
		panel.appendChild( actions );

		overlay.appendChild( panel );
	};

	// --- Run control ------------------------------------------------
	const startRun = ( picked: SoupMode, pickedSize: SoupSize ): void => {
		mode = picked;
		size = pickedSize;
		storeMode( picked );
		storeSize( pickedSize );
		seedString = runSeedString( dateSeed, mode, size );
		officialRun = ! readPlayedToday( dateSeed ).has( seedString );
		// The ledger marks the puzzle the moment the board shows —
		// quitting mid-run and restarting is still a replay.
		markPlayed( dateSeed, seedString );
		scores = createSoupScore();
		colorCounter = 0;
		elapsedRun = 0;
		timeLeft = TIME_ATTACK_START_SECONDS;
		lastWholeSecond = -1;
		overlay.hidden = true;
		overlay.innerHTML = '';
		state = 'playing';
		fx?.clear();
		app?.ticker.start();
		startWave( 1 );
	};

	/**
	 * Gate a run start: replaying an already-played puzzle gets an
	 * upfront heads-up that the run cannot post a share card.
	 */
	const requestRun = async (
		picked: SoupMode,
		pickedSize: SoupSize,
	): Promise< void > => {
		const seed = runSeedString( dateSeed, picked, pickedSize );
		if ( readPlayedToday( dateSeed ).has( seed ) ) {
			const confirm = desktopGlobal().confirm;
			if ( typeof confirm === 'function' ) {
				const proceed = await confirm( {
					title: __( 'Replay today’s soup?' ),
					message: sprintf(
						/* translators: 1: mode label (Daily / Time Attack), 2: board dimensions (e.g. 12×12). */
						__( 'You already played today’s %1$s (%2$s). The word positions can be memorized, so replays don’t earn a share card — that stays with your first run.' ),
						modeLabel( picked ),
						sizeDims( pickedSize ),
					),
					confirmLabel: __( 'Replay anyway' ),
					cancelLabel: __( 'Not now' ),
				} );
				if ( ! proceed || disposed ) {
					return;
				}
			}
		}
		startRun( picked, pickedSize );
	};

	/** The pre-game mode menu. Also the "Change mode" target. */
	const showMenu = (): void => {
		state = 'menu';
		grid = null;
		renderChips();
		paintHud();
		overlay.hidden = false;
		overlay.innerHTML = '';

		const panel = document.createElement( 'div' );
		panel.className = 'soup__over-panel soup__menu';

		const heading = document.createElement( 'p' );
		heading.className = 'soup__over-heading';
		heading.textContent = __( 'Alphabet Soup' );
		panel.appendChild( heading );

		const tagline = document.createElement( 'p' );
		tagline.className = 'soup__over-stats';
		tagline.textContent = sprintf(
			/* translators: %s: today's puzzle date (dd-mm-yyyy). */
			__( 'One pot, whole world: everyone gets the same soup today (%s). Drag across the letters to fish the words out.' ),
			dateSeed,
		);
		panel.appendChild( tagline );

		if ( ctx.challenge ) {
			const note = document.createElement( 'p' );
			note.className = 'soup__over-stats';
			note.textContent = sprintf(
				/* translators: 1: challenger display name, 2: score to beat. */
				__( 'Challenge from %1$s — beat %2$s.' ),
				ctx.challenge.challengerName,
				String( ctx.challenge.scoreToBeat ),
			);
			panel.appendChild( note );
		}

		// Pot-size picker — each size is its own worldwide puzzle.
		const sizes = document.createElement( 'div' );
		sizes.className = 'soup__menu-sizes';
		sizes.setAttribute( 'role', 'group' );
		sizes.setAttribute( 'aria-label', __( 'Board size' ) );
		for ( const option of SOUP_SIZES ) {
			const chip = document.createElement( 'button' );
			chip.type = 'button';
			chip.className = 'soup__size-chip';
			if ( option === size ) {
				chip.classList.add( 'soup__size-chip--current' );
			}
			chip.setAttribute(
				'aria-pressed',
				option === size ? 'true' : 'false',
			);
			chip.textContent = `${ sizeLabel( option ) } · ${ sizeDims( option ) }`;
			chip.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				size = option;
				storeSize( option );
				showMenu();
			} );
			sizes.appendChild( chip );
		}
		panel.appendChild( sizes );

		const played = readPlayedToday( dateSeed );
		const options = document.createElement( 'div' );
		options.className = 'soup__menu-options';
		for ( const option of SOUP_MODES ) {
			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'soup__menu-option';
			if ( option === mode ) {
				button.classList.add( 'soup__menu-option--current' );
			}
			const label = document.createElement( 'span' );
			label.className = 'soup__menu-option-label';
			label.textContent = modeLabel( option );
			button.appendChild( label );
			const hint = document.createElement( 'span' );
			hint.className = 'soup__menu-option-hint';
			hint.textContent = modeHint( option );
			button.appendChild( hint );
			if ( played.has( runSeedString( dateSeed, option, size ) ) ) {
				const note = document.createElement( 'span' );
				note.className = 'soup__menu-option-played';
				note.textContent = __( 'Played today — replays aren’t shareable' );
				button.appendChild( note );
			}
			button.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				void requestRun( option, size );
			} );
			options.appendChild( button );
		}
		panel.appendChild( options );

		overlay.appendChild( panel );
	};

	const pause = (): void => {
		if ( 'playing' !== state ) {
			return;
		}
		state = 'paused';
		anchor = null;
		selection = [];
		board?.clearSelection();
		showMessage( __( 'Paused — click to resume.' ) );
		app?.ticker.stop();
	};

	const resume = (): void => {
		if ( 'paused' !== state ) {
			return;
		}
		state = 'playing';
		overlay.hidden = true;
		app?.ticker.start();
	};

	overlay.addEventListener( 'click', () => {
		if ( 'paused' === state ) {
			resume();
		}
	} );

	// --- Tick -------------------------------------------------------
	const tick = (): void => {
		if ( ! app || ! fx || ! board ) {
			return;
		}
		const dt = Math.min( MAX_FRAME_SECONDS, app.ticker.deltaMS / 1000 );
		fx.update( dt );
		board.update( dt );

		if ( 'playing' !== state ) {
			return;
		}
		elapsedRun += dt;
		if ( waveTransition > 0 ) {
			waveTransition -= dt;
			if ( waveTransition <= 0 ) {
				startWave( wave + 1 );
			}
		}
		if ( 'time-attack' === mode && waveTransition <= 0 ) {
			timeLeft -= dt;
			const whole = Math.ceil( timeLeft );
			if ( whole !== lastWholeSecond ) {
				lastWholeSecond = whole;
				if ( timeLeft > 0 && timeLeft <= LOW_TIME_SECONDS ) {
					audio.tick();
				}
				paintHud();
			}
			if ( timeLeft <= 0 ) {
				timeLeft = 0;
				gameOver( false );
			}
		} else {
			const whole = Math.floor( elapsedRun );
			if ( whole !== lastWholeSecond ) {
				lastWholeSecond = whole;
				paintHud();
			}
		}
	};

	// --- Pointer input ----------------------------------------------
	const canvasPoint = (
		event: PointerEvent,
	): { x: number; y: number } | null => {
		if ( ! app ) {
			return null;
		}
		const rect = app.canvas.getBoundingClientRect();
		if ( rect.width <= 0 || rect.height <= 0 ) {
			return null;
		}
		return {
			x: ( ( event.clientX - rect.left ) / rect.width ) * fieldWidth(),
			y: ( ( event.clientY - rect.top ) / rect.height ) * fieldHeight(),
		};
	};

	const onPointerDown = ( event: PointerEvent ): void => {
		if ( 'playing' !== state || ! board || ! grid || ! app ) {
			return;
		}
		const point = canvasPoint( event );
		const cell = point ? board.cellAt( point.x, point.y ) : null;
		if ( ! cell ) {
			return;
		}
		app.canvas.setPointerCapture( event.pointerId );
		anchor = cell;
		selection = [ cell ];
		board.showSelection( selection );
		audio.cellTouch( 0 );
	};

	const onPointerMove = ( event: PointerEvent ): void => {
		if ( ! anchor || ! board || ! grid ) {
			return;
		}
		const point = canvasPoint( event );
		if ( ! point ) {
			return;
		}
		const cell = board.cellAt( point.x, point.y );
		if ( ! cell ) {
			return;
		}
		const next = lineCells( anchor, cell, grid.size );
		if (
			next.length !== selection.length ||
			next[ next.length - 1 ].row !==
				selection[ selection.length - 1 ].row ||
			next[ next.length - 1 ].col !==
				selection[ selection.length - 1 ].col
		) {
			if ( next.length > selection.length ) {
				audio.cellTouch( next.length - 1 );
			}
			selection = next;
			board.showSelection( selection );
		}
	};

	const onPointerUp = (): void => {
		if ( ! anchor || ! board ) {
			return;
		}
		const cells = selection;
		anchor = null;
		selection = [];
		board.clearSelection();
		if ( 'playing' === state ) {
			resolveSelection( cells );
		}
	};

	// --- Async boot -------------------------------------------------
	const boot = async (): Promise< void > => {
		const desktop = desktopGlobal();
		if ( typeof desktop.loadModules !== 'function' ) {
			throw new Error( '[desktop-mode] wp.desktop.loadModules missing.' );
		}
		const wordsUrl = String( ctx.config.wordsUrl || '' );
		if ( '' === wordsUrl ) {
			throw new Error(
				'[desktop-mode] Alphabet Soup config lacks the framework wordsUrl.',
			);
		}
		const [ , loadedDictionary ] = await Promise.all( [
			desktop.loadModules( [ 'pixijs' ] ),
			loadDictionary( wordsUrl, {
				windowId: ctx.windowId,
				source: 'desktop-mode/alphabet-soup',
			} ),
		] );
		if ( disposed ) {
			return;
		}
		dictionary = loadedDictionary;
		pixi = getPixi();
		if ( ! pixi ) {
			throw new Error( '[desktop-mode] PixiJS failed to load.' );
		}

		const instance = new pixi.Application();
		await instance.init( {
			resizeTo: stageEl,
			backgroundAlpha: 0,
			antialias: true,
			autoDensity: true,
			resolution: Math.min( window.devicePixelRatio || 1, 2 ),
			// Own ticker — sharing `Ticker.shared` across bundles
			// crashes `Batcher.break()` (see content-graph/scene.ts).
			sharedTicker: false,
		} );
		if ( disposed ) {
			instance.destroy( { removeView: true }, { children: true, texture: true } );
			return;
		}
		app = instance;
		app.canvas.className = 'soup__canvas';
		stageEl.appendChild( app.canvas );
		app.stage.sortableChildren = true;

		board = createSoupBoard( pixi, app.stage );
		fx = createSoupFx( pixi, app.stage );
		board.relayout( fieldWidth(), fieldHeight() );

		resizeObserver = new ResizeObserver( () => {
			if ( ! app || ! board ) {
				return;
			}
			// Pixi's ResizePlugin only reacts to `window` resize —
			// resizing the desktop-mode window never fires that.
			app.resize();
			board.relayout( fieldWidth(), fieldHeight() );
		} );
		resizeObserver.observe( stageEl );

		app.canvas.addEventListener( 'pointerdown', onPointerDown );
		app.canvas.addEventListener( 'pointermove', onPointerMove );
		app.canvas.addEventListener( 'pointerup', onPointerUp );
		app.canvas.addEventListener( 'pointercancel', onPointerUp );
		app.canvas.style.touchAction = 'none';

		unsubscribeWindow =
			desktopGlobal().onWindow?.( ctx.windowId, {
				blurred: pause,
			} ) ?? null;

		tickFn = tick;
		app.ticker.add( tickFn );

		paintHud();
		showMenu();
	};

	void boot().catch( ( err ) => {
		if ( disposed ) {
			return;
		}
		showMessage(
			err instanceof Error
				? err.message
				: __( 'Alphabet Soup could not start.' ),
		);
		if ( typeof console !== 'undefined' ) {
			console.error( '[desktop-mode] Alphabet Soup boot failed:', err );
		}
	} );

	// --- Teardown ---------------------------------------------------
	return () => {
		if ( disposed ) {
			return;
		}
		disposed = true;
		audio.dispose();
		unsubscribeWindow?.();
		resizeObserver?.disconnect();
		if ( app ) {
			app.canvas.removeEventListener( 'pointerdown', onPointerDown );
			app.canvas.removeEventListener( 'pointermove', onPointerMove );
			app.canvas.removeEventListener( 'pointerup', onPointerUp );
			app.canvas.removeEventListener( 'pointercancel', onPointerUp );
			if ( tickFn ) {
				app.ticker.remove( tickFn );
			}
			app.ticker.stop();
			fx?.clear();
			board?.destroy();
			// Options-object destroy — never `destroy( true )` (Pixi
			// global-pool footgun shared with the wallpapers).
			app.destroy( { removeView: true }, { children: true, texture: true } );
			app = null;
		}
		root.remove();
	};
}
