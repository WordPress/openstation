/**
 * Inkfall — game orchestrator.
 *
 * Owns the run lifecycle (loading → playing → paused → over), the
 * pausable clock, the spawner, the tick loop, and the HUD. Mounted
 * by the framework's launch context; everything async double-checks
 * `disposed` so closing the window mid-load never leaks a Pixi app.
 *
 * Pixi lifecycle follows the content-graph precedent: PixiJS from
 * `wp.desktop.loadModules(['pixijs'])`, `sharedTicker: false` (a
 * shared ticker crashes `Batcher.break()` across bundles), and the
 * options-object destroy — never `destroy( true )`.
 *
 * @since 0.9.6
 */

import { __, sprintf } from '../../i18n';
import type { GameLaunchContext } from '../types';
import { createGameAudio } from './audio';
import { loadDictionary, type Dictionary } from './dictionary';
import {
	DIFFICULTY_MODES,
	MAX_RAMP_SECONDS,
	REFERENCE_HEIGHT,
	STARTING_LIVES,
	difficultyAt,
	level as levelAt,
	type DifficultyMode,
} from './difficulty';
import { createFxLayer, type FxLayer } from './fx';
import { createGameInput, type GameInput } from './input';
import { createMatcher, type MatchableWord, type Matcher } from './matching';
import {
	accuracyPercent,
	buildScoreRow,
	createScoreState,
	recordCompletion,
	recordCorrectKey,
	recordMiss,
	recordTypo,
	wordsPerMinute,
	type ScoreState,
} from './scoring';
import {
	WORD_FONT_SIZE,
	buildWordSprite,
	paintPaper,
	setMatchedCount,
	type WordSprite,
} from './scene';
import { getPixi, type PixiApp, type PixiGraphics, type PixiNamespace } from './pixi-types';

type RunState = 'loading' | 'menu' | 'playing' | 'paused' | 'over';

/** localStorage key remembering the last difficulty pick. */
const MODE_STORAGE_KEY = 'desktop-mode/inkfall-mode';

function modeLabel( mode: DifficultyMode ): string {
	switch ( mode ) {
		case 'medium':
			return __( 'Medium' );
		case 'hard':
			return __( 'Hard' );
		default:
			return __( 'Easy' );
	}
}

function modeHint( mode: DifficultyMode ): string {
	switch ( mode ) {
		case 'medium':
			return __( 'Brisk from the first word.' );
		case 'hard':
			return __( 'Fast ink, long words. Good luck.' );
		default:
			return __( 'A gentle warm-up that builds.' );
	}
}

function readStoredMode(): DifficultyMode {
	try {
		const stored = window.localStorage.getItem( MODE_STORAGE_KEY );
		if ( stored && ( DIFFICULTY_MODES as readonly string[] ).includes( stored ) ) {
			return stored as DifficultyMode;
		}
	} catch {
		/* storage unavailable — default */
	}
	return 'easy';
}

function storeMode( mode: DifficultyMode ): void {
	try {
		window.localStorage.setItem( MODE_STORAGE_KEY, mode );
	} catch {
		/* storage unavailable — best effort */
	}
}

interface FallingWord {
	id: number;
	text: string;
	sprite: WordSprite;
	/** Per-word ±10% speed jitter multiplier. */
	jitter: number;
}

interface DesktopLike {
	loadModules?: ( ids: string[] ) => Promise< void >;
	onWindow?: (
		id: string,
		handlers: { blurred?: () => void; focused?: () => void },
	) => () => void;
}

function desktopGlobal(): DesktopLike {
	return (
		( window.wp as { desktop?: DesktopLike } | undefined )?.desktop ?? {}
	);
}

/** Cap a frame delta so a background-tab hiccup can't teleport words. */
const MAX_FRAME_SECONDS = 0.05;

/** Minimum gap between forced "field is empty" spawns. */
const EMPTY_FIELD_SPAWN_GAP_MS = 250;

