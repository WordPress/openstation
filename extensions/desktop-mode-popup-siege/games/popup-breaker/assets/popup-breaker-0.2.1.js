( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.2.0.js' )
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

	if ( ! base ) {
		throw new Error( 'Popup Siege 0.2.0 is required.' );
	}

	const ASSET_VERSION = '0.2.1';
	const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
	const IMPORTANT_EVENTS = new Set( [
		'miss',
		'multiball-end',
		'overrun',
		'pause',
		'rescued',
		'resume',
		'serve',
	] );

	function createSvgNode( document, name, className ) {
		const node = document.createElementNS( SVG_NAMESPACE, name );
		if ( className ) {
			node.setAttribute( 'class', className );
		}
		return node;
	}

	function setAttributes( node, attributes ) {
		for ( const [ name, value ] of Object.entries( attributes ) ) {
			node.setAttribute( name, String( value ) );
		}
	}

	function createTargetGroup( document, popup ) {
		const group = createSvgNode( document, 'g', 'siege-target' );
		const ghost = createSvgNode(
			document,
			'rect',
			'siege-target__ghost'
		);
		const halo = createSvgNode(
			document,
			'rect',
			'siege-target__halo'
		);
		const corner = createSvgNode(
			document,
			'path',
			'siege-target__corner'
		);
		group.dataset.popupId = popup.id;
		group.append( ghost, halo, corner );
		return group;
	}

	function positionTargetGroup( group, popup ) {
		const close = base.popupCloseRect( popup );
		const ghost = group.querySelector( '.siege-target__ghost' );
		const halo = group.querySelector( '.siege-target__halo' );
		const corner = group.querySelector( '.siege-target__corner' );
		const haloGap = 5;
		const cornerGap = 9;
		const left = close.x - cornerGap;
		const top = close.y - cornerGap;
		const right = close.x + close.w + cornerGap;
		const bottom = close.y + close.h + cornerGap;
		const arm = 9;

		group.dataset.solid = popup.solid ? 'true' : 'false';
		setAttributes( ghost, {
			x: popup.x + 1,
			y: popup.y + 1,
			width: Math.max( 0, popup.w - 2 ),
			height: Math.max( 0, popup.h - 2 ),
			rx: 2,
		} );
		setAttributes( halo, {
			x: close.x - haloGap,
			y: close.y - haloGap,
			width: close.w + haloGap * 2,
			height: close.h + haloGap * 2,
			rx: 3,
		} );
		corner.setAttribute(
			'd',
			[
				`M ${ left + arm } ${ top } H ${ left } V ${ top + arm }`,
				`M ${ right - arm } ${ top } H ${ right } V ${ top + arm }`,
				`M ${ left } ${ bottom - arm } V ${ bottom } H ${ left + arm }`,
				`M ${ right } ${ bottom - arm } V ${ bottom } H ${ right - arm }`,
			].join( ' ' )
		);
	}

	function createPolishedRenderer( factory, host, options = {} ) {
		return Promise.resolve( factory( host, options ) ).then( ( renderer ) => {
			const document = host.ownerDocument;
			const overlay = createSvgNode(
				document,
				'svg',
				'siege-target-overlay'
			);
			const targets = new Map();
			overlay.setAttribute( 'viewBox', `0 0 ${ base.WIDTH } ${ base.HEIGHT }` );
			overlay.setAttribute( 'preserveAspectRatio', 'none' );
			overlay.setAttribute( 'aria-hidden', 'true' );
			host.append( overlay );

			function syncTargets( state ) {
				const active = new Set();
				for ( const popup of state.popups ) {
					active.add( popup.id );
					let group = targets.get( popup.id );
					if ( ! group ) {
						group = createTargetGroup( document, popup );
						targets.set( popup.id, group );
						overlay.append( group );
					}
					positionTargetGroup( group, popup );
				}
				for ( const [ id, group ] of targets ) {
					if ( active.has( id ) ) {
						continue;
					}
					group.remove();
					targets.delete( id );
				}
			}

			return Object.freeze( {
				canvas: renderer.canvas,
				mapPointer: renderer.mapPointer,
				render( state, previousState, alpha, frameDelta ) {
					renderer.render(
						state,
						previousState,
						alpha,
						frameDelta
					);
					syncTargets( state );
				},
				destroy() {
					overlay.remove();
					renderer.destroy();
				},
			} );
		} );
	}

	function enhanceInterface( container, controller, options = {} ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return () => {};
		}
		const document = container.ownerDocument;
		const window = document.defaultView || global;
		const browser = root.querySelector( '.siege-browser' );
		const footer = root.querySelector( '.siege-footer' );
		const help = root.querySelector( '#siege-help' );
		const status = root.querySelector( '[data-role="status"]' );
		const pauseButton = root.querySelector( '[data-action="pause"]' );
		const hud = root.querySelector( '.siege-hud' );
		const menuCopy = root.querySelector(
			'.siege-card--menu > p:not(.siege-card__eyebrow)'
		);
		let frame = 0;
		let disposed = false;
		let seenEventId = 0;
		let heldMessage = '';
		let heldUntil = 0;
		let seenWaveIndex = 0;

		root.dataset.assetVersion = ASSET_VERSION;
		root.dataset.prototype = 'popup-siege-v0-2-1';

		if ( menuCopy ) {
			menuCopy.innerHTML =
				'Keep the ball alive. Popup windows are ghosted—only the flashing <b>red X</b> is solid. Close one to unleash multiball.';
		}

		const rail = document.createElement( 'div' );
		rail.className = 'siege-browser__rail';
		const cache = document.createElement( 'div' );
		cache.className = 'siege-cache';
		cache.setAttribute( 'aria-label', 'Cache burst inactive' );
		cache.innerHTML = `
			<span>CACHE</span>
			<i aria-hidden="true"><b data-role="cache-fill"></b></i>
			<strong data-role="cache-status">IDLE</strong>
		`;
		if ( help ) {
			help.className = 'siege-help';
		}
		if ( status ) {
			status.className = 'siege-status';
		}
		if ( browser && status && help ) {
			rail.append( help, status, cache );
			browser.append( rail );
			if ( footer ) {
				footer.remove();
			}
		}

		const cacheFill = cache.querySelector( '[data-role="cache-fill"]' );
		const cacheStatus = cache.querySelector( '[data-role="cache-status"]' );

		function onClickCapture( event ) {
			const button = event.target.closest( '[data-action="pause"]' );
			if (
				! button ||
				! root.contains( button ) ||
				controller.getState().phase !== 'paused'
			) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			controller.resume();
		}

		function sync() {
			if ( disposed ) {
				return;
			}
			const state = controller.getState();
			const now =
				typeof window.performance?.now === 'function'
					? window.performance.now()
					: Date.now();
			const cacheLevel =
				state.balls.length > 1
					? Math.max(
							0,
							Math.min(
								1,
								state.multiballTimer / base.MULTIBALL_SECONDS
							)
						)
					: 0;

			root.dataset.assetVersion = ASSET_VERSION;
			root.style.setProperty( '--siege-cache-level', String( cacheLevel ) );

			if ( pauseButton ) {
				const canPause =
					state.phase === 'playing' || state.phase === 'paused';
				pauseButton.hidden = ! canPause;
				pauseButton.textContent =
					state.phase === 'paused' ? 'Resume' : 'Pause';
				pauseButton.setAttribute(
					'aria-label',
					state.phase === 'paused' ? 'Resume game' : 'Pause game'
				);
			}

			if ( cacheFill && cacheStatus ) {
				cacheFill.style.transform = `scaleX(${ cacheLevel })`;
				cacheStatus.textContent =
					cacheLevel > 0
						? `${ state.multiballTimer.toFixed( 1 ) }s`
						: 'IDLE';
				cache.dataset.active = cacheLevel > 0 ? 'true' : 'false';
				cache.setAttribute(
					'aria-label',
					cacheLevel > 0
						? `Cache burst active for ${ state.multiballTimer.toFixed( 1 ) } seconds`
						: 'Cache burst inactive'
				);
			}

			if ( hud ) {
				hud.setAttribute(
					'aria-label',
					[
						`Score ${ Math.round( state.score ) }`,
						`${ Math.ceil( state.timeLeft ) } seconds left`,
						`${ state.lives } ${ state.lives === 1 ? 'life' : 'lives' }`,
						`${ state.popupCloses } of 4 popups closed`,
					].join( ', ' )
				);
			}

			if ( state.waveIndex > seenWaveIndex ) {
				heldMessage =
					state.waveIndex === base.WAVE_SCHEDULE.length
						? 'Boss window ghosted. Track the flashing red X.'
						: 'Popup window ghosted. Only the flashing red X is solid.';
				heldUntil = now + 2400;
				seenWaveIndex = state.waveIndex;
			}

			if ( state.eventId !== seenEventId ) {
				if ( state.lastEvent?.type === 'popup-close' ) {
					heldMessage = state.message;
					heldUntil = now + 1600;
				} else if (
					state.lastEvent?.type !== 'wave' &&
					IMPORTANT_EVENTS.has( state.lastEvent?.type )
				) {
					heldMessage = '';
					heldUntil = 0;
				}
				seenEventId = state.eventId;
			}

			if ( status ) {
				if ( state.phase === 'menu' ) {
					status.textContent =
						'MOVE: POINTER / TOUCH / A D / ARROWS · TARGET: RED X ONLY';
				} else if (
					heldMessage &&
					now < heldUntil &&
					( state.lastEvent?.type === 'brick' ||
						state.lastEvent?.type === 'paddle' ||
						state.lastEvent?.type === 'popup-close' ||
						state.lastEvent?.type === 'wave' )
				) {
					status.textContent = heldMessage;
				} else {
					status.textContent = state.message;
				}
			}

			frame = window.requestAnimationFrame( sync );
		}

		root.addEventListener( 'click', onClickCapture, true );
		frame = window.requestAnimationFrame( sync );

		return () => {
			if ( disposed ) {
				return;
			}
			disposed = true;
			window.cancelAnimationFrame( frame );
			root.removeEventListener( 'click', onClickCapture, true );
		};
	}

	function mount( container, options = {} ) {
		const rendererFactory =
			typeof options.rendererFactory === 'function'
				? options.rendererFactory
				: base.createPixiRenderer;
		const controller = base.mount( container, {
			...options,
			rendererFactory( host, rendererOptions ) {
				return createPolishedRenderer(
					rendererFactory,
					host,
					rendererOptions
				);
			},
		} );
		const removeEnhancements = enhanceInterface(
			container,
			controller,
			options
		);
		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				removeEnhancements();
				controller.teardown();
			},
		} );
	}

	return Object.freeze( {
		...base,
		ASSET_VERSION,
		createPolishedRenderer,
		mount,
	} );
} );
