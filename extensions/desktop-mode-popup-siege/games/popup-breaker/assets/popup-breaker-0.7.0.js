( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.6.1.js' )
				: null;
	const api = factory( global, base );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.PopupBreaker = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function ( global, base ) {
	'use strict';

	if ( ! base || base.ASSET_VERSION !== '0.6.1' ) {
		throw new Error( 'Popup Siege 0.6.1 is required.' );
	}

	const ASSET_VERSION = '0.7.0';
	const RULES_VERSION = 3;
	const POPUP_TOTAL = 4;
	const ARCHIVE_SWEEP_SECONDS = 9;
	const ARCHIVE_SWEEP_MIN_SECONDS = 6;
	const ARCHIVE_PURGE_INTERVAL = 0.55;
	const POINTER_MAX_SPEED = 560;
	const INTENT_MIN_SPEED = 32;
	const CLOSE_BEAT_SECONDS = 1.4;
	const POPUP_ORDER = Object.freeze( [
		'download',
		'toolbar',
		'casino',
		'malware-boss',
	] );
	const POPUP_LABELS = Object.freeze( {
		download: 'DOWNLOAD TRAP',
		toolbar: 'TOOLBAR',
		casino: 'CASINO AD',
		'malware-boss': 'MALWARE BOSS',
	} );
	const OBJECTIVES = Object.freeze( [
		Object.freeze( {
			number: 1,
			id: 'download-trap',
			label: 'DOWNLOAD TRAP',
			targetIds: Object.freeze( [ 'download' ] ),
			objective: 'Steer a return into the first red X.',
		} ),
		Object.freeze( {
			number: 2,
			id: 'toolbar-swarm',
			label: 'TOOLBAR SWARM',
			targetIds: Object.freeze( [ 'toolbar', 'casino' ] ),
			objective: 'Close both red X targets in the ad swarm.',
		} ),
		Object.freeze( {
			number: 3,
			id: 'malware-boss',
			label: 'MALWARE BOSS',
			targetIds: Object.freeze( [ 'malware-boss' ] ),
			objective: 'Track the moving red X.',
		} ),
		Object.freeze( {
			number: 4,
			id: 'archive-sweep',
			label: 'ARCHIVE SWEEP',
			targetIds: Object.freeze( [] ),
			objective: 'Keep the recovery beam alive for the final sweep.',
		} ),
	] );
	const RESTORATION_REVEALS = Object.freeze( [
		Object.freeze( {
			id: 'telescope-photo',
			title: 'MIRA’S TELESCOPE PHOTO',
			copy: 'A grainy crescent moon, scanned at the kitchen table.',
		} ),
		Object.freeze( {
			id: 'meteor-journal',
			title: 'OCTOBER METEOR JOURNAL',
			copy: '“11:42 PM — one bright green streak over the launchpad.”',
		} ),
		Object.freeze( {
			id: 'comet-counter',
			title: 'COMET COUNTER 000042',
			copy: 'Forty-two visitors believed the truth was out there.',
		} ),
		Object.freeze( {
			id: 'guestbook-webring',
			title: 'SPACE NERDS WEBRING',
			copy: 'Previous ◀ Mira’s Sky Log ▶ Next',
		} ),
		Object.freeze( {
			id: 'launchpad-archive',
			title: 'CAPE CANAVERAL ARCHIVE',
			copy: 'Last mirrored: October 31, 1999. Restored today.',
		} ),
	] );

	function clamp( value, minimum, maximum ) {
		return Math.max( minimum, Math.min( maximum, value ) );
	}

	function deepFreeze( value ) {
		if ( ! value || typeof value !== 'object' || Object.isFrozen( value ) ) {
			return value;
		}
		for ( const nested of Object.values( value ) ) {
			deepFreeze( nested );
		}
		return Object.freeze( value );
	}

	function sortedPopupIds( ids = [] ) {
		const unique = new Set(
			ids.filter( ( id ) => POPUP_ORDER.includes( id ) )
		);
		return POPUP_ORDER.filter( ( id ) => unique.has( id ) );
	}

	function inferredClosedPopupIds( state = {} ) {
		if ( Array.isArray( state.closedPopupIds ) ) {
			return sortedPopupIds( state.closedPopupIds );
		}
		const count = clamp(
			Math.floor( Number( state.popupCloses ) || 0 ),
			0,
			POPUP_TOTAL
		);
		return POPUP_ORDER.slice( 0, count );
	}

	function inferredSpawnedPopupIds( state = {} ) {
		const ids = new Set(
			Array.isArray( state.spawnedPopupIds )
				? state.spawnedPopupIds
				: []
		);
		for ( let wave = 0; wave < ( Number( state.waveIndex ) || 0 ); wave += 1 ) {
			for ( const definition of base.WAVE_DEFINITIONS[ wave ] || [] ) {
				ids.add( definition.id );
			}
		}
		for ( const popup of state.popups || [] ) {
			ids.add( popup.id );
		}
		return POPUP_ORDER.filter( ( id ) => ids.has( id ) );
	}

	function deriveObjectiveState( state = {} ) {
		const closed = new Set( inferredClosedPopupIds( state ) );
		const spawned = new Set( inferredSpawnedPopupIds( state ) );
		const activePopups = new Map(
			( state.popups || [] ).map( ( popup ) => [ popup.id, popup ] )
		);
		let previousComplete = true;
		const objectiveStates = OBJECTIVES.map( ( definition ) => {
			const complete =
				definition.id === 'archive-sweep'
					? state.phase === 'results' && state.result === 'rescued'
					: definition.targetIds.every( ( id ) => closed.has( id ) );
			const activeTargets = definition.targetIds.filter(
				( id ) => spawned.has( id ) && ! closed.has( id ) && activePopups.has( id )
			);
			let status = 'locked';
			if ( complete ) {
				status = 'complete';
			} else if ( state.phase === 'results' ) {
				status = 'missed';
			} else if (
				definition.id === 'archive-sweep' &&
				state.finale?.phase === 'archive-sweep'
			) {
				status = 'active';
			} else if ( activeTargets.length > 0 ) {
				status = 'active';
			} else if ( previousComplete ) {
				status = 'incoming';
			}
			const snapshot = Object.freeze( {
				id: definition.id,
				number: definition.number,
				label: definition.label,
				status,
				complete,
				closed: definition.targetIds.filter( ( id ) => closed.has( id ) ).length,
				total: definition.targetIds.length || 1,
				activeTargetIds: Object.freeze( activeTargets ),
			} );
			previousComplete = previousComplete && complete;
			return snapshot;
		} );
		const current =
			objectiveStates.find( ( objective ) => ! objective.complete ) ||
			objectiveStates[ objectiveStates.length - 1 ];
		const activeThreatId =
			current.activeTargetIds[ 0 ] ||
			objectiveStates.flatMap( ( objective ) => objective.activeTargetIds )[ 0 ] ||
			null;
		return Object.freeze( {
			currentId: current.id,
			currentNumber: current.number,
			currentLabel: current.label,
			currentStatus: current.status,
			activeThreatId,
			states: Object.freeze( objectiveStates ),
		} );
	}

	function levelForState( state = {} ) {
		const objective = deriveObjectiveState( state );
		return OBJECTIVES[ objective.currentNumber - 1 ];
	}

	function progressPercent( state ) {
		return Math.round(
			( ( Number( state.bricksDestroyed ) || 0 ) /
				Math.max( 1, state.bricks?.length || 0 ) ) *
				100
		);
	}

	function deriveRestoration( state ) {
		const percent = progressPercent( state );
		const closed = new Set( inferredClosedPopupIds( state ) );
		const revealIds = [];
		if ( percent >= 15 || closed.has( 'download' ) ) {
			revealIds.push( 'telescope-photo' );
		}
		if ( percent >= 35 || closed.has( 'toolbar' ) ) {
			revealIds.push( 'meteor-journal' );
		}
		if ( percent >= 55 || closed.has( 'casino' ) ) {
			revealIds.push( 'comet-counter' );
		}
		if ( percent >= 75 || closed.has( 'malware-boss' ) ) {
			revealIds.push( 'guestbook-webring' );
		}
		if (
			state.finale?.phase === 'archive-sweep' ||
			state.result === 'rescued'
		) {
			revealIds.push( 'launchpad-archive' );
		}
		const stateName =
			state.result === 'rescued'
				? 'restored'
				: revealIds.length >= 4
					? 'glowing'
					: revealIds.length >= 2
						? 'recovering'
						: revealIds.length
							? 'flickering'
							: 'dark';
		return Object.freeze( {
			state: stateName,
			percent,
			revealIds: Object.freeze( revealIds ),
		} );
	}

	function createScoreBreakdown() {
		return {
			brickPoints: 0,
			popupPoints: 0,
			purgePoints: 0,
			clearBonus: 0,
		};
	}

	function totalScore( breakdown ) {
		return Object.values( breakdown ).reduce(
			( total, points ) => total + Math.max( 0, Number( points ) || 0 ),
			0
		);
	}

	function applyScore( state, key, amount ) {
		state.scoreBreakdown[ key ] =
			( Number( state.scoreBreakdown[ key ] ) || 0 ) +
			Math.max( 0, Number( amount ) || 0 );
		state.score = totalScore( state.scoreBreakdown );
	}

	function createGame() {
		const state = base.createGame();
		state.scoreBreakdown = createScoreBreakdown();
		state.closedPopupIds = [];
		state.spawnedPopupIds = [];
		state.popupCloses = 0;
		state.finale = {
			phase: 'inactive',
			elapsed: 0,
			duration: ARCHIVE_SWEEP_SECONDS,
			remaining: ARCHIVE_SWEEP_SECONDS,
			nextPurgeAt: ARCHIVE_PURGE_INTERVAL,
		};
		state.popupCloseBeat = null;
		state.terminalSnapshot = null;
		state.controlStats = {
			intentFrames: 0,
			paddleReturns: 0,
			aimedReturns: 0,
			idleReturns: 0,
		};
		state.objective = deriveObjectiveState( state );
		state.restoration = deriveRestoration( state );
		for ( const ball of state.balls ) {
			ball.lastReturnMode = 'serve';
		}
		return state;
	}

	function copyGame( state ) {
		return {
			...state,
			paddle: { ...state.paddle },
			bricks: state.bricks.map( ( brick ) => ( { ...brick } ) ),
			balls: state.balls.map( ( ball ) => ( { ...ball } ) ),
			popups: state.popups.map( ( popup ) => ( { ...popup } ) ),
			lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
			scoreBreakdown: {
				...createScoreBreakdown(),
				...( state.scoreBreakdown || {} ),
			},
			closedPopupIds: [ ...inferredClosedPopupIds( state ) ],
			spawnedPopupIds: [ ...inferredSpawnedPopupIds( state ) ],
			finale: {
				phase: 'inactive',
				elapsed: 0,
				duration: ARCHIVE_SWEEP_SECONDS,
				remaining: ARCHIVE_SWEEP_SECONDS,
				nextPurgeAt: ARCHIVE_PURGE_INTERVAL,
				...( state.finale || {} ),
			},
			popupCloseBeat: state.popupCloseBeat
				? { ...state.popupCloseBeat }
				: null,
			controlStats: {
				intentFrames: 0,
				paddleReturns: 0,
				aimedReturns: 0,
				idleReturns: 0,
				...( state.controlStats || {} ),
			},
			objective: state.objective || deriveObjectiveState( state ),
			restoration: state.restoration || deriveRestoration( state ),
			terminalSnapshot: state.terminalSnapshot || null,
		};
	}

	function emitEvent( state, type, x, y, message ) {
		state.eventId += 1;
		state.lastEvent = {
			id: state.eventId,
			type,
			x,
			y,
		};
		if ( message ) {
			state.message = message;
		}
	}

	function refreshDerivedState( state ) {
		state.popupCloses = state.closedPopupIds.length;
		state.objective = deriveObjectiveState( state );
		state.restoration = deriveRestoration( state );
	}

	function startGame( state ) {
		if ( state.phase !== 'menu' ) {
			return state;
		}
		const next = copyGame( state );
		next.phase = 'playing';
		if ( next.balls[ 0 ] ) {
			next.balls[ 0 ].stuck = false;
		}
		emitEvent(
			next,
			'launch',
			next.balls[ 0 ]?.x || base.WIDTH / 2,
			next.balls[ 0 ]?.y || base.PADDLE_Y,
			'Connection live. Steer the return into the first red X.'
		);
		return next;
	}

	function pauseGame( state, reason = 'Game paused.' ) {
		if ( state.phase !== 'playing' ) {
			return state;
		}
		const next = copyGame( state );
		next.resumePhase = 'playing';
		next.phase = 'paused';
		emitEvent( next, 'pause', base.WIDTH / 2, base.HEIGHT / 2, reason );
		return next;
	}

	function resumeGame( state ) {
		if ( state.phase !== 'paused' ) {
			return state;
		}
		const next = copyGame( state );
		next.phase = 'playing';
		next.resumePhase = null;
		emitEvent(
			next,
			'resume',
			base.WIDTH / 2,
			base.HEIGHT / 2,
			'Connection restored.'
		);
		return next;
	}

	function restartGame() {
		return createGame();
	}

	function normalizeBallSpeed( ball, requestedSpeed = ball.speed ) {
		const current = Math.hypot( ball.vx, ball.vy ) || base.START_SPEED;
		const speed = clamp(
			requestedSpeed,
			base.START_SPEED,
			base.MAX_SPEED
		);
		ball.vx = ( ball.vx / current ) * speed;
		ball.vy = ( ball.vy / current ) * speed;
		const minimumVertical = speed * 0.34;
		if ( Math.abs( ball.vy ) < minimumVertical ) {
			const verticalSign = ball.vy < 0 ? -1 : 1;
			const horizontalSign = ball.vx < 0 ? -1 : 1;
			ball.vy = minimumVertical * verticalSign;
			ball.vx =
				Math.sqrt( Math.max( 0, speed * speed - ball.vy * ball.vy ) ) *
				horizontalSign;
		}
		ball.speed = speed;
	}

	function spawnWave( state, waveIndex ) {
		const definitions = base.WAVE_DEFINITIONS[ waveIndex ] || [];
		for ( const definition of definitions ) {
			if (
				state.closedPopupIds.includes( definition.id ) ||
				state.popups.some( ( popup ) => popup.id === definition.id )
			) {
				continue;
			}
			state.popups.push( {
				...definition,
				wave: waveIndex + 1,
				age: 0,
				solid: false,
				baseX: definition.x,
			} );
			state.spawnedPopupIds = sortedPopupIds( [
				...state.spawnedPopupIds,
				definition.id,
			] );
		}
		state.waveIndex = Math.max( state.waveIndex, waveIndex + 1 );
		refreshDerivedState( state );
		const activeThreat = state.objective.activeThreatId;
		emitEvent(
			state,
			'wave',
			base.WIDTH / 2,
			270,
			activeThreat === 'malware-boss'
				? 'Malware boss online. Track the moving red X.'
				: 'New popup online. Steer a return into the red X.'
		);
	}

	function updatePopups( state, dt ) {
		while (
			state.waveIndex < base.WAVE_SCHEDULE.length &&
			state.activeTime >= base.WAVE_SCHEDULE[ state.waveIndex ] &&
			state.finale.phase !== 'archive-sweep'
		) {
			spawnWave( state, state.waveIndex );
		}
		for ( const popup of state.popups ) {
			popup.age += dt;
			if ( popup.moving ) {
				popup.x = clamp(
					popup.baseX + Math.sin( popup.age * 1.8 ) * 112,
					18,
					base.WIDTH - popup.w - 18
				);
			}
			if ( popup.age >= 0.42 ) {
				popup.solid = true;
			}
		}
		refreshDerivedState( state );
	}

	function inputAxis( input ) {
		if ( Number.isFinite( input.keyboardAxis ) ) {
			return clamp( input.keyboardAxis, -1, 1 );
		}
		return ( input.right ? 1 : 0 ) - ( input.left ? 1 : 0 );
	}

	function movePaddle( state, input, dt ) {
		const pointerActive =
			input.pointerActive && Number.isFinite( input.targetX );
		if ( pointerActive ) {
			const desiredX = clamp(
				input.targetX - state.paddle.w / 2,
				0,
				base.WIDTH - state.paddle.w
			);
			const maximumMove = POINTER_MAX_SPEED * dt;
			const delta = clamp(
				desiredX - state.paddle.x,
				-maximumMove,
				maximumMove
			);
			state.paddle.vx = dt > 0 ? delta / dt : 0;
			state.paddle.x = clamp(
				state.paddle.x + delta,
				0,
				base.WIDTH - state.paddle.w
			);
			if ( Math.abs( delta ) > 0.25 ) {
				state.controlStats.intentFrames += 1;
			}
			return;
		}
		const direction = inputAxis( input );
		if ( direction !== 0 ) {
			state.paddle.vx +=
				direction * base.KEYBOARD_ACCELERATION * dt;
			state.controlStats.intentFrames += 1;
		} else {
			const friction = base.KEYBOARD_FRICTION * dt;
			state.paddle.vx =
				Math.abs( state.paddle.vx ) <= friction
					? 0
					: state.paddle.vx -
						Math.sign( state.paddle.vx ) * friction;
		}
		state.paddle.vx = clamp(
			state.paddle.vx,
			-base.KEYBOARD_MAX_SPEED,
			base.KEYBOARD_MAX_SPEED
		);
		state.paddle.x = clamp(
			state.paddle.x + state.paddle.vx * dt,
			0,
			base.WIDTH - state.paddle.w
		);
		if (
			state.paddle.x <= 0 ||
			state.paddle.x >= base.WIDTH - state.paddle.w
		) {
			state.paddle.vx = 0;
		}
	}

	function destroyNearbyBricks( state, x, y, count = 3 ) {
		const targets = state.bricks
			.filter( ( brick ) => ! brick.destroyed )
			.sort( ( first, second ) => {
				const firstDistance =
					( first.x + first.w / 2 - x ) ** 2 +
					( first.y + first.h / 2 - y ) ** 2;
				const secondDistance =
					( second.x + second.w / 2 - x ) ** 2 +
					( second.y + second.h / 2 - y ) ** 2;
				return firstDistance - secondDistance;
			} )
			.slice( 0, count );
		for ( const brick of targets ) {
			brick.hp = 0;
			brick.destroyed = true;
			state.bricksDestroyed += 1;
			applyScore( state, 'purgePoints', 150 );
		}
		refreshDerivedState( state );
		return targets.length;
	}

	function spawnMultiball( state, sourceBall ) {
		const speed = clamp(
			sourceBall.speed + 14,
			base.START_SPEED,
			base.MAX_SPEED
		);
		const extra = {
			...sourceBall,
			id: state.nextBallId,
			vx: -sourceBall.vx,
			vy: -Math.abs( sourceBall.vy ),
			speed,
			stuck: false,
			primary: false,
		};
		state.nextBallId += 1;
		normalizeBallSpeed( extra, speed );
		state.balls.push( extra );
		state.multiballTimer = base.MULTIBALL_SECONDS;
	}

	function beginArchiveSweep( state ) {
		if ( state.finale.phase === 'archive-sweep' ) {
			return;
		}
		state.finale = {
			phase: 'archive-sweep',
			elapsed: 0,
			duration: ARCHIVE_SWEEP_SECONDS,
			remaining: ARCHIVE_SWEEP_SECONDS,
			nextPurgeAt: ARCHIVE_PURGE_INTERVAL,
		};
		state.timeLeft = ARCHIVE_SWEEP_SECONDS;
		state.message =
			'All four X targets closed. Archive Sweep is burning off the last corruption.';
		refreshDerivedState( state );
	}

	function closePopup( state, popupIndex, ball ) {
		const popup = state.popups[ popupIndex ];
		if ( ! popup || state.closedPopupIds.includes( popup.id ) ) {
			return false;
		}
		const centerX = popup.x + popup.w / 2;
		const centerY = popup.y + popup.h / 2;
		state.popups.splice( popupIndex, 1 );
		state.closedPopupIds = sortedPopupIds( [
			...state.closedPopupIds,
			popup.id,
		] );
		applyScore(
			state,
			'popupPoints',
			popup.kind === 'boss' ? 1100 : 750
		);
		const burst = destroyNearbyBricks(
			state,
			centerX,
			centerY,
			popup.kind === 'boss' ? 4 : 3
		);
		if ( state.balls.length < 3 && ball ) {
			spawnMultiball( state, ball );
		}
		state.hitStop = popup.kind === 'boss' ? 0.06 : 0.04;
		emitEvent(
			state,
			'popup-close',
			centerX,
			centerY,
			`X CLOSED — ${ POPUP_LABELS[ popup.id ] || popup.id }. ${ burst } corruption blocks purged.`
		);
		state.popupCloseBeat = {
			id: state.eventId,
			popupId: popup.id,
			label: POPUP_LABELS[ popup.id ] || popup.id,
			startedAt: state.activeTime,
			expiresAt: state.activeTime + CLOSE_BEAT_SECONDS,
		};
		if ( state.closedPopupIds.length === POPUP_TOTAL ) {
			beginArchiveSweep( state );
		}
		refreshDerivedState( state );
		return true;
	}

	function activeAimTarget( state ) {
		const objective = deriveObjectiveState( state );
		const selected =
			state.popups.find(
				( popup ) => popup.id === objective.activeThreatId
			) ||
			state.popups.find( ( popup ) => popup.solid ) ||
			null;
		if ( ! selected ) {
			return null;
		}
		const rect = base.popupCloseRect( selected );
		return {
			x: rect.x + rect.w / 2,
			y: rect.y + rect.h / 2,
		};
	}

	function handlePopupCollisions( state, ball ) {
		for ( let index = state.popups.length - 1; index >= 0; index -= 1 ) {
			const popup = state.popups[ index ];
			if ( ! popup.solid ) {
				continue;
			}
			const closeRect = base.popupCloseRect( popup );
			if ( base.circleRectCollision( ball, closeRect ) ) {
				base.reflectBallFromRect( ball, closeRect );
				closePopup( state, index, ball );
				return true;
			}
		}
		return false;
	}

	function handleBrickCollision( state, ball ) {
		for ( const brick of state.bricks ) {
			if (
				brick.destroyed ||
				! base.circleRectCollision( ball, brick )
			) {
				continue;
			}
			base.reflectBallFromRect( ball, brick );
			brick.hp -= 1;
			applyScore( state, 'brickPoints', brick.points );
			if ( brick.hp <= 0 ) {
				brick.destroyed = true;
				state.bricksDestroyed += 1;
			}
			normalizeBallSpeed( ball, ball.speed + 3.5 );
			refreshDerivedState( state );
			emitEvent(
				state,
				'brick',
				brick.x + brick.w / 2,
				brick.y + brick.h / 2,
				brick.destroyed
					? 'A piece of Mira’s page came back online.'
					: 'Encrypted block cracked. One more hit.'
			);
			return true;
		}
		return false;
	}

	function handlePaddleCollision( state, ball, input ) {
		if (
			ball.vy <= 0 ||
			! base.circleRectCollision( ball, state.paddle )
		) {
			return false;
		}
		ball.y = state.paddle.y - ball.r - 0.1;
		const speed = clamp(
			ball.speed + 1.4,
			base.START_SPEED,
			base.MAX_SPEED
		);
		const pointerIntent =
			input.pointerActive &&
			Number.isFinite( input.targetX ) &&
			Math.abs( state.paddle.vx ) >= INTENT_MIN_SPEED;
		const keyboardIntent = Math.abs( inputAxis( input ) ) > 0;
		const deliberate = pointerIntent || keyboardIntent;
		const target = activeAimTarget( state );
		state.controlStats.paddleReturns += 1;
		if ( deliberate && target ) {
			const dx = target.x - ball.x;
			const dy = target.y - ball.y;
			const distance = Math.max( 1, Math.hypot( dx, dy ) );
			ball.vx = ( dx / distance ) * speed;
			ball.vy = -Math.abs( ( dy / distance ) * speed );
			ball.lastReturnMode = 'aimed';
			state.controlStats.aimedReturns += 1;
			emitEvent(
				state,
				'paddle-aim',
				ball.x,
				state.paddle.y,
				'Steered return locked on the active red X.'
			);
		} else {
			const relative = clamp(
				( ball.x - ( state.paddle.x + state.paddle.w / 2 ) ) /
					( state.paddle.w / 2 ),
				-1,
				1
			);
			const awayFromTarget =
				target && target.x >= ball.x ? -1 : target ? 1 : relative < 0 ? -1 : 1;
			const horizontal =
				speed * clamp( 0.43 + Math.abs( relative ) * 0.2, 0.43, 0.63 );
			ball.vx = horizontal * awayFromTarget;
			ball.vy = -Math.sqrt(
				Math.max( 0, speed * speed - ball.vx * ball.vx )
			);
			ball.lastReturnMode = 'idle';
			state.controlStats.idleReturns += 1;
			emitEvent(
				state,
				'paddle',
				ball.x,
				state.paddle.y,
				'Clean return. Steer on contact to aim at the X.'
			);
		}
		normalizeBallSpeed( ball, speed );
		return true;
	}

	function moveBall( state, ball, input, dt ) {
		ball.x += ball.vx * dt;
		ball.y += ball.vy * dt;
		if ( ball.x - ball.r < 0 ) {
			ball.x = ball.r;
			ball.vx = Math.abs( ball.vx );
		} else if ( ball.x + ball.r > base.WIDTH ) {
			ball.x = base.WIDTH - ball.r;
			ball.vx = -Math.abs( ball.vx );
		}
		if ( ball.y - ball.r < 0 ) {
			ball.y = ball.r;
			ball.vy = Math.abs( ball.vy );
		}
		if ( handlePopupCollisions( state, ball ) ) {
			return;
		}
		if ( handleBrickCollision( state, ball ) ) {
			return;
		}
		handlePaddleCollision( state, ball, input );
	}

	function resetPrimaryBall( state ) {
		const direction = state.lives % 2 === 0 ? -1 : 1;
		state.balls = [ base.createBall( state.nextBallId, direction ) ];
		state.nextBallId += 1;
		state.balls[ 0 ].primary = true;
		state.balls[ 0 ].stuck = true;
		state.balls[ 0 ].lastReturnMode = 'serve';
		state.serveDelay = 1.15;
		state.paddle.x = ( base.WIDTH - state.paddle.w ) / 2;
		state.paddle.vx = 0;
	}

	function firstUnfinishedObjectiveId( state ) {
		return (
			deriveObjectiveState( state ).states.find(
				( objective ) => ! objective.complete
			)?.id || null
		);
	}

	function terminalSnapshotForState( state ) {
		const objective = deriveObjectiveState( state );
		const breakdown = Object.freeze( {
			brickPoints: Math.round( state.scoreBreakdown.brickPoints ),
			popupPoints: Math.round( state.scoreBreakdown.popupPoints ),
			purgePoints: Math.round( state.scoreBreakdown.purgePoints ),
			clearBonus: Math.round( state.scoreBreakdown.clearBonus ),
		} );
		return deepFreeze( {
			schemaVersion: 1,
			rulesVersion: RULES_VERSION,
			result: state.result,
			endReason: state.endReason,
			score: Math.round( totalScore( breakdown ) ),
			secondsPlayed: Math.round( state.activeTime ),
			secondsRemaining: Math.max( 0, Math.ceil( state.timeLeft ) ),
			livesRemaining: Math.max( 0, state.lives ),
			bricksDestroyed: state.bricksDestroyed,
			bricksTotal: state.bricks.length,
			restored: progressPercent( state ),
			closedPopupIds: Object.freeze( [ ...state.closedPopupIds ] ),
			popupsClosed: state.closedPopupIds.length,
			popupsTotal: POPUP_TOTAL,
			objectiveStates: Object.freeze(
				objective.states.map( ( item ) =>
					Object.freeze( {
						id: item.id,
						status: item.status,
						closed: item.closed,
						total: item.total,
					} )
				)
			),
			firstUnfinishedObjectiveId: firstUnfinishedObjectiveId( state ),
			scoreBreakdown: breakdown,
		} );
	}

	function finishGame( state, result, endReason ) {
		if ( state.terminalSnapshot ) {
			return false;
		}
		state.phase = 'results';
		state.result = result;
		state.endReason = endReason;
		refreshDerivedState( state );
		state.terminalSnapshot = terminalSnapshotForState( state );
		state.balls = [];
		state.popups = [];
		state.hitStop = 0;
		emitEvent(
			state,
			result,
			base.WIDTH / 2,
			base.HEIGHT / 2,
			result === 'rescued'
				? 'Mira’s sky log is restored and mirrored.'
				: state.closedPopupIds.length === 3
					? 'Three targets closed. One popup escaped the archive.'
					: 'The archive saved a partial copy of Mira’s page.'
		);
		return true;
	}

	function finishArchiveSweep( state ) {
		if ( state.result || state.terminalSnapshot ) {
			return false;
		}
		const clearBonus =
			Math.ceil( Math.max( 0, state.finale.remaining ) ) * 20 +
			Math.max( 0, state.lives ) * 500;
		applyScore( state, 'clearBonus', clearBonus );
		state.finale.phase = 'complete';
		state.finale.remaining = 0;
		refreshDerivedState( state );
		return finishGame( state, 'rescued', 'archive-sweep' );
	}

	function updateArchiveSweep( state, dt ) {
		state.finale.elapsed = Math.min(
			state.finale.duration,
			state.finale.elapsed + dt
		);
		state.finale.remaining = Math.max(
			0,
			state.finale.duration - state.finale.elapsed
		);
		state.timeLeft = state.finale.remaining;
		while (
			state.finale.elapsed >= state.finale.nextPurgeAt &&
			state.bricksDestroyed < state.bricks.length
		) {
			const source = state.balls[ 0 ] || {
				x: base.WIDTH / 2,
				y: base.HEIGHT / 2,
			};
			const purged = destroyNearbyBricks( state, source.x, source.y, 2 );
			state.finale.nextPurgeAt += ARCHIVE_PURGE_INTERVAL;
			if ( purged > 0 ) {
				emitEvent(
					state,
					'archive-sweep',
					source.x,
					source.y,
					`Archive Sweep restored ${ purged } page fragments.`
				);
			}
		}
		const minimumMet =
			state.finale.elapsed >= ARCHIVE_SWEEP_MIN_SECONDS;
		if (
			minimumMet &&
			( state.bricksDestroyed === state.bricks.length ||
				state.finale.remaining <= 0 )
		) {
			finishArchiveSweep( state );
			return true;
		}
		return false;
	}

	function evaluateFinish( state ) {
		if ( state.terminalSnapshot ) {
			return true;
		}
		if ( state.finale.phase === 'archive-sweep' ) {
			return false;
		}
		if ( state.timeLeft <= 0 ) {
			finishGame( state, 'overrun', 'time' );
			return true;
		}
		return false;
	}

	function stepGame( state, input = {}, dt = base.FIXED_STEP ) {
		const safeDt = clamp( Number( dt ) || 0, 0, 0.05 );
		if (
			safeDt <= 0 ||
			state.phase !== 'playing' ||
			state.terminalSnapshot
		) {
			return state;
		}
		const next = copyGame( state );
		if (
			next.popupCloseBeat &&
			next.activeTime >= next.popupCloseBeat.expiresAt
		) {
			next.popupCloseBeat = null;
		}
		if ( next.hitStop > 0 ) {
			next.hitStop = Math.max( 0, next.hitStop - safeDt );
			return next;
		}

		next.activeTime += safeDt;
		if ( next.finale.phase === 'archive-sweep' ) {
			movePaddle( next, input, safeDt );
			if ( updateArchiveSweep( next, safeDt ) ) {
				return next;
			}
		} else {
			next.timeLeft = Math.max(
				0,
				base.ROUND_SECONDS - next.activeTime
			);
			movePaddle( next, input, safeDt );
			updatePopups( next, safeDt );
		}

		if ( next.serveDelay > 0 ) {
			next.serveDelay = Math.max( 0, next.serveDelay - safeDt );
			const servedBall = next.balls[ 0 ];
			if ( servedBall ) {
				servedBall.x = next.paddle.x + next.paddle.w / 2;
				servedBall.y = next.paddle.y - servedBall.r - 4;
				if ( next.serveDelay === 0 ) {
					servedBall.stuck = false;
					emitEvent(
						next,
						'serve',
						servedBall.x,
						servedBall.y,
						'Ball relaunched.'
					);
				}
			}
			evaluateFinish( next );
			return next;
		}

		for ( const ball of [ ...next.balls ] ) {
			moveBall( next, ball, input, safeDt );
		}
		next.balls = next.balls.filter(
			( ball ) => ball.y - ball.r <= base.HEIGHT + 4
		);

		if ( next.multiballTimer > 0 ) {
			next.multiballTimer = Math.max(
				0,
				next.multiballTimer - safeDt
			);
			if ( next.multiballTimer === 0 && next.balls.length > 1 ) {
				const survivor =
					next.balls.find( ( ball ) => ball.primary ) ||
					next.balls[ 0 ];
				next.balls = [ { ...survivor, primary: true } ];
				emitEvent(
					next,
					'multiball-end',
					survivor.x,
					survivor.y,
					'Multiball cache expired.'
				);
			}
		}

		if ( next.balls.length === 0 ) {
			if ( next.finale.phase === 'archive-sweep' ) {
				next.lives = Math.max( 1, next.lives );
				resetPrimaryBall( next );
			} else {
				next.lives -= 1;
				if ( next.lives <= 0 ) {
					finishGame( next, 'overrun', 'lives' );
					return next;
				}
				resetPrimaryBall( next );
				emitEvent(
					next,
					'miss',
					base.WIDTH / 2,
					base.HEIGHT - 30,
					`Connection dropped. ${ next.lives } ${
						next.lives === 1 ? 'life' : 'lives'
					} left.`
				);
			}
		}

		evaluateFinish( next );
		refreshDerivedState( next );
		return next;
	}

	function replayTip( state = {} ) {
		const snapshot = state.terminalSnapshot;
		if ( snapshot?.result === 'rescued' ) {
			return 'Run it back: steer more returns into the X targets and protect every life.';
		}
		const missing = snapshot?.firstUnfinishedObjectiveId ||
			firstUnfinishedObjectiveId( state );
		if ( missing === 'download-trap' ) {
			return 'Move as the ball meets the paddle. A steered return locks onto the first X.';
		}
		if ( missing === 'toolbar-swarm' ) {
			return 'Use each cache burst to cover both sides of the toolbar swarm.';
		}
		if ( missing === 'malware-boss' ) {
			return 'You closed 3 of 4. Track the boss only after its moving X comes online.';
		}
		return 'All X targets were closed. Keep one ball alive through the Archive Sweep.';
	}

	function resultSummary( state ) {
		const terminal =
			state.terminalSnapshot ||
			( state.phase === 'results'
				? terminalSnapshotForState( state )
				: null );
		const breakdown = terminal
			? terminal.scoreBreakdown
			: Object.freeze( { ...state.scoreBreakdown } );
		return Object.freeze( {
			result: terminal?.result || state.result,
			endReason: terminal?.endReason || state.endReason,
			score: terminal?.score ?? Math.round( state.score ),
			restored: terminal?.restored ?? progressPercent( state ),
			popupsClosed:
				terminal?.popupsClosed ?? inferredClosedPopupIds( state ).length,
			bricksDestroyed:
				terminal?.bricksDestroyed ?? state.bricksDestroyed,
			secondsPlayed:
				terminal?.secondsPlayed ?? Math.round( state.activeTime ),
			firstUnfinishedObjectiveId:
				terminal?.firstUnfinishedObjectiveId ||
				firstUnfinishedObjectiveId( state ),
			scoreBreakdown: breakdown,
			terminalSnapshot: terminal,
		} );
	}

	function createExperienceRenderer( factory, host, options = {} ) {
		const win = options.window || global;
		const reducedMotion =
			options.reducedMotion === true ||
			( options.reducedMotion !== false &&
				typeof win?.matchMedia === 'function' &&
				win.matchMedia( '(prefers-reduced-motion: reduce)' ).matches );
		return Promise.resolve( factory( host, options ) ).then( ( renderer ) => {
			let reducedFrame = 0;
			return Object.freeze( {
				canvas: renderer.canvas,
				mapPointer: renderer.mapPointer,
				render( state, previousState, alpha, frameDelta ) {
					if ( ! reducedMotion ) {
						renderer.render(
							state,
							previousState,
							alpha,
							frameDelta
						);
						return;
					}
					reducedFrame += 1;
					const quiet = {
						...state,
						lastEvent: null,
						balls: state.balls.map( ( ball ) => ( {
							...ball,
							id: `${ ball.id }-reduced-${ reducedFrame }`,
						} ) ),
					};
					renderer.render( quiet, quiet, 1, 0 );
				},
				destroy() {
					renderer.destroy();
				},
			} );
		} );
	}

	function createObjectiveJourney( document ) {
		const journey = document.createElement( 'ol' );
		journey.className = 'siege-level-journey';
		journey.dataset.owner = 'experience-070';
		journey.setAttribute( 'aria-label', 'Run progress' );
		for ( const objective of OBJECTIVES ) {
			const item = document.createElement( 'li' );
			item.dataset.objectiveId = objective.id;
			item.innerHTML = `<span>L${ objective.number }</span><strong>${ objective.label }</strong><em data-role="level-result"></em>`;
			journey.append( item );
		}
		return journey;
	}

	function enhanceExperience( container ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return {
				root: null,
				sync() {},
				dispose() {},
			};
		}
		const document = container.ownerDocument;
		const win = document.defaultView || global;
		const rail = root.querySelector( '.siege-browser__rail' );
		const status = root.querySelector( '[data-role="status"]' );
		const overlay = root.querySelector( '.siege-overlay' );
		const stage = root.querySelector( '.siege-stage' );
		const resultsCard = root.querySelector( '.siege-card--results' );
		const resultMetrics = resultsCard?.querySelector( '.siege-results' );
		let toastTimer = null;
		let lastThreatId = null;
		let lastFinalePhase = 'inactive';

		root.classList.add( 'siege-game--experience-070' );
		root.dataset.buildVersion = ASSET_VERSION;
		root.dataset.prototype = 'popup-siege-v0-7-0';
		root.dataset.rulesVersion = String( RULES_VERSION );
		root.dataset.uiSystem = 'popup-siege-0.7.0';

		for ( const selector of [
			'[data-role="level-badge"]',
			'.siege-level-toast',
			'.siege-level-journey',
			'.siege-replay-pitch',
		] ) {
			root.querySelector( selector )?.remove();
		}

		const badge = document.createElement( 'span' );
		badge.className = 'siege-level-badge';
		badge.dataset.role = 'level-badge';
		badge.dataset.owner = 'experience-070';
		rail?.insertBefore( badge, status );

		const toast = document.createElement( 'div' );
		toast.className = 'siege-level-toast';
		toast.dataset.owner = 'experience-070';
		toast.setAttribute( 'aria-hidden', 'true' );
		toast.hidden = true;
		toast.innerHTML =
			'<small data-role="level-toast-number"></small><strong data-role="level-toast-label"></strong><span data-role="level-toast-objective"></span>';
		overlay?.append( toast );

		const closeBeat = document.createElement( 'div' );
		closeBeat.className = 'siege-popup-close-beat';
		closeBeat.setAttribute( 'aria-live', 'assertive' );
		closeBeat.hidden = true;
		overlay?.append( closeBeat );

		const restoredPage = document.createElement( 'aside' );
		restoredPage.className = 'siege-restored-page';
		restoredPage.setAttribute( 'aria-label', 'Restored pieces of Mira’s page' );
		restoredPage.innerHTML =
			'<strong>MIRA’S PAGE IS COMING BACK</strong><ul data-role="restored-reveal"></ul>';
		const revealList = restoredPage.querySelector(
			'[data-role="restored-reveal"]'
		);
		for ( const reveal of RESTORATION_REVEALS ) {
			const item = document.createElement( 'li' );
			item.dataset.revealId = reveal.id;
			item.hidden = true;
			const title = document.createElement( 'strong' );
			const copy = document.createElement( 'span' );
			title.textContent = reveal.title;
			copy.textContent = reveal.copy;
			item.append( title, copy );
			revealList.append( item );
		}
		stage?.insertBefore( restoredPage, overlay );

		const journey = createObjectiveJourney( document );
		resultMetrics?.before( journey );

		const receipt = document.createElement( 'section' );
		receipt.className = 'siege-archive-receipt';
		receipt.innerHTML = `
			<strong data-role="receipt-outcome"></strong>
			<span data-role="receipt-popups"></span>
			<span data-role="receipt-breakdown"></span>
			<p data-role="receipt-next"></p>
		`;
		resultMetrics?.after( receipt );

		function hideToast() {
			toast.hidden = true;
			toast.dataset.visible = 'false';
			toastTimer = null;
		}

		function showToast( number, label, objective ) {
			if ( toastTimer !== null ) {
				win.clearTimeout( toastTimer );
			}
			toast.querySelector( '[data-role="level-toast-number"]' ).textContent =
				`LEVEL ${ number } OF ${ OBJECTIVES.length }`;
			toast.querySelector( '[data-role="level-toast-label"]' ).textContent =
				label;
			toast.querySelector(
				'[data-role="level-toast-objective"]'
			).textContent = objective;
			toast.hidden = false;
			toast.dataset.visible = 'true';
			toastTimer = win.setTimeout( hideToast, 1750 );
		}

		function syncJourney( state ) {
			for ( const item of journey.children ) {
				const objective = state.objective.states.find(
					( candidate ) =>
						candidate.id === item.dataset.objectiveId
				);
				if ( ! objective ) {
					continue;
				}
				item.dataset.state = objective.status;
				const statusLabel = item.querySelector(
					'[data-role="level-result"]'
				);
				statusLabel.textContent =
					objective.status === 'complete'
						? '✓ CLEAR'
						: objective.status === 'active'
							? '• ACTIVE'
							: objective.status === 'incoming'
								? '… INCOMING'
								: objective.status === 'missed'
									? '× MISSED'
									: '— LOCKED';
				if (
					objective.id === state.objective.currentId &&
					state.phase !== 'results'
				) {
					item.setAttribute( 'aria-current', 'step' );
				} else {
					item.removeAttribute( 'aria-current' );
				}
			}
		}

		function syncResults( state ) {
			if ( state.phase !== 'results' || ! state.terminalSnapshot ) {
				return;
			}
			const snapshot = state.terminalSnapshot;
			const rescued = snapshot.result === 'rescued';
			root.querySelector( '[data-role="result-kicker"]' ).textContent =
				rescued ? 'ARCHIVE COMPLETE' : 'ARCHIVE PARTIAL';
			root.querySelector( '[data-role="result-title"]' ).textContent =
				rescued
					? "Mira's sky log is back."
					: snapshot.popupsClosed === 3
						? 'One popup escaped.'
						: 'A partial copy survived.';
			root.querySelector( '[data-role="result-score"]' ).textContent =
				String( snapshot.score );
			root.querySelector( '[data-role="result-restored"]' ).textContent =
				`${ snapshot.restored }%`;
			root.querySelector( '[data-role="result-popups"]' ).textContent =
				`${ snapshot.popupsClosed } / ${ snapshot.popupsTotal }`;
			const resultCopy = root.querySelector(
				'[data-role="result-copy"]'
			);
			if ( resultCopy ) {
				resultCopy.textContent = rescued
					? 'Every threat was closed and the final archive sweep completed.'
					: `${ snapshot.popupsClosed } of ${ snapshot.popupsTotal } threats were closed before ${ snapshot.endReason === 'lives' ? 'the connection dropped' : 'time expired' }.`;
			}
			receipt.querySelector( '[data-role="receipt-outcome"]' ).textContent =
				rescued
					? 'FULL MIRROR SAVED'
					: `${ snapshot.popupsClosed } / ${ snapshot.popupsTotal } THREATS CLOSED`;
			receipt.querySelector( '[data-role="receipt-popups"]' ).textContent =
				snapshot.closedPopupIds.length
					? snapshot.closedPopupIds
							.map( ( id ) => POPUP_LABELS[ id ] )
							.join( ' · ' )
					: 'No popup targets closed';
			receipt.querySelector(
				'[data-role="receipt-breakdown"]'
			).textContent =
				`BRICKS ${ snapshot.scoreBreakdown.brickPoints } · X TARGETS ${ snapshot.scoreBreakdown.popupPoints } · PURGE ${ snapshot.scoreBreakdown.purgePoints } · CLEAR ${ snapshot.scoreBreakdown.clearBonus }`;
			receipt.querySelector( '[data-role="receipt-next"]' ).textContent =
				replayTip( state );
		}

		function sync( state ) {
			root.dataset.restorationState = state.restoration.state;
			root.dataset.popupCloseBeat = state.popupCloseBeat
				? state.popupCloseBeat.popupId
				: 'idle';
			root.dataset.finalePhase = state.finale.phase;
			const currentDefinition =
				OBJECTIVES[ state.objective.currentNumber - 1 ];
			const threat = state.objective.activeThreatId;
			badge.textContent =
				state.objective.currentStatus === 'incoming'
					? `L${ currentDefinition.number }/${ OBJECTIVES.length } · THREAT INCOMING`
					: `L${ currentDefinition.number }/${ OBJECTIVES.length } · ${ currentDefinition.label }`;
			badge.setAttribute(
				'aria-label',
				`Level ${ currentDefinition.number } of ${ OBJECTIVES.length }: ${ currentDefinition.label }, ${ state.objective.currentStatus }${
					threat ? `, active threat ${ POPUP_LABELS[ threat ] }` : ''
				}`
			);
			for ( const item of revealList.children ) {
				item.hidden = ! state.restoration.revealIds.includes(
					item.dataset.revealId
				);
			}
			restoredPage.dataset.reveals = String(
				state.restoration.revealIds.length
			);
			if ( state.popupCloseBeat ) {
				closeBeat.hidden = false;
				closeBeat.textContent = `X CLOSED // ${ state.popupCloseBeat.label }`;
			} else {
				closeBeat.hidden = true;
				closeBeat.textContent = '';
			}
			syncJourney( state );
			syncResults( state );

			if ( threat && threat !== lastThreatId ) {
				showToast(
					currentDefinition.number,
					currentDefinition.label,
					currentDefinition.objective
				);
			} else if (
				state.finale.phase === 'archive-sweep' &&
				lastFinalePhase !== 'archive-sweep'
			) {
				showToast( 4, 'ARCHIVE SWEEP', OBJECTIVES[ 3 ].objective );
			}
			lastThreatId = threat;
			lastFinalePhase = state.finale.phase;
		}

		return {
			root,
			sync,
			dispose() {
				if ( toastTimer !== null ) {
					win.clearTimeout( toastTimer );
					toastTimer = null;
				}
				badge.remove();
				toast.remove();
				closeBeat.remove();
				restoredPage.remove();
				journey.remove();
				receipt.remove();
				root.classList.remove( 'siege-game--experience-070' );
			},
		};
	}

	function installResultsFocusGate( root ) {
		const title = root?.querySelector( '[data-role="result-title"]' );
		if ( ! title || typeof title.focus !== 'function' ) {
			return {
				arm() {},
				restore() {},
			};
		}
		const previousFocus = title.focus;
		let armed = false;
		title.focus = ( options = {} ) => {
			if ( ! armed ) {
				return;
			}
			armed = false;
			previousFocus.call( title, {
				...options,
				preventScroll: true,
			} );
		};
		return {
			arm() {
				armed = true;
			},
			restore() {
				title.focus = previousFocus;
			},
		};
	}

	function durableSignature( state ) {
		return [
			state.phase,
			state.eventId,
			state.lives,
			Math.round( state.score ),
			Math.ceil( state.timeLeft ),
			state.closedPopupIds.join( ',' ),
			state.spawnedPopupIds.join( ',' ),
			state.objective.currentId,
			state.objective.currentStatus,
			state.objective.activeThreatId || '',
			state.restoration.state,
			state.restoration.revealIds.join( ',' ),
			state.finale.phase,
			Math.ceil( state.finale.remaining ),
			state.popupCloseBeat?.id || 0,
			state.terminalSnapshot?.score || '',
		].join( '|' );
	}

	function transitionFor( previous, state, kind = 'update' ) {
		return Object.freeze( {
			kind,
			previousPhase: previous?.phase || null,
			phase: state.phase,
			previousEventId: previous?.eventId || 0,
			eventId: state.eventId,
			eventType: state.lastEvent?.type || null,
			objectiveId: state.objective.currentId,
			activeThreatId: state.objective.activeThreatId,
			finalePhase: state.finale.phase,
		} );
	}

	function mount( container, options = {} ) {
		if ( ! container || ! container.ownerDocument ) {
			throw new Error( 'Popup Siege requires a DOM container.' );
		}
		const document = container.ownerDocument;
		const win = document.defaultView || global;
		const rendererFactory =
			typeof options.rendererFactory === 'function'
				? options.rendererFactory
				: base.createPixiRenderer;
		const baseController = base.mount( container, {
			...options,
			autoStart: false,
			rendererFactory( host, rendererOptions ) {
				return createExperienceRenderer(
					rendererFactory,
					host,
					{
						...rendererOptions,
						reducedMotion: options.reducedMotion,
					}
				);
			},
		} );
		const experience = enhanceExperience( container );
		const focusGate = installResultsFocusGate( experience.root );
		const stage = experience.root?.querySelector( '.siege-stage' );
		const nativeControls = Array.from(
			experience.root?.querySelectorAll(
				'button, a[href], input, select, textarea, [role="button"]'
			) || []
		);
		let state = createGame();
		let lastSignature = durableSignature( state );
		let disposed = false;
		let animationFrame = null;
		let previousTime = null;
		let accumulator = 0;
		const listeners = new Set();
		const input = {
			left: false,
			right: false,
			pointerActive: false,
			targetX: base.WIDTH / 2,
		};

		function resetInput() {
			input.left = false;
			input.right = false;
			input.pointerActive = false;
		}

		function notify( previous, kind = 'update' ) {
			const transition = transitionFor( previous, state, kind );
			for ( const listener of [ ...listeners ] ) {
				listener( copyGame( state ), transition );
			}
		}

		function commit( next, kind = 'update' ) {
			if ( disposed || next === state ) {
				return state;
			}
			const previous = state;
			if (
				next.phase === 'results' &&
				previous.phase !== 'results'
			) {
				focusGate.arm();
			}
			state = next;
			baseController.setState( state );
			experience.sync( state );
			const signature = durableSignature( state );
			if ( signature !== lastSignature ) {
				lastSignature = signature;
				notify( previous, kind );
			}
			return state;
		}

		function update( dt ) {
			commit( stepGame( state, input, dt ) );
		}

		function frame( now ) {
			if ( disposed ) {
				return;
			}
			if ( previousTime === null ) {
				previousTime = now;
			}
			const elapsed = clamp( ( now - previousTime ) / 1000, 0, 0.1 );
			previousTime = now;
			accumulator += elapsed;
			while ( accumulator >= base.FIXED_STEP ) {
				update( base.FIXED_STEP );
				accumulator -= base.FIXED_STEP;
			}
			animationFrame = win.requestAnimationFrame( frame );
		}

		function startLoop() {
			if (
				animationFrame !== null ||
				typeof win.requestAnimationFrame !== 'function'
			) {
				return;
			}
			animationFrame = win.requestAnimationFrame( frame );
		}

		function requestStart() {
			commit( startGame( state ), 'start' );
			stage?.focus( { preventScroll: true } );
		}

		function requestPause( reason ) {
			commit( pauseGame( state, reason ), 'pause' );
		}

		function requestResume() {
			commit( resumeGame( state ), 'resume' );
			stage?.focus( { preventScroll: true } );
		}

		function requestRestart( immediate = false ) {
			resetInput();
			commit( restartGame(), 'restart' );
			if ( immediate ) {
				requestStart();
			}
		}

		function isInteractive( target ) {
			return Boolean(
				target?.closest?.(
					'button, a[href], input, select, textarea, [role="button"]'
				)
			);
		}

		function onClickCapture( event ) {
			const button = event.target.closest?.( '[data-action]' );
			if ( ! button || ! experience.root?.contains( button ) ) {
				return;
			}
			const action = button.dataset.action;
			if ( action === 'start' ) {
				requestStart();
			} else if ( action === 'pause' ) {
				event.preventDefault();
				event.stopPropagation();
				state.phase === 'paused' ? requestResume() : requestPause();
			} else if ( action === 'resume' ) {
				requestResume();
			} else if ( action === 'restart' ) {
				event.preventDefault();
				event.stopPropagation();
				requestRestart( true );
			}
		}

		function keyName( event ) {
			return String( event.key || '' ).toLowerCase();
		}

		function onKeyDownCapture( event ) {
			const key = keyName( event );
			if ( key === ' ' || key === 'enter' ) {
				if ( isInteractive( event.target ) ) {
					return;
				}
				if ( state.phase === 'menu' ) {
					requestStart();
					event.preventDefault();
				}
				return;
			}
			if ( key === 'arrowleft' || key === 'a' ) {
				input.left = true;
				input.pointerActive = false;
				event.preventDefault();
			} else if ( key === 'arrowright' || key === 'd' ) {
				input.right = true;
				input.pointerActive = false;
				event.preventDefault();
			} else if ( key === 'p' || key === 'escape' ) {
				if ( state.phase === 'paused' ) {
					requestResume();
				} else {
					requestPause();
				}
				event.preventDefault();
				event.stopPropagation();
			}
		}

		function onNativeControlKeyDown( event ) {
			const key = keyName( event );
			if ( key === ' ' || key === 'enter' ) {
				event.stopPropagation();
			}
		}

		function onKeyUpCapture( event ) {
			const key = keyName( event );
			if ( key === 'arrowleft' || key === 'a' ) {
				input.left = false;
			} else if ( key === 'arrowright' || key === 'd' ) {
				input.right = false;
			}
		}

		function updatePointer( event ) {
			if ( ! stage || typeof stage.getBoundingClientRect !== 'function' ) {
				return;
			}
			const rect = stage.getBoundingClientRect();
			if ( rect.width <= 0 ) {
				return;
			}
			input.targetX = clamp(
				( ( event.clientX - rect.left ) / rect.width ) * base.WIDTH,
				0,
				base.WIDTH
			);
			input.pointerActive = true;
			if ( event.type === 'pointerdown' && state.phase === 'menu' ) {
				requestStart();
			}
		}

		function onBlur() {
			resetInput();
			if ( state.phase === 'playing' ) {
				requestPause( 'Paused because the game lost focus.' );
			}
		}

		function onVisibilityChange() {
			if ( document.hidden ) {
				resetInput();
				if ( state.phase === 'playing' ) {
					requestPause( 'Paused while this tab is hidden.' );
				}
			}
		}

		container.addEventListener( 'click', onClickCapture, true );
		container.addEventListener( 'keydown', onKeyDownCapture, true );
		container.addEventListener( 'keyup', onKeyUpCapture, true );
		stage?.addEventListener( 'pointermove', updatePointer, true );
		stage?.addEventListener( 'pointerdown', updatePointer, true );
		for ( const control of nativeControls ) {
			control.addEventListener( 'keydown', onNativeControlKeyDown );
		}
		win.addEventListener( 'blur', onBlur );
		document.addEventListener( 'visibilitychange', onVisibilityChange );

		baseController.setState( state );
		experience.sync( state );

		const ready = Promise.resolve( baseController.ready ).then( () => {
			if ( disposed ) {
				return null;
			}
			baseController.setState( state );
			experience.sync( state );
			if ( options.autoStart !== false ) {
				startLoop();
			}
			return state;
		} );

		return Object.freeze( {
			ready,
			getState() {
				return copyGame( state );
			},
			setState( nextState ) {
				if ( disposed ) {
					return;
				}
				const next = copyGame( nextState );
				refreshDerivedState( next );
				commit( next, 'set-state' );
			},
			advance( seconds ) {
				const steps = Math.max(
					0,
					Math.ceil(
						Math.max( 0, Number( seconds ) || 0 ) /
							base.FIXED_STEP
					)
				);
				for ( let index = 0; index < steps; index += 1 ) {
					update( base.FIXED_STEP );
				}
				return copyGame( state );
			},
			start: requestStart,
			pause: requestPause,
			resume: requestResume,
			restart: requestRestart,
			subscribe( listener ) {
				if ( typeof listener !== 'function' || disposed ) {
					return () => {};
				}
				listeners.add( listener );
				listener(
					copyGame( state ),
					transitionFor( null, state, 'snapshot' )
				);
				let active = true;
				return () => {
					if ( ! active ) {
						return;
					}
					active = false;
					listeners.delete( listener );
				};
			},
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				if ( animationFrame !== null ) {
					win.cancelAnimationFrame( animationFrame );
					animationFrame = null;
				}
				listeners.clear();
				container.removeEventListener(
					'click',
					onClickCapture,
					true
				);
				container.removeEventListener(
					'keydown',
					onKeyDownCapture,
					true
				);
				container.removeEventListener(
					'keyup',
					onKeyUpCapture,
					true
				);
				stage?.removeEventListener(
					'pointermove',
					updatePointer,
					true
				);
				stage?.removeEventListener(
					'pointerdown',
					updatePointer,
					true
				);
				for ( const control of nativeControls ) {
					control.removeEventListener(
						'keydown',
						onNativeControlKeyDown
					);
				}
				win.removeEventListener( 'blur', onBlur );
				document.removeEventListener(
					'visibilitychange',
					onVisibilityChange
				);
				focusGate.restore();
				experience.dispose();
				baseController.teardown();
			},
		} );
	}

	return Object.freeze( {
		...base,
		ASSET_VERSION,
		RULES_VERSION,
		POPUP_TOTAL,
		POPUP_ORDER,
		OBJECTIVES,
		RESTORATION_REVEALS,
		ARCHIVE_SWEEP_SECONDS,
		ARCHIVE_SWEEP_MIN_SECONDS,
		POINTER_MAX_SPEED,
		createGame,
		copyGame,
		startGame,
		pauseGame,
		resumeGame,
		restartGame,
		spawnWave,
		closePopup,
		beginArchiveSweep,
		stepGame,
		progressPercent,
		deriveObjectiveState,
		deriveRestoration,
		levelForState,
		replayTip,
		resultSummary,
		terminalSnapshotForState,
		createExperienceRenderer,
		mount,
	} );
} );
