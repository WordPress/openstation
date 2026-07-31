'use strict';

const assert = require( 'node:assert/strict' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const test = require( 'node:test' );

const game = require(
	'../games/popup-breaker/assets/popup-breaker-0.7.0.js'
);
const root = path.resolve( __dirname, '..' );

function runPolicy( seed, controlled ) {
	let state = game.startGame( game.createGame() );
	const ball = state.balls[ 0 ];
	ball.x = 120 + seed * 20;
	ball.vx = ( seed % 2 ? -1 : 1 ) * ( 30 + seed * 8 );
	ball.vy = -Math.sqrt(
		Math.max( 1, ball.speed ** 2 - ball.vx ** 2 )
	);
	for (
		let tick = 0;
		tick < 13_000 && state.phase === 'playing';
		tick += 1
	) {
		let input = {};
		if ( controlled ) {
			const descending =
				state.balls
					.filter( ( candidate ) => candidate.vy > 0 )
					.sort( ( first, second ) => second.y - first.y )[ 0 ] ||
				state.balls[ 0 ];
			if ( descending ) {
				const center =
					state.paddle.x + state.paddle.w / 2;
				input =
					descending.x < center - 3
						? { left: true }
						: { right: true };
			}
		}
		state = game.stepGame( state, input );
	}
	return state;
}

function closeById( state, id ) {
	const index = state.popups.findIndex( ( popup ) => popup.id === id );
	assert.notEqual( index, -1, `${ id } should be active` );
	const ball = state.balls[ 0 ];
	assert.ok( ball, 'a source ball should exist' );
	assert.equal( game.closePopup( state, index, ball ), true );
}

test( '0.7.0 is a new deterministic rules cohort over frozen 0.6.1', () => {
	assert.equal( game.ASSET_VERSION, '0.7.0' );
	assert.equal( game.RULES_VERSION, 3 );
	assert.equal( game.POPUP_TOTAL, 4 );
	assert.equal( game.ARCHIVE_SWEEP_SECONDS, 9 );
	assert.notEqual(
		game.stepGame,
		require(
			'../games/popup-breaker/assets/popup-breaker-0.6.1.js'
		).stepGame
	);
} );

test( 'real left and right input move the paddle in opposite directions', () => {
	let left = game.startGame( game.createGame() );
	let right = game.startGame( game.createGame() );
	const center = left.paddle.x;
	for ( let tick = 0; tick < 45; tick += 1 ) {
		left = game.stepGame( left, { left: true } );
		right = game.stepGame( right, { right: true } );
	}
	assert.ok( left.paddle.x < center - 20 );
	assert.ok( right.paddle.x > center + 20 );
	assert.ok( left.controlStats.intentFrames >= 40 );
	assert.ok( right.controlStats.intentFrames >= 40 );
} );

test( 'deliberate steering materially dominates idle/fixed-paddle cohorts', () => {
	const idle = [];
	const controlled = [];
	for ( let seed = 0; seed < 12; seed += 1 ) {
		idle.push( runPolicy( seed, false ) );
		controlled.push( runPolicy( seed, true ) );
	}
	const averageCloses = ( cohort ) =>
		cohort.reduce( ( total, state ) => total + state.popupCloses, 0 ) /
		cohort.length;
	const rescues = ( cohort ) =>
		cohort.filter( ( state ) => state.result === 'rescued' ).length;

	assert.ok(
		averageCloses( controlled ) >= averageCloses( idle ) + 1.5,
		`${ averageCloses( controlled ) } controlled vs ${ averageCloses( idle ) } idle`
	);
	assert.ok( rescues( controlled ) >= 9 );
	assert.ok( rescues( idle ) <= 2 );
	assert.ok(
		controlled.every(
			( state ) => state.controlStats.aimedReturns > 0
		)
	);
} );

test( 'popup identity order and objective availability remain truthful', () => {
	const state = game.startGame( game.createGame() );
	game.spawnWave( state, 0 );
	assert.equal( state.objective.currentId, 'download-trap' );
	assert.equal( state.objective.activeThreatId, 'download' );
	closeById( state, 'download' );

	game.spawnWave( state, 1 );
	assert.equal( state.objective.currentId, 'toolbar-swarm' );
	assert.ok( [ 'toolbar', 'casino' ].includes(
		state.objective.activeThreatId
	) );
	closeById( state, 'casino' );
	closeById( state, 'toolbar' );

	assert.deepEqual(
		state.closedPopupIds,
		[ 'download', 'toolbar', 'casino' ]
	);
	assert.equal( state.objective.currentId, 'malware-boss' );
	assert.equal( state.objective.currentStatus, 'incoming' );
	assert.equal( state.objective.activeThreatId, null );
	assert.equal(
		state.objective.states.find(
			( objective ) => objective.id === 'malware-boss'
		).status,
		'incoming'
	);

	game.spawnWave( state, 2 );
	assert.equal( state.objective.activeThreatId, 'malware-boss' );
	assert.equal( state.objective.currentStatus, 'active' );
} );

test( '3 of 4 popups at 80 percent is a truthful partial result', () => {
	let state = game.startGame( game.createGame() );
	state.closedPopupIds = [ 'download', 'toolbar', 'casino' ];
	state.popupCloses = 3;
	state.spawnedPopupIds = [ ...game.POPUP_ORDER ];
	state.waveIndex = 3;
	for ( let index = 0; index < 24; index += 1 ) {
		state.bricks[ index ].destroyed = true;
		state.bricks[ index ].hp = 0;
	}
	state.bricksDestroyed = 24;
	state.activeTime = game.ROUND_SECONDS - 0.01;
	state.timeLeft = 0.01;
	state = game.stepGame( state, {}, 0.05 );

	assert.equal( state.phase, 'results' );
	assert.equal( state.result, 'overrun' );
	assert.equal( state.terminalSnapshot.popupsClosed, 3 );
	assert.equal( state.terminalSnapshot.restored, 80 );
	assert.equal(
		state.terminalSnapshot.firstUnfinishedObjectiveId,
		'malware-boss'
	);
	assert.equal( game.replayTip( state ).includes( '3 of 4' ), true );
} );

test( 'fourth X closure wins same-tick arbitration over final-life loss', () => {
	let state = game.startGame( game.createGame() );
	state.closedPopupIds = [ 'download', 'toolbar', 'casino' ];
	state.popupCloses = 3;
	state.spawnedPopupIds = [ ...game.POPUP_ORDER ];
	state.waveIndex = 3;
	state.lives = 1;
	state.popups = [
		{
			id: 'malware-boss',
			x: 144,
			y: 580,
			w: 192,
			h: 96,
			kind: 'boss',
			moving: false,
			solid: true,
			age: 1,
			baseX: 144,
			wave: 3,
		},
	];
	const close = game.popupCloseRect( state.popups[ 0 ] );
	state.balls = [
		{
			...state.balls[ 0 ],
			x: close.x + close.w / 2,
			y: close.y + 7,
			vx: 0,
			vy: 0,
			stuck: false,
		},
	];
	state = game.stepGame( state, {}, game.FIXED_STEP );

	assert.equal( state.popupCloses, 4 );
	assert.deepEqual( state.closedPopupIds, [ ...game.POPUP_ORDER ] );
	assert.equal( state.phase, 'playing' );
	assert.equal( state.finale.phase, 'archive-sweep' );
	assert.equal( state.lives, 1 );
	assert.ok( state.balls.length > 0 );
	assert.equal( state.popupCloseBeat.popupId, 'malware-boss' );

	while ( state.phase === 'playing' ) {
		state = game.stepGame( state );
	}
	assert.equal( state.result, 'rescued' );
	assert.equal( state.terminalSnapshot.popupsClosed, 4 );
} );

test( 'Archive Sweep replaces the dead tail with a bounded finale', () => {
	let state = game.startGame( game.createGame() );
	state.closedPopupIds = [ ...game.POPUP_ORDER ];
	state.popupCloses = 4;
	state.spawnedPopupIds = [ ...game.POPUP_ORDER ];
	state.waveIndex = 3;
	game.beginArchiveSweep( state );
	const startedAt = state.activeTime;
	while ( state.phase === 'playing' ) {
		state = game.stepGame( state );
	}
	const finaleSeconds = state.activeTime - startedAt;

	assert.equal( state.result, 'rescued' );
	assert.ok(
		finaleSeconds >= game.ARCHIVE_SWEEP_MIN_SECONDS,
		`finale was ${ finaleSeconds }s`
	);
	assert.ok( finaleSeconds <= 9.1, `finale was ${ finaleSeconds }s` );
	assert.equal( state.endReason, 'archive-sweep' );
} );

test( 'terminal snapshot is deeply immutable and score-recomputable', () => {
	let state = game.startGame( game.createGame() );
	state.closedPopupIds = [ ...game.POPUP_ORDER ];
	state.popupCloses = 4;
	state.spawnedPopupIds = [ ...game.POPUP_ORDER ];
	state.waveIndex = 3;
	for ( const brick of state.bricks ) {
		brick.destroyed = true;
		brick.hp = 0;
	}
	state.bricksDestroyed = state.bricks.length;
	game.beginArchiveSweep( state );
	while ( state.phase === 'playing' ) {
		state = game.stepGame( state );
	}
	const snapshot = state.terminalSnapshot;
	const recomputed = Object.values( snapshot.scoreBreakdown ).reduce(
		( total, points ) => total + points,
		0
	);

	assert.equal( snapshot.rulesVersion, 3 );
	assert.equal( snapshot.score, recomputed );
	assert.ok( Object.isFrozen( snapshot ) );
	assert.ok( Object.isFrozen( snapshot.closedPopupIds ) );
	assert.ok( Object.isFrozen( snapshot.objectiveStates ) );
	assert.ok( Object.isFrozen( snapshot.scoreBreakdown ) );
	assert.throws(
		() => snapshot.closedPopupIds.push( 'impossible' ),
		TypeError
	);
	const after = game.stepGame( state, { right: true }, 0.05 );
	assert.equal( after, state );
	assert.equal( after.terminalSnapshot, snapshot );

	const summary = game.resultSummary( state );
	assert.equal( summary.terminalSnapshot, snapshot );
	assert.equal( summary.scoreBreakdown, snapshot.scoreBreakdown );
} );

test( 'restart produces an equivalent clean rules-v3 state', () => {
	let state = runPolicy( 3, true );
	assert.equal( state.phase, 'results' );
	state = game.restartGame( state );
	assert.deepEqual( state, game.createGame() );
	assert.equal( state.terminalSnapshot, null );
	assert.deepEqual( state.closedPopupIds, [] );
	assert.equal( state.finale.phase, 'inactive' );
} );

test( 'renderer draws both normal and reduced-motion frames', async () => {
	const calls = [];
	const renderer = {
		canvas: {},
		mapPointer() {},
		render( ...args ) {
			calls.push( args );
		},
		destroy() {},
	};
	const normal = await game.createExperienceRenderer(
		() => renderer,
		{},
		{ reducedMotion: false }
	);
	const state = game.createGame();
	normal.render( state, state, 0.5, 1 / 60 );
	assert.equal( calls.length, 1 );
	assert.equal( calls[ 0 ][ 0 ], state );
	assert.equal( calls[ 0 ][ 2 ], 0.5 );

	const reduced = await game.createExperienceRenderer(
		() => renderer,
		{},
		{ reducedMotion: true }
	);
	reduced.render( state, state, 0.5, 1 / 60 );
	assert.equal( calls.length, 2 );
	assert.equal( calls[ 1 ][ 0 ].lastEvent, null );
	assert.match( String( calls[ 1 ][ 0 ].balls[ 0 ].id ), /-reduced-1$/ );
	assert.equal( calls[ 1 ][ 0 ], calls[ 1 ][ 1 ] );
	assert.equal( calls[ 1 ][ 2 ], 1 );
	assert.equal( calls[ 1 ][ 3 ], 0 );
} );

test( 'runtime owns durable UI hooks, scoped activation, reset, and subscription', () => {
	const source = fs.readFileSync(
		path.join(
			root,
			'games/popup-breaker/assets/popup-breaker-0.7.0.js'
		),
		'utf8'
	);
	for ( const hook of [
		'siege-game--experience-070',
		'data-role="restored-reveal"',
		'siege-archive-receipt',
		'siege-popup-close-beat',
		'data-role="receipt-outcome"',
	] ) {
		assert.match( source, new RegExp( hook ) );
	}
	assert.match( source, /function installResultsFocusGate/ );
	assert.match( source, /if \( isInteractive\( event\.target \) \)/ );
	assert.match( source, /function resetInput\(\)/ );
	assert.match( source, /function onBlur\(\)[\s\S]*resetInput\(\)/ );
	assert.match(
		source,
		/function onVisibilityChange\(\)[\s\S]*resetInput\(\)/
	);
	assert.match( source, /subscribe\( listener \)/ );
	assert.match( source, /prefers-reduced-motion: reduce/ );
} );
