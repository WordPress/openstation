( function ( global ) {
	'use strict';

	const GAME_ID = 'popup-siege';
	const ASSET_VERSION = '0.7.0';
	const RULES_VERSION = 3;
	const RUNTIME_KEY = '__openstationPopupSiegeRuntime070';
	const DOCK_SAFE_INSET = 112;
	const MIN_SAFE_HEIGHT = 440;
	const SCRIPT_FILES = Object.freeze( [
		[ 'asset', 'popup-siege-runtime-0.7.0.js' ],
	] );

	function joinUrl( base, file ) {
		return `${ String( base || '' ).replace( /\/?$/, '/' ) }${ file }`;
	}

	function loadScript( url ) {
		return new Promise( ( resolve, reject ) => {
			const script = global.document.createElement( 'script' );
			script.src = url;
			script.async = false;
			script.addEventListener( 'load', resolve, { once: true } );
			script.addEventListener(
				'error',
				() => reject( new Error( `Popup Siege could not load ${ url }.` ) ),
				{ once: true }
			);
			global.document.head.append( script );
		} );
	}

	function loadRuntime( config ) {
		if (
			global.PopupBreaker &&
			global.PopupBreaker.ASSET_VERSION === ASSET_VERSION
		) {
			return Promise.resolve( global.PopupBreaker );
		}
		if ( global[ RUNTIME_KEY ] ) {
			return global[ RUNTIME_KEY ];
		}

		const assetBaseUrl = String( config.assetBaseUrl || '' );
		const sdkBaseUrl = String( config.sdkBaseUrl || '' );
		if ( ! assetBaseUrl || ! sdkBaseUrl ) {
			return Promise.reject(
				new Error( 'Popup Siege runtime URLs are unavailable.' )
			);
		}

		global[ RUNTIME_KEY ] = SCRIPT_FILES.reduce(
			( chain, [ kind, file ] ) =>
				chain.then( () =>
					loadScript(
						joinUrl(
							kind === 'sdk' ? sdkBaseUrl : assetBaseUrl,
							file
						)
					)
				),
			Promise.resolve()
		).then( () => {
			if (
				! global.PopupBreaker ||
				global.PopupBreaker.ASSET_VERSION !== ASSET_VERSION
			) {
				throw new Error( 'Popup Siege 0.7.0 did not initialize.' );
			}
			return global.PopupBreaker;
		} ).catch( ( error ) => {
			delete global[ RUNTIME_KEY ];
			throw error;
		} );

		return global[ RUNTIME_KEY ];
	}

	function attachStyle( root, url ) {
		return new Promise( ( resolve, reject ) => {
			const link = global.document.createElement( 'link' );
			link.rel = 'stylesheet';
			link.href = url;
			link.addEventListener( 'load', resolve, { once: true } );
			link.addEventListener(
				'error',
				() => reject( new Error( 'Popup Siege styles could not load.' ) ),
				{ once: true }
			);
			root.append( link );
		} );
	}

	function showMessage( target, title, copy, actions = [] ) {
		target.replaceChildren();
		const region = global.document.createElement( 'section' );
		const heading = global.document.createElement( 'h2' );
		const description = global.document.createElement( 'p' );
		region.className = 'openstation-popup-siege-message';
		region.setAttribute( 'role', 'status' );
		region.setAttribute( 'aria-live', 'polite' );
		heading.textContent = title;
		description.textContent = copy;
		region.append( heading, description );
		if ( Array.isArray( actions ) && actions.length > 0 ) {
			const controls = global.document.createElement( 'div' );
			controls.className = 'openstation-popup-siege-message__actions';
			for ( const action of actions ) {
				if ( ! action || typeof action.onClick !== 'function' ) {
					continue;
				}
				const button = global.document.createElement( 'button' );
				button.type = 'button';
				button.textContent = String( action.label || 'Continue' );
				button.addEventListener( 'click', action.onClick, { once: true } );
				controls.append( button );
			}
			region.append( controls );
		}
		target.append( region );
		heading.tabIndex = -1;
		heading.focus( { preventScroll: true } );
	}

	function buildPayload( game, state, challenge ) {
		const summary = game.resultSummary( state );
		const terminal = summary.terminalSnapshot;
		if ( ! terminal ) {
			throw new Error( 'Popup Siege result is missing its terminal snapshot.' );
		}
		if ( terminal.rulesVersion !== RULES_VERSION ) {
			throw new Error( 'Popup Siege result uses an unsupported rules version.' );
		}
		const breakdown = terminal.scoreBreakdown;
		const objectiveStates = terminal.objectiveStates
			.map(
				( objective ) =>
					`${ objective.id }:${ objective.status }:${ objective.closed }/${ objective.total }`
			)
			.join( '|' );
		return Object.freeze( {
			score: terminal.score,
			meta: Object.freeze( {
				terminal_schema_version: terminal.schemaVersion,
				rules_version: terminal.rulesVersion,
				time: terminal.secondsPlayed,
				seconds_remaining: terminal.secondsRemaining,
				lives_remaining: terminal.livesRemaining,
				bricks_destroyed: terminal.bricksDestroyed,
				bricks_total: terminal.bricksTotal,
				restored: terminal.restored,
				closed_popup_ids: terminal.closedPopupIds.join( ',' ),
				popups_closed: terminal.popupsClosed,
				popups_total: terminal.popupsTotal,
				objective_states: objectiveStates,
				first_unfinished_objective_id:
					terminal.firstUnfinishedObjectiveId || '',
				brick_points: breakdown.brickPoints,
				popup_points: breakdown.popupPoints,
				purge_points: breakdown.purgePoints,
				clear_bonus: breakdown.clearBonus,
				result: terminal.result,
				end_reason: terminal.endReason,
				mode: challenge ? 'Challenge' : 'Free Play',
			} ),
		} );
	}

	function render( ctx ) {
		const container = ctx.container;
		let controller = null;
		let disposed = false;
		let monitorFrame = null;
		let payload = null;
		let submissionGeneration = 0;
		let submitting = false;
		let hostResizeObserver = null;
		let unsubscribeState = null;
		let unsubscribeWindow = null;

		container.replaceChildren();
		const host = global.document.createElement( 'div' );
		host.className = 'openstation-popup-siege-host';
		const shadow = host.attachShadow( { mode: 'open' } );
		const mountPoint = global.document.createElement( 'main' );
		mountPoint.id = 'popup-breaker-preview';
		mountPoint.setAttribute( 'aria-label', 'Popup Siege' );
		shadow.append( mountPoint );
		container.append( host );

		const syncHostHeight = () => {
			if ( disposed ) {
				return;
			}
			const rect = container.getBoundingClientRect();
			const containerHeight = Math.max(
				0,
				Number( container.clientHeight ) || rect.height || 0
			);
			const visualHeight = Math.max(
				0,
				Number( global.visualViewport?.height ) ||
					Number( global.innerHeight ) ||
					rect.bottom
			);
			const safeBottom = Math.max(
				MIN_SAFE_HEIGHT,
				visualHeight - DOCK_SAFE_INSET
			);
			const overlapsDockBand =
				rect.top + containerHeight > safeBottom;
			const availableHeight = Math.max(
				MIN_SAFE_HEIGHT,
				Math.floor( safeBottom - Math.max( 0, rect.top ) )
			);
			const height = overlapsDockBand
				? Math.min( containerHeight, availableHeight )
				: containerHeight;

			host.style.height = `${ Math.max(
				MIN_SAFE_HEIGHT,
				Math.floor( height )
			) }px`;
			host.dataset.openstationViewport =
				overlapsDockBand && height < containerHeight
					? 'dock-safe'
					: 'window';
			host.dataset.openstationSafeHeight = String(
				Math.max( MIN_SAFE_HEIGHT, Math.floor( height ) )
			);
		};

		syncHostHeight();
		if ( typeof global.ResizeObserver === 'function' ) {
			hostResizeObserver = new global.ResizeObserver( syncHostHeight );
			hostResizeObserver.observe( container );
		}
		global.addEventListener( 'resize', syncHostHeight );
		global.visualViewport?.addEventListener( 'resize', syncHostHeight );

		showMessage(
			mountPoint,
			'Loading Popup Siege',
			'Preparing Mira’s sky-log rescue.'
		);

		const scoreStatus = ( text, failed = false ) => {
			if ( disposed || ! controller ) {
				return;
			}
			const results = mountPoint.querySelector( '[data-screen="results"]' );
			if ( ! results ) {
				return;
			}
			let status = results.querySelector( '[data-openstation-score-status]' );
			if ( ! status ) {
				status = global.document.createElement( 'div' );
				status.className = 'openstation-score-status';
				status.dataset.openstationScoreStatus = 'saving';
				status.setAttribute( 'role', 'status' );
				status.setAttribute( 'aria-live', 'polite' );
				results.append( status );
			}
			status.replaceChildren();
			const copy = global.document.createElement( 'span' );
			copy.textContent = text;
			status.append( copy );
			status.dataset.openstationScoreStatus = failed ? 'failed' : 'ready';
			if ( failed ) {
				const retry = global.document.createElement( 'button' );
				retry.type = 'button';
				retry.textContent = 'Retry save';
				retry.addEventListener(
					'click',
					() => submitPayload( payload ),
					{ once: true }
				);
				status.append( retry );
			}
		};

		const submitPayload = ( nextPayload ) => {
			if (
				disposed ||
				submitting ||
				! nextPayload ||
				typeof ctx.submitScore !== 'function'
			) {
				return;
			}
			submitting = true;
			const generation = ++submissionGeneration;
			scoreStatus( 'Saving score…' );
			Promise.resolve( ctx.submitScore( nextPayload ) )
				.then( () => {
					if ( ! disposed && generation === submissionGeneration ) {
						scoreStatus( 'Score saved.' );
					}
				} )
				.catch( () => {
					if ( ! disposed && generation === submissionGeneration ) {
						submitting = false;
						scoreStatus( 'Score could not be saved.', true );
					}
				} );
		};

		const blockChallengeReplay = ( event ) => {
			if (
				ctx.challenge &&
				payload &&
				event.target instanceof global.Element &&
				event.target.closest( '[data-action="restart"]' )
			) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		};
		mountPoint.addEventListener( 'click', blockChallengeReplay, true );

		const syncRunState = ( state ) => {
			if ( disposed || ! controller ) {
				return;
			}
			if ( state.phase === 'results' ) {
				if ( ! payload ) {
					payload = buildPayload( global.PopupBreaker, state, ctx.challenge );
					if ( ctx.challenge ) {
						const replay = mountPoint.querySelector(
							'[data-action="restart"]'
						);
						if ( replay ) {
							replay.hidden = true;
						}
						const replayPitch = mountPoint.querySelector(
							'.siege-replay-pitch'
						);
						if ( replayPitch ) {
							replayPitch.hidden = true;
						}
						const challengeStatus = mountPoint.querySelector(
							'[data-openstation-challenge-outcome]'
						);
						if ( challengeStatus ) {
							const target = Math.max(
								0,
								Number( ctx.challenge.scoreToBeat ) || 0
							);
							challengeStatus.textContent =
								payload.score > target
									? `Challenge beaten by ${ payload.score - target } points.`
									: payload.score === target
										? 'Score tied. Challenges require a strictly higher score.'
										: `${ target - payload.score } points short of the challenge.`;
						}
					}
					submitPayload( payload );
				}
			} else if ( payload && ! ctx.challenge ) {
				payload = null;
				submitting = false;
				submissionGeneration += 1;
				mountPoint
					.querySelector( '[data-openstation-score-status]' )
					?.remove();
			}
		};

		const monitor = () => {
			if ( disposed || ! controller ) {
				return;
			}
			syncRunState( controller.getState() );
			monitorFrame = global.requestAnimationFrame( monitor );
		};

		const desktop = global.wp && global.wp.desktop;
		Promise.all( [
			loadRuntime( ctx.config || {} ),
			desktop && typeof desktop.loadModules === 'function'
				? desktop.loadModules( [ 'pixijs' ] )
				: Promise.reject(
					new Error( 'OpenStation’s PixiJS module is unavailable.' )
				),
			attachStyle( shadow, String( ctx.config.cssUrl || '' ) ),
		] )
			.then( ( [ game ] ) => {
				if ( disposed ) {
					return;
				}
				if ( ! global.PIXI ) {
					throw new Error( 'PixiJS did not initialize.' );
				}
				controller = game.mount( mountPoint, {
					PIXI: global.PIXI,
					close: ctx.close,
				} );
				const address = mountPoint.querySelector(
					'.siege-browser__address'
				);
				if ( address ) {
					address.textContent =
						'http://geocities.com/CapeCanaveral/Launchpad/404/definitely_not_aliens/';
				}
				if ( ctx.challenge ) {
					const challenge = global.document.createElement( 'aside' );
					challenge.className = 'siege-challenge';
					challenge.dataset.openstationChallenge = 'active';
					challenge.setAttribute( 'aria-label', 'Challenge target' );
					const challenger = String(
						ctx.challenge.challengerName || 'the challenger'
					);
					const target = Math.max(
						0,
						Number( ctx.challenge.scoreToBeat ) || 0
					);
					const label = global.document.createElement( 'strong' );
					const copy = global.document.createElement( 'span' );
					const outcome = global.document.createElement( 'em' );
					label.textContent = 'CHALLENGE';
					copy.textContent = `Beat ${ target.toLocaleString() } from ${ challenger }`;
					outcome.dataset.openstationChallengeOutcome = '';
					outcome.setAttribute( 'aria-live', 'polite' );
					challenge.append( label, copy, outcome );
					mountPoint
						.querySelector( '.siege-browser' )
						?.prepend( challenge );
				}
				if (
					desktop &&
					typeof desktop.onWindow === 'function' &&
					ctx.windowId
				) {
					const pauseForWindow = () => {
						if (
							! disposed &&
							controller &&
							controller.getState().phase === 'playing'
						) {
							controller.pause();
						}
					};
					unsubscribeWindow = desktop.onWindow( ctx.windowId, {
						blurred: pauseForWindow,
						minimized: pauseForWindow,
					} );
				}
				return controller.ready;
			} )
			.then( () => {
				if ( ! disposed && controller ) {
					if ( typeof controller.subscribe === 'function' ) {
						unsubscribeState = controller.subscribe( syncRunState );
						syncRunState( controller.getState() );
					} else {
						monitorFrame = global.requestAnimationFrame( monitor );
					}
				}
			} )
			.catch( ( error ) => {
				if ( ! disposed ) {
					showMessage(
						mountPoint,
						'Popup Siege could not start',
						error && error.message
							? error.message
							: 'Reload OpenStation and try again.',
						[
							{
								label: 'Try again',
								onClick: () => global.location.reload(),
							},
							{
								label: 'Close',
								onClick: () => ctx.close?.(),
							},
						]
					);
				}
			} );

		return () => {
			if ( disposed ) {
				return;
			}
			disposed = true;
			submissionGeneration += 1;
			if ( monitorFrame !== null ) {
				global.cancelAnimationFrame( monitorFrame );
				monitorFrame = null;
			}
			if ( typeof unsubscribeState === 'function' ) {
				unsubscribeState();
				unsubscribeState = null;
			}
			if ( typeof unsubscribeWindow === 'function' ) {
				unsubscribeWindow();
				unsubscribeWindow = null;
			}
			hostResizeObserver?.disconnect();
			hostResizeObserver = null;
			global.removeEventListener( 'resize', syncHostHeight );
			global.visualViewport?.removeEventListener(
				'resize',
				syncHostHeight
			);
			mountPoint.removeEventListener( 'click', blockChallengeReplay, true );
			if ( controller ) {
				controller.teardown();
				controller = null;
			}
			container.replaceChildren();
		};
	}

	global.desktopModeGames = global.desktopModeGames || {};
	global.desktopModeGames[ GAME_ID ] = Object.freeze( {
		id: GAME_ID,
		title: 'Popup Siege',
		description:
			'Save Mira’s 1999 sky log by steering a Breakout ball into invasive popup X targets.',
		icon: 'dashicons-shield-alt',
		scoreColumns: Object.freeze( [
			Object.freeze( { key: 'score', label: 'Score', type: 'number' } ),
			Object.freeze( { key: 'time', label: 'Time', type: 'time' } ),
			Object.freeze( { key: 'restored', label: 'Restored', type: 'number' } ),
			Object.freeze( {
				key: 'popups_closed',
				label: 'Popups',
				type: 'number',
			} ),
			Object.freeze( { key: 'result', label: 'Result', type: 'text' } ),
		] ),
		window: Object.freeze( {
			width: 900,
			height: 620,
			minWidth: 520,
			minHeight: 480,
		} ),
		render,
	} );
} )( typeof globalThis !== 'undefined' ? globalThis : this );