export function mountInkfall( ctx: GameLaunchContext ): () => void {
	const root = document.createElement( 'div' );
	root.className = 'inkfall';
	ctx.container.appendChild( root );

	// --- HUD (DOM, above the canvas) --------------------------------
	const audio = createGameAudio();

	const hud = document.createElement( 'div' );
	hud.className = 'inkfall__hud';
	const scoreEl = document.createElement( 'span' );
	scoreEl.className = 'inkfall__hud-score';
	const streakEl = document.createElement( 'span' );
	streakEl.className = 'inkfall__hud-streak';
	const livesEl = document.createElement( 'span' );
	livesEl.className = 'inkfall__hud-lives';
	const levelEl = document.createElement( 'span' );
	levelEl.className = 'inkfall__hud-level';
	const soundToggle = document.createElement( 'button' );
	soundToggle.type = 'button';
	soundToggle.className = 'inkfall__hud-sound';
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
	hud.append( scoreEl, streakEl, livesEl, levelEl );
	if ( ctx.challenge ) {
		const ribbon = document.createElement( 'span' );
		ribbon.className = 'inkfall__hud-ribbon';
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

	const stageEl = document.createElement( 'div' );
	stageEl.className = 'inkfall__stage';
	root.appendChild( stageEl );

	const overlay = document.createElement( 'div' );
	overlay.className = 'inkfall__overlay';
	overlay.hidden = true;
	root.appendChild( overlay );

	const showMessage = ( text: string ): void => {
		overlay.hidden = false;
		overlay.innerHTML = '';
		const p = document.createElement( 'p' );
		p.className = 'inkfall__overlay-message';
		p.textContent = text;
		overlay.appendChild( p );
	};
	showMessage( __( 'Loading the notebook…' ) );

	// --- Run state --------------------------------------------------
	let disposed = false;
	let state: RunState = 'loading';
	let app: PixiApp | null = null;
	let pixi: PixiNamespace | null = null;
	let fx: FxLayer | null = null;
	let paper: PixiGraphics | null = null;
	let dictionary: Dictionary | null = null;
	let input: GameInput | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let unsubscribeWindow: ( () => void ) | null = null;
	let tickFn: ( () => void ) | null = null;

	const matcher: Matcher = createMatcher();
	let scores: ScoreState = createScoreState();
	let live: FallingWord[] = [];
	let lives = STARTING_LIVES;
	let clockSeconds = 0;
	let spawnTimerMs = 0;
	let lastSpawnAtMs = 0;
	let elapsedTotalMs = 0;
	let nextWordId = 1;
	let mode: DifficultyMode = readStoredMode();

	const paintHud = (): void => {
		scoreEl.textContent = sprintf(
			/* translators: %s: current score. */
			__( 'Score %s' ),
			String( scores.score ),
		);
		streakEl.textContent =
			scores.streak > 1 ? `×${ scores.streak }` : '';
		livesEl.textContent = '●'.repeat( lives ) + '○'.repeat(
			Math.max( 0, STARTING_LIVES - lives ),
		);
		levelEl.textContent = sprintf(
			/* translators: 1: current level number, 2: difficulty label. */
			__( 'Level %1$s · %2$s' ),
			String( levelAt( clockSeconds ) ),
			modeLabel( mode ),
		);
	};

	const fieldWidth = (): number => app?.renderer.width ?? 600;
	const fieldHeight = (): number => app?.renderer.height ?? REFERENCE_HEIGHT;
	const bottomY = (): number => fieldHeight() - 10;

	const matchable = (): MatchableWord[] =>
		live.map( ( word ) => ( {
			id: word.id,
			text: word.text,
			y: word.sprite.container.y,
		} ) );

	const removeWord = ( word: FallingWord, keepSprite: boolean ): void => {
		live = live.filter( ( entry ) => entry.id !== word.id );
		matcher.forget( word.id );
		if ( ! keepSprite && app ) {
			app.stage.removeChild( word.sprite.container );
			word.sprite.container.destroy( { children: true } );
		}
	};

	const spawnWord = (): void => {
		if ( ! app || ! pixi || ! dictionary ) {
			return;
		}
		const snapshot = difficultyAt( clockSeconds, mode );
		const initials = new Set( live.map( ( word ) => word.text[ 0 ] ) );
		const text = dictionary.pick(
			snapshot.minLength,
			snapshot.maxLength,
			Math.random,
			initials,
		);
		if ( '' === text ) {
			return;
		}
		const sprite = buildWordSprite( pixi, text );
		const margin = Math.min( 64, Math.round( fieldWidth() * 0.08 ) );
		const maxX = Math.max(
			margin + 8,
			fieldWidth() - sprite.width - 16,
		);
		sprite.container.x =
			margin + 8 + Math.random() * Math.max( 1, maxX - margin - 8 );
		sprite.container.y = -WORD_FONT_SIZE - 4;
		app.stage.addChild( sprite.container );
		live.push( {
			id: nextWordId++,
			text,
			sprite,
			jitter: 0.9 + Math.random() * 0.2,
		} );
		lastSpawnAtMs = elapsedTotalMs;
	};

	const applyHighlight = (): void => {
		const lock = matcher.state();
		for ( const word of live ) {
			setMatchedCount(
				word.sprite,
				word.id === lock.targetId ? lock.matchedCount : 0,
			);
		}
	};

	const completeWord = ( wordId: number ): void => {
		const word = live.find( ( entry ) => entry.id === wordId );
		if ( ! word || ! fx ) {
			return;
		}
		const height = fieldHeight();
		const heightFraction =
			( bottomY() - word.sprite.container.y ) / Math.max( 1, height );
		recordCompletion( scores, word.text.length, heightFraction );
		// Out of play immediately (a second word can be typed while
		// the note flies), but the sprite stays put until impact.
		const sprite = word.sprite;
		removeWord( word, true );
		setMatchedCount( sprite, sprite.text.length );
		const lastLetter = sprite.text[ sprite.text.length - 1 ];
		const targetX = sprite.container.x + sprite.width / 2;
		const targetY = sprite.container.y + WORD_FONT_SIZE / 2;
		fx.launchNote(
			fieldWidth() / 2,
			fieldHeight() - 12,
			targetX,
			targetY,
			() => {
				fx?.tearWord( sprite );
				audio.wordBurst( lastLetter );
			},
		);
		paintHud();
	};

	const gameOver = (): void => {
		state = 'over';
		matcher.release();
		applyHighlight();
		const elapsed = Math.min( clockSeconds, MAX_RAMP_SECONDS );
		const row = buildScoreRow( scores, elapsed, levelAt( clockSeconds ), mode );

		overlay.hidden = false;
		overlay.innerHTML = '';
		const panel = document.createElement( 'div' );
		panel.className = 'inkfall__over-panel';

		const heading = document.createElement( 'p' );
		heading.className = 'inkfall__over-heading';
		if ( ctx.challenge ) {
			heading.textContent =
				row.score > ctx.challenge.scoreToBeat
					? __( 'Game Over — challenge beaten!' )
					: __( 'Game Over — challenge missed.' );
		} else {
			heading.textContent = __( 'Game Over' );
		}
		panel.appendChild( heading );

		const stats = document.createElement( 'p' );
		stats.className = 'inkfall__over-stats';
		stats.textContent = sprintf(
			/* translators: 1: score, 2: words typed, 3: words per minute, 4: accuracy percent. */
			__( 'Score %1$s — %2$s words, %3$s WPM, %4$s%% accuracy.' ),
			String( row.score ),
			String( scores.wordsCompleted ),
			String( wordsPerMinute( scores, Math.max( 1, elapsed ) ) ),
			String( accuracyPercent( scores ) ),
		);
		panel.appendChild( stats );

		const saveNote = document.createElement( 'p' );
		saveNote.className = 'inkfall__over-save';
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
		actions.className = 'inkfall__over-actions';
		const again = document.createElement( 'button' );
		again.type = 'button';
		again.className = 'inkfall__button inkfall__button--primary';
		again.textContent = __( 'Play again' );
		again.addEventListener( 'click', () => {
			startRun( mode );
		} );
		actions.appendChild( again );
		const changeMode = document.createElement( 'button' );
		changeMode.type = 'button';
		changeMode.className = 'inkfall__button';
		changeMode.textContent = __( 'Change difficulty' );
		changeMode.addEventListener( 'click', () => {
			showMenu();
		} );
		actions.appendChild( changeMode );
		const quit = document.createElement( 'button' );
		quit.type = 'button';
		quit.className = 'inkfall__button';
		quit.textContent = __( 'Close' );
		quit.addEventListener( 'click', () => ctx.close() );
		actions.appendChild( quit );
		panel.appendChild( actions );

		overlay.appendChild( panel );
	};

	/** Clear the field back to a fresh, not-yet-started state. */
	const clearField = (): void => {
		for ( const word of live.slice() ) {
			removeWord( word, false );
		}
		fx?.clear();
		scores = createScoreState();
		lives = STARTING_LIVES;
		clockSeconds = 0;
		spawnTimerMs = 0;
		matcher.release();
	};

	const startRun = ( picked: DifficultyMode ): void => {
		mode = picked;
		storeMode( picked );
		clearField();
		overlay.hidden = true;
		overlay.innerHTML = '';
		state = 'playing';
		app?.ticker.start();
		paintHud();
		input?.focus();
	};

	/** The pre-game difficulty menu. Also the "Change difficulty" target. */
	const showMenu = (): void => {
		clearField();
		state = 'menu';
		paintHud();
		overlay.hidden = false;
		overlay.innerHTML = '';

		const panel = document.createElement( 'div' );
		panel.className = 'inkfall__over-panel inkfall__menu';

		const heading = document.createElement( 'p' );
		heading.className = 'inkfall__over-heading';
		heading.textContent = __( 'Choose your pace' );
		panel.appendChild( heading );

		if ( ctx.challenge ) {
			const note = document.createElement( 'p' );
			note.className = 'inkfall__over-stats';
			note.textContent = sprintf(
				/* translators: 1: challenger display name, 2: score to beat. */
				__( 'Challenge from %1$s — beat %2$s.' ),
				ctx.challenge.challengerName,
				String( ctx.challenge.scoreToBeat ),
			);
			panel.appendChild( note );
		}

		const options = document.createElement( 'div' );
		options.className = 'inkfall__menu-options';
		for ( const option of DIFFICULTY_MODES ) {
			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'inkfall__menu-option';
			if ( option === mode ) {
				button.classList.add( 'inkfall__menu-option--current' );
			}
			const label = document.createElement( 'span' );
			label.className = 'inkfall__menu-option-label';
			label.textContent = modeLabel( option );
			button.appendChild( label );
			const hint = document.createElement( 'span' );
			hint.className = 'inkfall__menu-option-hint';
			hint.textContent = modeHint( option );
			button.appendChild( hint );
			button.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				startRun( option );
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
		input?.focus();
	};

	overlay.addEventListener( 'click', () => {
		if ( 'paused' === state ) {
			resume();
		}
	} );

	const tick = (): void => {
		if ( ! app || ! fx ) {
			return;
		}
		const dt = Math.min( MAX_FRAME_SECONDS, app.ticker.deltaMS / 1000 );
		elapsedTotalMs += app.ticker.deltaMS;
		fx.update( dt );

		if ( 'playing' !== state ) {
			return;
		}
		clockSeconds += dt;
		const snapshot = difficultyAt( clockSeconds, mode );
		const speedScale = fieldHeight() / REFERENCE_HEIGHT;

		// Spawner: interval-driven, plus an immediate spawn whenever
		// the field is empty (never leave the player waiting).
		spawnTimerMs += dt * 1000;
		const canSpawn = live.length < snapshot.maxConcurrent;
		if ( canSpawn && spawnTimerMs >= snapshot.spawnIntervalMs ) {
			spawnTimerMs = 0;
			spawnWord();
		} else if (
			live.length === 0 &&
			elapsedTotalMs - lastSpawnAtMs > EMPTY_FIELD_SPAWN_GAP_MS
		) {
			spawnTimerMs = 0;
			spawnWord();
		}

		// Fall + bottom check.
		const floor = bottomY();
		for ( const word of live.slice() ) {
			word.sprite.container.y +=
				snapshot.fallSpeed * speedScale * word.jitter * dt;
			if ( word.sprite.container.y + WORD_FONT_SIZE >= floor ) {
				const centerX = word.sprite.container.x + word.sprite.width / 2;
				removeWord( word, false );
				fx.splashBlot( centerX, floor );
				audio.miss();
				recordMiss( scores );
				lives--;
				applyHighlight();
				paintHud();
				if ( lives <= 0 ) {
					gameOver();
					return;
				}
			}
		}
	};

	// --- Input wiring ----------------------------------------------
	const onLetter = ( letter: string ): void => {
		if ( 'playing' !== state ) {
			return;
		}
		const result = matcher.handleKey( letter, matchable() );
		switch ( result.kind ) {
			case 'locked':
			case 'advanced':
				recordCorrectKey( scores );
				audio.letter( letter );
				applyHighlight();
				break;
			case 'completed':
				recordCorrectKey( scores );
				audio.letter( letter );
				completeWord( result.targetId );
				applyHighlight();
				break;
			case 'typo': {
				recordTypo( scores );
				audio.typo();
				// Brief visual protest from the locked word.
				const word = live.find(
					( entry ) => entry.id === result.targetId,
				);
				if ( word ) {
					word.sprite.container.alpha = 0.4;
					window.setTimeout( () => {
						word.sprite.container.alpha = 1;
					}, 120 );
				}
				paintHud();
				break;
			}
			default:
				break;
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
			throw new Error( '[desktop-mode] Inkfall config lacks wordsUrl.' );
		}
		const [ , loadedDictionary ] = await Promise.all( [
			desktop.loadModules( [ 'pixijs' ] ),
			loadDictionary( wordsUrl, { windowId: ctx.windowId } ),
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
		app.canvas.className = 'inkfall__canvas';
		stageEl.appendChild( app.canvas );
		app.stage.sortableChildren = true;

		paper = new pixi.Graphics();
		paper.zIndex = 0;
		app.stage.addChild( paper );
		paintPaper( paper, fieldWidth(), fieldHeight() );

		fx = createFxLayer( pixi, app.stage );

		resizeObserver = new ResizeObserver( () => {
			if ( ! app || ! paper ) {
				return;
			}
			// Pixi's ResizePlugin only reacts to `window` resize —
			// resizing the desktop-mode window never fires that, so
			// without this call the renderer keeps its old size while
			// CSS stretches the canvas (words drift off-page).
			app.resize();
			paintPaper( paper, fieldWidth(), fieldHeight() );
			// Keep live words inside the new page width.
			const margin = Math.min( 64, Math.round( fieldWidth() * 0.08 ) );
			for ( const word of live ) {
				const maxX = fieldWidth() - word.sprite.width - 16;
				if ( word.sprite.container.x > maxX ) {
					word.sprite.container.x = Math.max( margin + 8, maxX );
				}
			}
		} );
		resizeObserver.observe( stageEl );

		input = createGameInput( root, {
			onLetter,
			onBackspace: () => {
				matcher.handleBackspace();
				applyHighlight();
			},
			onEscape: () => {
				matcher.release();
				applyHighlight();
			},
		} );

		unsubscribeWindow =
			desktopGlobal().onWindow?.( ctx.windowId, {
				blurred: pause,
				focused: () => input?.focus(),
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
				: __( 'Inkfall could not start.' ),
		);
		if ( typeof console !== 'undefined' ) {
			console.error( '[desktop-mode] Inkfall boot failed:', err );
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
		input?.dispose();
		if ( app ) {
			if ( tickFn ) {
				app.ticker.remove( tickFn );
			}
			app.ticker.stop();
			fx?.clear();
			// Options-object destroy — never `destroy( true )` (Pixi
			// global-pool footgun shared with the wallpapers).
			app.destroy( { removeView: true }, { children: true, texture: true } );
			app = null;
		}
		root.remove();
	};
}
