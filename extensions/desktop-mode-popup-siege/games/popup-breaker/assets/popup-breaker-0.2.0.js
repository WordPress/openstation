( function ( global, factory ) {
	'use strict';

	const kit =
		global && global.OpenStationGameKit
			? global.OpenStationGameKit
			: typeof module === 'object' && module.exports
				? require( '../../../sdk/openstation-game-kit-0.1.0.js' )
				: null;
	const api = factory( global, kit );

	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	}

	if ( global ) {
		global.PopupBreaker = api;
	}
} )( typeof globalThis !== 'undefined' ? globalThis : this, function ( global, kit ) {
	'use strict';

	const ASSET_VERSION = '0.2.0';
	const RULES_VERSION = 2;
	const WIDTH = 480;
	const HEIGHT = 560;
	const FIXED_STEP = 1 / 120;
	const ROUND_SECONDS = 90;
	const BALL_RADIUS = 7;
	const START_SPEED = 292;
	const MAX_SPEED = 424;
	const POINTER_SNAP = true;
	const KEYBOARD_ACCELERATION = 2500;
	const KEYBOARD_FRICTION = 3100;
	const KEYBOARD_MAX_SPEED = 510;
	const PADDLE_WIDTH = 124;
	const PADDLE_HEIGHT = 14;
	const PADDLE_Y = 522;
	const MULTIBALL_SECONDS = 8;
	const WAVE_SCHEDULE = Object.freeze( [ 3, 12, 24 ] );
	const WAVE_DEFINITIONS = Object.freeze( [
		Object.freeze( [
			Object.freeze( {
				id: 'download',
				x: 146,
				y: 278,
				w: 188,
				h: 94,
				kind: 'download',
				moving: false,
			} ),
		] ),
		Object.freeze( [
			Object.freeze( {
				id: 'toolbar',
				x: 40,
				y: 270,
				w: 138,
				h: 74,
				kind: 'toolbar',
				moving: false,
			} ),
			Object.freeze( {
				id: 'casino',
				x: 304,
				y: 332,
				w: 136,
				h: 72,
				kind: 'casino',
				moving: false,
			} ),
		] ),
		Object.freeze( [
			Object.freeze( {
				id: 'malware-boss',
				x: 144,
				y: 276,
				w: 192,
				h: 96,
				kind: 'boss',
				moving: true,
			} ),
		] ),
	] );

	const BRICK_ROWS = Object.freeze( [
		Object.freeze( { kind: 'header', hp: 2, points: 140, color: 0x7f5af0 } ),
		Object.freeze( { kind: 'meteor', hp: 1, points: 110, color: 0xffc857 } ),
		Object.freeze( { kind: 'journal', hp: 1, points: 100, color: 0x55d6be } ),
		Object.freeze( { kind: 'gallery', hp: 1, points: 90, color: 0xff6b9a } ),
		Object.freeze( { kind: 'webring', hp: 1, points: 80, color: 0x72a5ff } ),
	] );

	function clamp( value, minimum, maximum ) {
		return Math.max( minimum, Math.min( maximum, value ) );
	}

	function lerp( from, to, alpha ) {
		return from + ( to - from ) * clamp( alpha, 0, 1 );
	}

	function createBricks() {
		const bricks = [];
		BRICK_ROWS.forEach( ( row, rowIndex ) => {
			for ( let column = 0; column < 6; column += 1 ) {
				bricks.push( {
					id: `${ rowIndex }-${ column }`,
					x: 17 + column * 75,
					y: 82 + rowIndex * 31,
					w: 70,
					h: 25,
					row: rowIndex,
					column,
					kind: row.kind,
					color: row.color,
					hp: row.hp,
					maxHp: row.hp,
					points: row.points,
					destroyed: false,
				} );
			}
		} );
		return bricks;
	}

	function createBall( id = 1, direction = 1 ) {
		const speed = START_SPEED;
		const angle = 0.08 * direction;
		return {
			id,
			x: WIDTH / 2,
			y: PADDLE_Y - BALL_RADIUS - 4,
			vx: Math.sin( angle ) * speed,
			vy: -Math.cos( angle ) * speed,
			r: BALL_RADIUS,
			speed,
			stuck: true,
			primary: id === 1,
		};
	}

	function createGame() {
		return {
			phase: 'menu',
			resumePhase: null,
			result: null,
			endReason: null,
			score: 0,
			lives: 3,
			timeLeft: ROUND_SECONDS,
			activeTime: 0,
			bricksDestroyed: 0,
			popupCloses: 0,
			popupEscapes: 0,
			waveIndex: 0,
			popups: [],
			balls: [ createBall() ],
			nextBallId: 2,
			multiballTimer: 0,
			serveDelay: 0,
			hitStop: 0,
			paddle: {
				x: ( WIDTH - PADDLE_WIDTH ) / 2,
				y: PADDLE_Y,
				w: PADDLE_WIDTH,
				h: PADDLE_HEIGHT,
				vx: 0,
			},
			bricks: createBricks(),
			eventId: 0,
			lastEvent: null,
			message:
				'Move the paddle. Close every popup. Restore Mira’s sky log.',
		};
	}

	function copyGame( state ) {
		return {
			...state,
			paddle: { ...state.paddle },
			bricks: state.bricks.map( ( brick ) => ( { ...brick } ) ),
			balls: state.balls.map( ( ball ) => ( { ...ball } ) ),
			popups: state.popups.map( ( popup ) => ( { ...popup } ) ),
			lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
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

	function startGame( state ) {
		if ( state.phase !== 'menu' ) {
			return state;
		}
		const next = copyGame( state );
		next.phase = 'playing';
		next.balls[ 0 ].stuck = false;
		emitEvent(
			next,
			'launch',
			next.balls[ 0 ].x,
			next.balls[ 0 ].y,
			'Connection live. First popup incoming.'
		);
		return next;
	}

	function pauseGame( state, reason = 'Game paused.' ) {
		if ( state.phase !== 'playing' ) {
			return state;
		}
		const next = copyGame( state );
		next.resumePhase = state.phase;
		next.phase = 'paused';
		emitEvent( next, 'pause', WIDTH / 2, HEIGHT / 2, reason );
		return next;
	}

	function resumeGame( state ) {
		if ( state.phase !== 'paused' ) {
			return state;
		}
		const next = copyGame( state );
		next.phase = next.resumePhase || 'playing';
		next.resumePhase = null;
		emitEvent(
			next,
			'resume',
			WIDTH / 2,
			HEIGHT / 2,
			'Connection restored.'
		);
		return next;
	}

	function restartGame() {
		return createGame();
	}

	function circleRectCollision( circle, rect ) {
		const closestX = clamp( circle.x, rect.x, rect.x + rect.w );
		const closestY = clamp( circle.y, rect.y, rect.y + rect.h );
		const dx = circle.x - closestX;
		const dy = circle.y - closestY;
		const distanceSquared = dx * dx + dy * dy;
		if ( distanceSquared > circle.r * circle.r ) {
			return null;
		}
		if ( distanceSquared > 0.000001 ) {
			const distance = Math.sqrt( distanceSquared );
			return {
				normalX: dx / distance,
				normalY: dy / distance,
				penetration: circle.r - distance,
			};
		}
		const candidates = [
			{ distance: Math.abs( circle.x - rect.x ), normalX: -1, normalY: 0 },
			{
				distance: Math.abs( rect.x + rect.w - circle.x ),
				normalX: 1,
				normalY: 0,
			},
			{ distance: Math.abs( circle.y - rect.y ), normalX: 0, normalY: -1 },
			{
				distance: Math.abs( rect.y + rect.h - circle.y ),
				normalX: 0,
				normalY: 1,
			},
		].sort( ( first, second ) => first.distance - second.distance );
		return {
			normalX: candidates[ 0 ].normalX,
			normalY: candidates[ 0 ].normalY,
			penetration: circle.r + candidates[ 0 ].distance,
		};
	}

	function reflectBallFromRect( ball, rect ) {
		const collision = circleRectCollision( ball, rect );
		if ( ! collision ) {
			return false;
		}
		ball.x += collision.normalX * ( collision.penetration + 0.1 );
		ball.y += collision.normalY * ( collision.penetration + 0.1 );
		const approach =
			ball.vx * collision.normalX + ball.vy * collision.normalY;
		if ( approach < 0 ) {
			ball.vx -= 2 * approach * collision.normalX;
			ball.vy -= 2 * approach * collision.normalY;
		}
		return true;
	}

	function normalizeBallSpeed( ball, requestedSpeed = ball.speed ) {
		const current = Math.hypot( ball.vx, ball.vy ) || START_SPEED;
		const speed = clamp( requestedSpeed, START_SPEED, MAX_SPEED );
		ball.vx = ( ball.vx / current ) * speed;
		ball.vy = ( ball.vy / current ) * speed;
		const minimumVertical = speed * 0.3;
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

	function popupCloseRect( popup ) {
		const size = popup.kind === 'boss' ? 38 : 34;
		return {
			x: popup.x + popup.w - size - 5,
			y: popup.y + 5,
			w: size,
			h: size,
		};
	}

	function spawnWave( state, waveIndex ) {
		const definitions = WAVE_DEFINITIONS[ waveIndex ] || [];
		for ( const definition of definitions ) {
			state.popups.push( {
				...definition,
				wave: waveIndex + 1,
				age: 0,
				solid: false,
				baseX: definition.x,
			} );
		}
		state.waveIndex = waveIndex + 1;
		emitEvent(
			state,
			'wave',
			WIDTH / 2,
			270,
			waveIndex === 2
				? 'Malware boss! Track the moving X.'
				: `Popup wave ${ waveIndex + 1 }. Bank a shot into the X.`
		);
	}

	function updatePopups( state, dt ) {
		while (
			state.waveIndex < WAVE_SCHEDULE.length &&
			state.activeTime >= WAVE_SCHEDULE[ state.waveIndex ]
		) {
			spawnWave( state, state.waveIndex );
		}
		for ( const popup of state.popups ) {
			popup.age += dt;
			if ( popup.moving ) {
				popup.x = clamp(
					popup.baseX + Math.sin( popup.age * 1.8 ) * 112,
					18,
					WIDTH - popup.w - 18
				);
			}
			if ( popup.age >= 0.42 ) {
				popup.solid = true;
			}
		}
	}

	function movePaddle( state, input, dt ) {
		const hasPointer =
			POINTER_SNAP &&
			input.pointerActive &&
			Number.isFinite( input.targetX );
		if ( hasPointer ) {
			const nextX = clamp(
				input.targetX - state.paddle.w / 2,
				0,
				WIDTH - state.paddle.w
			);
			state.paddle.vx = dt > 0 ? ( nextX - state.paddle.x ) / dt : 0;
			state.paddle.x = nextX;
			return;
		}
		const direction =
			( input.right ? 1 : 0 ) - ( input.left ? 1 : 0 );
		if ( direction !== 0 ) {
			state.paddle.vx += direction * KEYBOARD_ACCELERATION * dt;
		} else {
			const friction = KEYBOARD_FRICTION * dt;
			state.paddle.vx =
				Math.abs( state.paddle.vx ) <= friction
					? 0
					: state.paddle.vx - Math.sign( state.paddle.vx ) * friction;
		}
		state.paddle.vx = clamp(
			state.paddle.vx,
			-KEYBOARD_MAX_SPEED,
			KEYBOARD_MAX_SPEED
		);
		state.paddle.x = clamp(
			state.paddle.x + state.paddle.vx * dt,
			0,
			WIDTH - state.paddle.w
		);
		if (
			state.paddle.x <= 0 ||
			state.paddle.x >= WIDTH - state.paddle.w
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
			state.score += 150;
		}
		return targets.length;
	}

	function spawnMultiball( state, sourceBall ) {
		const speed = clamp( sourceBall.speed + 14, START_SPEED, MAX_SPEED );
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
		state.multiballTimer = MULTIBALL_SECONDS;
	}

	function closePopup( state, popupIndex, ball ) {
		const popup = state.popups[ popupIndex ];
		const centerX = popup.x + popup.w / 2;
		const centerY = popup.y + popup.h / 2;
		state.popups.splice( popupIndex, 1 );
		state.popupCloses += 1;
		state.score += popup.kind === 'boss' ? 1100 : 750;
		const burst = destroyNearbyBricks(
			state,
			centerX,
			centerY,
			popup.kind === 'boss' ? 4 : 3
		);
		if ( state.balls.length < 3 ) {
			spawnMultiball( state, ball );
		}
		state.hitStop = popup.kind === 'boss' ? 0.06 : 0.04;
		emitEvent(
			state,
			'popup-close',
			centerX,
			centerY,
			`Cache burst! ${ burst } corruption blocks purged. Multiball online.`
		);
	}

	function handlePopupCollisions( state, ball ) {
		for ( let index = state.popups.length - 1; index >= 0; index -= 1 ) {
			const popup = state.popups[ index ];
			if ( ! popup.solid ) {
				continue;
			}
			const closeRect = popupCloseRect( popup );
			if ( circleRectCollision( ball, closeRect ) ) {
				reflectBallFromRect( ball, closeRect );
				closePopup( state, index, ball );
				return true;
			}
		}
		return false;
	}

	function handleBrickCollision( state, ball ) {
		for ( const brick of state.bricks ) {
			if ( brick.destroyed || ! circleRectCollision( ball, brick ) ) {
				continue;
			}
			reflectBallFromRect( ball, brick );
			brick.hp -= 1;
			state.score += brick.points;
			if ( brick.hp <= 0 ) {
				brick.destroyed = true;
				state.bricksDestroyed += 1;
			}
			normalizeBallSpeed( ball, ball.speed + 3.5 );
			emitEvent(
				state,
				'brick',
				brick.x + brick.w / 2,
				brick.y + brick.h / 2,
				brick.destroyed
					? 'Corruption cleared.'
					: 'Encrypted block cracked. One more hit.'
			);
			return true;
		}
		return false;
	}

	function handlePaddleCollision( state, ball ) {
		if (
			ball.vy <= 0 ||
			! circleRectCollision( ball, state.paddle )
		) {
			return false;
		}
		ball.y = state.paddle.y - ball.r - 0.1;
		const relative = clamp(
			( ball.x - ( state.paddle.x + state.paddle.w / 2 ) ) /
				( state.paddle.w / 2 ),
			-1,
			1
		);
		const angle = clamp( relative * 1.18, -1.18, 1.18 );
		const speed = clamp( ball.speed + 1.4, START_SPEED, MAX_SPEED );
		ball.vx = Math.sin( angle ) * speed + state.paddle.vx * 0.08;
		ball.vy = -Math.abs( Math.cos( angle ) * speed );
		normalizeBallSpeed( ball, speed );
		emitEvent(
			state,
			'paddle',
			ball.x,
			state.paddle.y,
			'Clean return.'
		);
		return true;
	}

	function moveBall( state, ball, dt ) {
		ball.x += ball.vx * dt;
		ball.y += ball.vy * dt;
		if ( ball.x - ball.r < 0 ) {
			ball.x = ball.r;
			ball.vx = Math.abs( ball.vx );
		} else if ( ball.x + ball.r > WIDTH ) {
			ball.x = WIDTH - ball.r;
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
		handlePaddleCollision( state, ball );
	}

	function finishGame( state, result, endReason = 'time' ) {
		state.phase = 'results';
		state.result = result;
		state.endReason = endReason;
		state.balls = [];
		state.popups = [];
		state.hitStop = 0;
		emitEvent(
			state,
			result,
			WIDTH / 2,
			HEIGHT / 2,
			result === 'rescued'
				? 'Mira’s sky log is back online.'
				: endReason === 'lives'
					? 'The connection dropped, but your rescue score is safe.'
					: 'The archive timed out, but your rescue score is safe.'
		);
	}

	function evaluateFinish( state ) {
		if (
			state.bricksDestroyed === state.bricks.length &&
			state.waveIndex === WAVE_DEFINITIONS.length &&
			state.popups.length === 0
		) {
			state.score += Math.ceil( state.timeLeft ) * 20 + state.lives * 500;
			finishGame( state, 'rescued', 'clear' );
			return true;
		}
		if ( state.timeLeft <= 0 ) {
			const restored = state.bricksDestroyed / state.bricks.length;
			finishGame(
				state,
				restored >= 0.8 && state.popupCloses >= 3
					? 'rescued'
					: 'overrun',
				'time'
			);
			return true;
		}
		return false;
	}

	function resetPrimaryBall( state ) {
		const direction = state.lives % 2 === 0 ? -1 : 1;
		state.balls = [ createBall( state.nextBallId, direction ) ];
		state.nextBallId += 1;
		state.balls[ 0 ].primary = true;
		state.balls[ 0 ].stuck = true;
		state.serveDelay = 1.15;
		state.paddle.x = ( WIDTH - state.paddle.w ) / 2;
		state.paddle.vx = 0;
	}

	function stepGame( state, input = {}, dt = FIXED_STEP ) {
		const safeDt = clamp( Number( dt ) || 0, 0, 0.05 );
		if ( safeDt <= 0 || state.phase !== 'playing' ) {
			return state;
		}
		const next = copyGame( state );
		if ( next.hitStop > 0 ) {
			next.hitStop = Math.max( 0, next.hitStop - safeDt );
			return next;
		}

		next.activeTime += safeDt;
		next.timeLeft = Math.max( 0, ROUND_SECONDS - next.activeTime );
		movePaddle( next, input, safeDt );
		updatePopups( next, safeDt );
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
		for ( const ball of next.balls ) {
			moveBall( next, ball, safeDt );
		}
		next.balls = next.balls.filter(
			( ball ) => ball.y - ball.r <= HEIGHT + 4
		);

		if ( next.multiballTimer > 0 ) {
			next.multiballTimer = Math.max( 0, next.multiballTimer - safeDt );
			if ( next.multiballTimer === 0 && next.balls.length > 1 ) {
				const survivor =
					next.balls.find( ( ball ) => ball.primary ) || next.balls[ 0 ];
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
			next.lives -= 1;
			if ( next.lives <= 0 ) {
				finishGame( next, 'overrun', 'lives' );
				return next;
			}
			resetPrimaryBall( next );
			emitEvent(
				next,
				'miss',
				WIDTH / 2,
				HEIGHT - 30,
				`Connection dropped. ${ next.lives } ${ next.lives === 1 ? 'life' : 'lives' } left.`
			);
		}

		evaluateFinish( next );
		return next;
	}

	function progressPercent( state ) {
		return Math.round(
			( state.bricksDestroyed / Math.max( 1, state.bricks.length ) ) * 100
		);
	}

	function resultSummary( state ) {
		return Object.freeze( {
			result: state.result,
			score: Math.max( 0, Math.round( state.score ) ),
			restored: progressPercent( state ),
			popupsClosed: state.popupCloses,
			bricksDestroyed: state.bricksDestroyed,
			secondsPlayed: Math.min(
				ROUND_SECONDS,
				Math.round( state.activeTime )
			),
		} );
	}

	function createPixiRenderer( host, options = {} ) {
		if ( ! kit || typeof kit.createPixiStage !== 'function' ) {
			return Promise.reject(
				new Error( 'OpenStation Game Kit 0.1.0 is required.' )
			);
		}
		return kit.createPixiStage( host, {
			width: WIDTH,
			height: HEIGHT,
			background: '#071326',
			window: options.window || global,
			PIXI: options.PIXI,
		} ).then( ( stage ) => {
			const { PIXI } = stage;
			const background = new PIXI.Graphics();
			const objects = new PIXI.Graphics();
			const effects = new PIXI.Graphics();
			const siteLabel = new PIXI.Text( {
				text: "MIRA'S NIGHT SKY // OCT 1999",
				style: {
					fontFamily: 'monospace',
					fontSize: 13,
					fontWeight: 'bold',
					fill: 0x8fffd8,
					letterSpacing: 1,
				},
			} );
			siteLabel.x = 18;
			siteLabel.y = 18;
			stage.app.stage.addChild( background, objects, effects, siteLabel );

			const stars = Array.from( { length: 48 }, ( _, index ) => ( {
				x: ( index * 83 + 29 ) % WIDTH,
				y: 45 + ( index * 47 ) % 440,
				r: index % 9 === 0 ? 1.6 : 0.8,
			} ) );
			const particles = [];
			const trails = new Map();
			let lastEventId = 0;

			function drawBackground() {
				background.clear();
				background.rect( 0, 0, WIDTH, HEIGHT ).fill( 0x071326 );
				background.rect( 10, 10, WIDTH - 20, HEIGHT - 20 )
					.fill( { color: 0x0b1d38, alpha: 0.94 } )
					.stroke( { width: 2, color: 0x274d78 } );
				for ( const star of stars ) {
					background
						.circle( star.x, star.y, star.r )
						.fill( { color: 0xc8f6ff, alpha: 0.55 } );
				}
				background
					.circle( 422, 48, 22 )
					.fill( { color: 0xffefad, alpha: 0.92 } );
				background
					.circle( 414, 43, 22 )
					.fill( { color: 0x0b1d38, alpha: 1 } );
				background.rect( 12, 48, WIDTH - 24, 3 ).fill( 0x6c4fff );
				background.rect( 12, 244, WIDTH - 24, 2 )
					.fill( { color: 0x31577e, alpha: 0.7 } );
			}

			function drawBrick( brick ) {
				const damageAlpha = brick.hp < brick.maxHp ? 0.65 : 1;
				objects
					.roundRect( brick.x, brick.y, brick.w, brick.h, 3 )
					.fill( { color: brick.color, alpha: damageAlpha } )
					.stroke( { width: 2, color: 0xf5f1ff, alpha: 0.38 } );
				if ( brick.row === 0 ) {
					objects.rect( brick.x + 5, brick.y + 6, brick.w - 10, 3 )
						.fill( { color: 0xffffff, alpha: 0.78 } );
					objects.rect( brick.x + 5, brick.y + 13, brick.w * 0.52, 3 )
						.fill( { color: 0x251848, alpha: 0.72 } );
				} else if ( brick.row === 1 ) {
					objects.circle(
						brick.x + 13 + ( brick.column % 3 ) * 18,
						brick.y + 12,
						5
					).fill( { color: 0xfff4bd, alpha: 0.95 } );
				} else if ( brick.row === 2 ) {
					for ( let line = 0; line < 3; line += 1 ) {
						objects.rect(
							brick.x + 6,
							brick.y + 6 + line * 6,
							brick.w - 12 - line * 9,
							2
						).fill( { color: 0x063f43, alpha: 0.7 } );
					}
				} else if ( brick.row === 3 ) {
					objects
						.rect( brick.x + 7, brick.y + 5, 23, 15 )
						.fill( { color: 0x30152a, alpha: 0.52 } );
					objects
						.circle( brick.x + 51, brick.y + 12, 7 )
						.fill( { color: 0xffd0e0, alpha: 0.8 } );
				} else {
					objects
						.moveTo( brick.x + 7, brick.y + brick.h / 2 )
						.lineTo( brick.x + brick.w - 7, brick.y + brick.h / 2 )
						.stroke( { width: 3, color: 0xdce9ff, alpha: 0.75 } );
					objects
						.circle( brick.x + brick.w / 2, brick.y + brick.h / 2, 5 )
						.fill( 0x18345f );
				}
				if ( brick.hp < brick.maxHp ) {
					objects
						.moveTo( brick.x + 18, brick.y + 2 )
						.lineTo( brick.x + 33, brick.y + 13 )
						.lineTo( brick.x + 26, brick.y + brick.h - 2 )
						.stroke( { width: 2, color: 0x3d184c } );
				}
			}

			function drawPopup( popup ) {
				const warning = ! popup.solid;
				objects
					.rect( popup.x + 5, popup.y + 6, popup.w, popup.h )
					.fill( { color: 0x000000, alpha: 0.42 } );
				objects
					.rect( popup.x, popup.y, popup.w, popup.h )
					.fill( warning ? 0xfff4c2 : 0xd5d2ca )
					.stroke( {
						width: warning ? 3 : 2,
						color: warning ? 0xffdd45 : 0xffffff,
					} );
				objects
					.rect( popup.x + 3, popup.y + 3, popup.w - 6, 32 )
					.fill( popup.kind === 'boss' ? 0x7d1028 : 0x183d94 );
				for ( let line = 0; line < 3; line += 1 ) {
					objects
						.rect(
							popup.x + 12,
							popup.y + 44 + line * 10,
							Math.max( 24, popup.w - 48 - line * 18 ),
							4
						)
						.fill( {
							color: line === 0 ? 0x4c4860 : 0x77727f,
							alpha: 0.7,
						} );
				}
				const close = popupCloseRect( popup );
				objects
					.rect( close.x, close.y, close.w, close.h )
					.fill( warning ? 0xffe36d : 0xf6f3eb )
					.stroke( { width: 3, color: 0x1b1b22 } );
				objects
					.moveTo( close.x + 7, close.y + 7 )
					.lineTo( close.x + close.w - 7, close.y + close.h - 7 )
					.moveTo( close.x + close.w - 7, close.y + 7 )
					.lineTo( close.x + 7, close.y + close.h - 7 )
					.stroke( { width: 4, color: 0xc11238 } );
			}

			function addEventParticles( state ) {
				if (
					! state.lastEvent ||
					state.lastEvent.id === lastEventId
				) {
					return;
				}
				lastEventId = state.lastEvent.id;
				const type = state.lastEvent.type;
				const count =
					type === 'popup-close' ? 34 : type === 'brick' ? 9 : 4;
				for ( let index = 0; index < count; index += 1 ) {
					const angle = ( Math.PI * 2 * index ) / count;
					const speed = 35 + ( ( index * 31 ) % 95 );
					particles.push( {
						x: state.lastEvent.x,
						y: state.lastEvent.y,
						vx: Math.cos( angle ) * speed,
						vy: Math.sin( angle ) * speed,
						life: type === 'popup-close' ? 0.55 : 0.3,
						maxLife: type === 'popup-close' ? 0.55 : 0.3,
						color:
							type === 'popup-close'
								? index % 2
									? 0xffda58
									: 0x55f0d0
								: 0xffffff,
					} );
				}
			}

			function render( state, previousState = state, alpha = 1, frameDelta = 1 / 60 ) {
				addEventParticles( state );
				objects.clear();
				effects.clear();
				for ( const brick of state.bricks ) {
					if ( ! brick.destroyed ) {
						drawBrick( brick );
					}
				}
				for ( const popup of state.popups ) {
					drawPopup( popup );
				}

				const previousPaddle = previousState.paddle || state.paddle;
				const paddleX = lerp(
					previousPaddle.x,
					state.paddle.x,
					alpha
				);
				const squash =
					state.lastEvent &&
					state.lastEvent.type === 'paddle' &&
					state.lastEvent.id === lastEventId
						? 2
						: 0;
				objects
					.roundRect(
						paddleX - squash,
						state.paddle.y - squash / 2,
						state.paddle.w + squash * 2,
						state.paddle.h + squash,
						6
					)
					.fill( 0xeaf8ff )
					.stroke( { width: 3, color: 0x4de1c1 } );
				objects
					.rect(
						paddleX + 14,
						state.paddle.y + 5,
						state.paddle.w - 28,
						3
					)
					.fill( 0x286f88 );

				for ( const ball of state.balls ) {
					const previousBall =
						previousState.balls.find(
							( candidate ) => candidate.id === ball.id
						) || ball;
					const x = lerp( previousBall.x, ball.x, alpha );
					const y = lerp( previousBall.y, ball.y, alpha );
					const trail = trails.get( ball.id ) || [];
					trail.push( { x, y } );
					if ( trail.length > 7 ) {
						trail.shift();
					}
					trails.set( ball.id, trail );
					trail.forEach( ( point, index ) => {
						effects
							.circle( point.x, point.y, 2 + index * 0.42 )
							.fill( {
								color: ball.primary ? 0x8fffe1 : 0xffd45a,
								alpha: 0.06 + index * 0.055,
							} );
					} );
					objects
						.circle( x, y, ball.r + 2 )
						.fill( {
							color: ball.primary ? 0x55f0d0 : 0xffcf4a,
							alpha: 0.22,
						} );
					objects
						.circle( x, y, ball.r )
						.fill( 0xffffff )
						.stroke( {
							width: 2,
							color: ball.primary ? 0x4de1c1 : 0xffb923,
						} );
				}
				for ( const id of trails.keys() ) {
					if ( ! state.balls.some( ( ball ) => ball.id === id ) ) {
						trails.delete( id );
					}
				}

				for ( const particle of particles ) {
					particle.life -= Math.min( 0.05, frameDelta );
					particle.x += particle.vx * frameDelta;
					particle.y += particle.vy * frameDelta;
					particle.vy += 150 * frameDelta;
					if ( particle.life > 0 ) {
						effects
							.rect( particle.x, particle.y, 3, 3 )
							.fill( {
								color: particle.color,
								alpha: particle.life / particle.maxLife,
							} );
					}
				}
				for ( let index = particles.length - 1; index >= 0; index -= 1 ) {
					if ( particles[ index ].life <= 0 ) {
						particles.splice( index, 1 );
					}
				}
				stage.render();
			}

			drawBackground();
			stage.render();
			return Object.freeze( {
				canvas: stage.canvas,
				mapPointer: stage.mapPointer,
				render,
				destroy: stage.destroy,
			} );
		} );
	}

	function mount( container, options = {} ) {
		if ( ! container || ! container.ownerDocument ) {
			throw new Error( 'Popup Breaker requires a DOM container.' );
		}
		const doc = container.ownerDocument;
		const win = doc.defaultView || global;
		if ( ! kit ) {
			throw new Error( 'OpenStation Game Kit 0.1.0 is required.' );
		}
		const lifecycle = kit.createLifecycle();
		const audio = kit.createAudioBus( {
			window: win,
			enabled: options.sound !== false,
		} );
		lifecycle.add( () => audio.dispose() );

		const root = doc.createElement( 'section' );
		root.className = 'siege-game';
		root.dataset.prototype = 'popup-siege-v0-2';
		root.dataset.phase = 'loading';
		root.innerHTML = `
			<header class="siege-header">
				<div class="siege-brand">
					<span class="siege-brand__kicker">OPENSTATION ARCADE 002</span>
					<strong>POPUP SIEGE</strong>
				</div>
				<div class="siege-hud" aria-label="Current run">
					<span><small>SCORE</small><b data-role="score">000000</b></span>
					<span><small>TIME</small><b data-role="time">1:30</b></span>
					<span><small>LIVES</small><b data-role="lives">●●●</b></span>
					<span><small>POPUPS</small><b data-role="popups">0 / 4</b></span>
				</div>
				<div class="siege-actions">
					<button type="button" data-action="sound" aria-pressed="true">Sound on</button>
					<button type="button" data-action="pause">Pause</button>
					<button type="button" data-action="close">Close</button>
				</div>
			</header>
			<div class="siege-body">
				<div class="siege-browser" aria-label="Mira's Night Sky under popup attack">
					<div class="siege-browser__bar" aria-hidden="true">
						<span class="siege-browser__icon">N</span>
						<span class="siege-browser__address">http://geocities.example/capecanaveral/meteorwatch/</span>
						<span class="siege-browser__status">ARCHIVE LINK: LIVE</span>
					</div>
					<div class="siege-stage" tabindex="0" role="application" aria-label="Popup Siege playfield" aria-describedby="siege-help">
						<div class="siege-renderer" data-role="renderer"></div>
						<div class="siege-overlay">
							<section class="siege-card siege-card--menu" data-screen="menu">
								<p class="siege-card__eyebrow">ONE PAGE LEFT ONLINE</p>
								<h1>Save Mira's<br /><em>sky log.</em></h1>
								<p>Keep the ball alive. Bank shots into every popup <b>X</b>. Each close purges corruption and unleashes multiball.</p>
								<div class="siege-objective">
									<span>90 SEC</span><span>3 LIVES</span><span>4 POPUPS</span>
								</div>
								<button class="siege-primary" type="button" data-action="start">BREAK IN</button>
								<small>Move with pointer, touch, ← →, or A / D</small>
							</section>
							<section class="siege-card siege-card--pause" data-screen="pause" hidden>
								<p class="siege-card__eyebrow">CONNECTION HELD</p>
								<h2>Paused</h2>
								<p>The timer and every moving threat are frozen.</p>
								<button class="siege-primary" type="button" data-action="resume">RESUME</button>
							</section>
							<section class="siege-card siege-card--results" data-screen="results" hidden>
								<p class="siege-card__eyebrow" data-role="result-kicker">ARCHIVE COMPLETE</p>
								<h2 tabindex="-1" data-role="result-title">Mira's sky log is back.</h2>
								<div class="siege-results">
									<span><small>SCORE</small><b data-role="result-score">0</b></span>
									<span><small>RESTORED</small><b data-role="result-restored">0%</b></span>
									<span><small>POPUPS CLOSED</small><b data-role="result-popups">0 / 4</b></span>
								</div>
								<p data-role="result-copy">The archive caught the page before it vanished.</p>
								<div class="siege-card__buttons">
									<button class="siege-primary" type="button" data-action="restart">PLAY AGAIN</button>
									<button type="button" data-action="close">CLOSE</button>
								</div>
							</section>
							<section class="siege-card siege-card--error" data-screen="error" hidden>
								<p class="siege-card__eyebrow">RENDERER OFFLINE</p>
								<h2>Could not open the archive.</h2>
								<p>Shared PixiJS did not start. Close this session and try again.</p>
								<button type="button" data-action="close">CLOSE</button>
							</section>
						</div>
					</div>
				</div>
				<footer class="siege-footer">
					<p id="siege-help">Move: pointer / touch / A D / arrows · Pause: P or Escape · Aim at the red X</p>
					<p class="siege-status" data-role="status" aria-live="polite">Loading the archive…</p>
				</footer>
			</div>
		`;
		container.replaceChildren( root );

		const rendererHost = root.querySelector( '[data-role="renderer"]' );
		const stageNode = root.querySelector( '.siege-stage' );
		const screens = Array.from( root.querySelectorAll( '[data-screen]' ) );
		const scoreNode = root.querySelector( '[data-role="score"]' );
		const timeNode = root.querySelector( '[data-role="time"]' );
		const livesNode = root.querySelector( '[data-role="lives"]' );
		const popupsNode = root.querySelector( '[data-role="popups"]' );
		const statusNode = root.querySelector( '[data-role="status"]' );
		const soundButton = root.querySelector( '[data-action="sound"]' );
		let state = createGame();
		let previousState = state;
		let renderer = null;
		let closeRequested = false;
		let lastEventId = 0;
		let lastScreen = null;
		const input = {
			left: false,
			right: false,
			pointerActive: false,
			targetX: WIDTH / 2,
		};

		function formatTime( seconds ) {
			const total = Math.max( 0, Math.ceil( seconds ) );
			return `${ Math.floor( total / 60 ) }:${ String( total % 60 ).padStart( 2, '0' ) }`;
		}

		function showScreen( name ) {
			if ( lastScreen === name ) {
				return;
			}
			lastScreen = name;
			for ( const screen of screens ) {
				screen.hidden = screen.dataset.screen !== name;
			}
		}

		function syncDom() {
			if ( lifecycle.disposed ) {
				return;
			}
			root.dataset.phase = state.phase;
			root.dataset.wave = String( state.waveIndex );
			root.dataset.popupCount = String( state.popups.length );
			root.dataset.multiball = state.balls.length > 1 ? 'true' : 'false';
			scoreNode.textContent = String( Math.round( state.score ) ).padStart( 6, '0' );
			timeNode.textContent = formatTime( state.timeLeft );
			livesNode.textContent = '●'.repeat( state.lives ) || '—';
			popupsNode.textContent = `${ state.popupCloses } / 4`;
			if ( state.eventId !== lastEventId ) {
				statusNode.textContent = state.message;
				if ( state.lastEvent ) {
					if ( state.lastEvent.type === 'popup-close' ) {
						audio.tone( 720, 0.08, 0.035, 'square' );
						lifecycle.timeout(
							() =>
								audio.tone( 980, 0.1, 0.025, 'square' ),
							55,
							win
						);
					} else if ( state.lastEvent.type === 'brick' ) {
						audio.tone( 310, 0.025, 0.012, 'square' );
					} else if ( state.lastEvent.type === 'paddle' ) {
						audio.tone( 190, 0.025, 0.01, 'triangle' );
					}
				}
				lastEventId = state.eventId;
			}

			if ( state.phase === 'menu' ) {
				showScreen( 'menu' );
			} else if ( state.phase === 'paused' ) {
				showScreen( 'pause' );
			} else if ( state.phase === 'results' ) {
				showScreen( 'results' );
				const summary = resultSummary( state );
				const rescued = summary.result === 'rescued';
				root.querySelector( '[data-role="result-kicker"]' ).textContent =
					rescued ? 'ARCHIVE COMPLETE' : 'ARCHIVE PARTIAL';
				root.querySelector( '[data-role="result-title"]' ).textContent =
					rescued
						? "Mira's sky log is back."
						: 'The page fought back.';
				root.querySelector( '[data-role="result-score"]' ).textContent =
					String( summary.score );
				root.querySelector( '[data-role="result-restored"]' ).textContent =
					`${ summary.restored }%`;
				root.querySelector( '[data-role="result-popups"]' ).textContent =
					`${ summary.popupsClosed } / 4`;
				root.querySelector( '[data-role="result-copy"]' ).textContent =
					rescued
						? 'The archive caught the page before it vanished.'
						: 'Close more red X targets to trigger cache bursts next run.';
				root.querySelector( '[data-role="result-title"]' ).focus();
			} else {
				lastScreen = null;
				for ( const screen of screens ) {
					screen.hidden = true;
				}
			}
		}

		function update( dt ) {
			previousState = state;
			state = stepGame( state, input, dt );
			syncDom();
		}

		function render( alpha, frameDelta ) {
			if ( renderer ) {
				renderer.render( state, previousState, alpha, frameDelta );
			}
		}

		const loop = kit.createFixedStepLoop( {
			window: win,
			step: FIXED_STEP,
			update,
			render,
		} );
		lifecycle.add( () => loop.dispose() );

		function requestStart() {
			const started = startGame( state );
			if ( started === state ) {
				return;
			}
			previousState = state;
			state = started;
			syncDom();
			stageNode.focus();
			audio.tone( 420, 0.06, 0.025, 'square' );
		}

		function requestPause() {
			const paused = pauseGame( state );
			if ( paused === state ) {
				return;
			}
			previousState = state;
			state = paused;
			syncDom();
			const resume = root.querySelector( '[data-action="resume"]' );
			if ( resume ) {
				resume.focus();
			}
		}

		function requestResume() {
			const resumed = resumeGame( state );
			if ( resumed === state ) {
				return;
			}
			previousState = state;
			state = resumed;
			syncDom();
			stageNode.focus();
		}

		function requestRestart() {
			previousState = state;
			state = restartGame();
			input.left = false;
			input.right = false;
			input.pointerActive = false;
			lastEventId = 0;
			lastScreen = null;
			syncDom();
			const start = root.querySelector( '[data-action="start"]' );
			if ( start ) {
				start.focus();
			}
		}

		function requestClose() {
			if ( closeRequested || lifecycle.disposed ) {
				return;
			}
			closeRequested = true;
			if ( typeof options.close === 'function' ) {
				options.close();
			}
		}

		function toggleSound() {
			const enabled = audio.setEnabled( ! audio.enabled );
			soundButton.setAttribute( 'aria-pressed', String( enabled ) );
			soundButton.textContent = enabled ? 'Sound on' : 'Sound off';
			if ( enabled ) {
				audio.tone( 520, 0.04, 0.02, 'square' );
			}
		}

		function onClick( event ) {
			const button = event.target.closest( '[data-action]' );
			if ( ! button || ! root.contains( button ) || button.disabled ) {
				return;
			}
			const action = button.dataset.action;
			if ( action === 'start' ) {
				requestStart();
			} else if ( action === 'pause' ) {
				requestPause();
			} else if ( action === 'resume' ) {
				requestResume();
			} else if ( action === 'restart' ) {
				requestRestart();
			} else if ( action === 'sound' ) {
				toggleSound();
			} else if ( action === 'close' ) {
				requestClose();
			}
		}

		function keyName( event ) {
			return String( event.key || '' ).toLowerCase();
		}

		function onKeyDown( event ) {
			const key = keyName( event );
			if ( key === 'arrowleft' || key === 'a' ) {
				input.left = true;
				input.pointerActive = false;
				event.preventDefault();
			} else if ( key === 'arrowright' || key === 'd' ) {
				input.right = true;
				input.pointerActive = false;
				event.preventDefault();
			} else if ( key === ' ' || key === 'enter' ) {
				if ( state.phase === 'menu' ) {
					requestStart();
					event.preventDefault();
				}
			} else if ( key === 'p' || key === 'escape' ) {
				if ( state.phase === 'paused' ) {
					requestResume();
				} else {
					requestPause();
				}
				event.preventDefault();
			}
		}

		function onKeyUp( event ) {
			const key = keyName( event );
			if ( key === 'arrowleft' || key === 'a' ) {
				input.left = false;
			} else if ( key === 'arrowright' || key === 'd' ) {
				input.right = false;
			}
		}

		function updatePointer( event ) {
			if ( ! renderer ) {
				return;
			}
			const point = renderer.mapPointer( event );
			input.targetX = point.x;
			input.pointerActive = true;
		}

		function onPointerDown( event ) {
			updatePointer( event );
			if ( state.phase === 'menu' ) {
				requestStart();
			}
			stageNode.focus();
		}

		function onBlur() {
			if ( state.phase === 'playing' ) {
				previousState = state;
				state = pauseGame(
					state,
					'Paused because the game lost focus.'
				);
				syncDom();
			}
		}

		function onVisibilityChange() {
			if ( doc.hidden && state.phase === 'playing' ) {
				previousState = state;
				state = pauseGame(
					state,
					'Paused while this tab is hidden.'
				);
				syncDom();
			}
		}

		lifecycle.listen( root, 'click', onClick );
		lifecycle.listen( root, 'keydown', onKeyDown );
		lifecycle.listen( root, 'keyup', onKeyUp );
		lifecycle.listen( stageNode, 'pointermove', updatePointer );
		lifecycle.listen( stageNode, 'pointerdown', onPointerDown );
		lifecycle.listen( win, 'blur', onBlur );
		lifecycle.listen( doc, 'visibilitychange', onVisibilityChange );

		const rendererFactory =
			typeof options.rendererFactory === 'function'
				? options.rendererFactory
				: createPixiRenderer;
		const ready = Promise.resolve()
			.then( () =>
				rendererFactory( rendererHost, {
					window: win,
					PIXI: options.PIXI,
				} )
			)
			.then( lifecycle.guard( ( nextRenderer ) => {
				renderer = nextRenderer;
				lifecycle.add( () => {
					if ( renderer ) {
						renderer.destroy();
						renderer = null;
					}
				} );
				root.dataset.phase = state.phase;
				statusNode.textContent =
					'Mira’s final meteor log is one clean run from the archive.';
				renderer.render( state, state, 1, 0 );
				syncDom();
				if ( options.autoStart !== false ) {
					loop.start();
				}
				const start = root.querySelector( '[data-action="start"]' );
				if ( start ) {
					start.focus();
				}
				return nextRenderer;
			} ) )
			.catch( lifecycle.guard( ( error ) => {
				root.dataset.phase = 'error';
				showScreen( 'error' );
				statusNode.textContent = error.message;
				return null;
			} ) );

		syncDom();

		return Object.freeze( {
			ready,
			getState() {
				return copyGame( state );
			},
			setState( nextState ) {
				if ( lifecycle.disposed ) {
					return;
				}
				previousState = state;
				state = copyGame( nextState );
				syncDom();
				render( 1, 0 );
			},
			advance( seconds ) {
				loop.advance( seconds );
				return copyGame( state );
			},
			start: requestStart,
			pause: requestPause,
			resume: requestResume,
			restart: requestRestart,
			teardown() {
				if ( lifecycle.disposed ) {
					return;
				}
				lifecycle.dispose();
				container.replaceChildren();
			},
		} );
	}

	return Object.freeze( {
		ASSET_VERSION,
		RULES_VERSION,
		WIDTH,
		HEIGHT,
		FIXED_STEP,
		ROUND_SECONDS,
		BALL_RADIUS,
		START_SPEED,
		MAX_SPEED,
		KEYBOARD_ACCELERATION,
		KEYBOARD_FRICTION,
		KEYBOARD_MAX_SPEED,
		PADDLE_WIDTH,
		PADDLE_Y,
		MULTIBALL_SECONDS,
		WAVE_SCHEDULE,
		WAVE_DEFINITIONS,
		BRICK_ROWS,
		createBricks,
		createBall,
		createGame,
		copyGame,
		startGame,
		pauseGame,
		resumeGame,
		restartGame,
		circleRectCollision,
		reflectBallFromRect,
		popupCloseRect,
		spawnWave,
		destroyNearbyBricks,
		spawnMultiball,
		stepGame,
		progressPercent,
		resultSummary,
		createPixiRenderer,
		mount,
	} );
} );
