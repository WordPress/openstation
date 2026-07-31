( function ( global, factory ) {
	'use strict';

	const base =
		global && global.PopupBreaker
			? global.PopupBreaker
			: typeof module === 'object' && module.exports
				? require( './popup-breaker-0.5.1.js' )
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
		throw new Error( 'Popup Siege 0.5.1 is required.' );
	}

	const ASSET_VERSION = '0.6.0';
	const LEVELS = Object.freeze( [
		Object.freeze( {
			number: 1,
			id: 'download-trap',
			label: 'DOWNLOAD TRAP',
			objective: 'Close the first red X.',
		} ),
		Object.freeze( {
			number: 2,
			id: 'toolbar-swarm',
			label: 'TOOLBAR SWARM',
			objective: 'Close two more red X targets.',
		} ),
		Object.freeze( {
			number: 3,
			id: 'malware-boss',
			label: 'MALWARE BOSS',
			objective: 'Track and close the moving red X.',
		} ),
		Object.freeze( {
			number: 4,
			id: 'archive-sweep',
			label: 'ARCHIVE SWEEP',
			objective: 'Clear the corruption that remains.',
		} ),
	] );

	function levelForState( state = {} ) {
		const closes = Math.max( 0, Number( state.popupCloses ) || 0 );
		if ( closes >= 4 ) {
			return LEVELS[ 3 ];
		}
		if ( closes >= 3 ) {
			return LEVELS[ 2 ];
		}
		if ( closes >= 1 ) {
			return LEVELS[ 1 ];
		}
		return LEVELS[ 0 ];
	}

	function replayTip( state = {} ) {
		if ( state.result === 'rescued' ) {
			return 'Run it back: finish faster, or protect every life for the full rescue bonus.';
		}
		const level = levelForState( state );
		if ( level.number === 1 ) {
			return 'Meet the red X with the ball. The popup body is ghosted, so bank through it.';
		}
		if ( level.number === 2 ) {
			return 'Ride each cache burst. Multiball is your quickest path through the toolbar swarm.';
		}
		if ( level.number === 3 ) {
			return 'Track the boss X instead of chasing its window. The close target is the only solid part.';
		}
		return 'All four X targets are gone. One cleaner sweep can finish the archive.';
	}

	function enhanceProgression( container, controller ) {
		const root = container.querySelector( '.siege-game' );
		if ( ! root ) {
			return () => {};
		}
		const document = container.ownerDocument;
		const window = document.defaultView || global;
		const rail = root.querySelector( '.siege-browser__rail' );
		const status = root.querySelector( '[data-role="status"]' );
		const overlay = root.querySelector( '.siege-overlay' );
		const resultsCard = root.querySelector( '.siege-card--results' );
		const resultMetrics = resultsCard?.querySelector( '.siege-results' );
		const resultCopy = resultsCard?.querySelector(
			'[data-role="result-copy"]'
		);
		const replayButton = resultsCard?.querySelector(
			'[data-action="restart"]'
		);
		const closeButton = resultsCard?.querySelector(
			'[data-action="close"]'
		);
		let frame = null;
		let toastTimer = null;
		let disposed = false;
		let lastLevel = 0;
		let lastPhase = '';

		const levelBadge = document.createElement( 'span' );
		levelBadge.className = 'siege-level-badge';
		levelBadge.dataset.role = 'level-badge';

		if ( rail && status ) {
			rail.insertBefore( levelBadge, status );
		}

		const toast = document.createElement( 'div' );
		toast.className = 'siege-level-toast';
		toast.dataset.role = 'level-toast';
		toast.setAttribute( 'aria-hidden', 'true' );
		toast.hidden = true;
		toast.innerHTML = `
			<small data-role="level-toast-number"></small>
			<strong data-role="level-toast-label"></strong>
			<span data-role="level-toast-objective"></span>
		`;
		overlay?.append( toast );

		const journey = document.createElement( 'ol' );
		journey.className = 'siege-level-journey';
		journey.setAttribute( 'aria-label', 'Run progress' );
		for ( const level of LEVELS ) {
			const item = document.createElement( 'li' );
			item.dataset.level = String( level.number );
			const number = document.createElement( 'span' );
			const label = document.createElement( 'strong' );
			const state = document.createElement( 'em' );
			number.textContent = `L${ level.number }`;
			label.textContent = level.label;
			state.dataset.role = 'level-result';
			item.append( number, label, state );
			journey.append( item );
		}
		resultMetrics?.before( journey );

		const replayPitch = document.createElement( 'div' );
		replayPitch.className = 'siege-replay-pitch';
		const replayHeading = document.createElement( 'strong' );
		const replayCopy = document.createElement( 'span' );
		replayHeading.textContent = 'YOUR NEXT RUN';
		replayCopy.dataset.role = 'replay-tip';
		replayPitch.append( replayHeading, replayCopy );
		resultCopy?.after( replayPitch );

		if ( replayButton ) {
			replayButton.textContent = 'RUN IT BACK';
		}
		if ( closeButton ) {
			closeButton.textContent = 'BACK TO DESKTOP';
		}

		function hideToast() {
			toast.dataset.visible = 'false';
			toast.hidden = true;
			toastTimer = null;
		}

		function showLevel( level ) {
			if ( toastTimer !== null ) {
				window.clearTimeout( toastTimer );
			}
			toast.querySelector( '[data-role="level-toast-number"]' ).textContent =
				`LEVEL ${ level.number } OF ${ LEVELS.length }`;
			toast.querySelector( '[data-role="level-toast-label"]' ).textContent =
				level.label;
			toast.querySelector(
				'[data-role="level-toast-objective"]'
			).textContent = level.objective;
			toast.hidden = false;
			toast.dataset.visible = 'true';
			toastTimer = window.setTimeout( hideToast, 1750 );
		}

		function sync() {
			if ( disposed ) {
				return;
			}
			const state = controller.getState();
			const level = levelForState( state );
			const rescued =
				state.phase === 'results' && state.result === 'rescued';

			root.dataset.level = String( level.number );
			root.dataset.totalLevels = String( LEVELS.length );
			levelBadge.textContent = `L${ level.number}/${ LEVELS.length } · ${ level.label }`;
			levelBadge.setAttribute(
				'aria-label',
				`Level ${ level.number } of ${ LEVELS.length }: ${ level.label }`
			);

			for ( const item of journey.children ) {
				const number = Number( item.dataset.level );
				const complete = rescued || number < level.number;
				const current = ! rescued && number === level.number;
				item.dataset.state = complete
					? 'complete'
					: current
						? 'current'
						: 'locked';
				const stateLabel = item.querySelector(
					'[data-role="level-result"]'
				);
				stateLabel.textContent = complete
					? '✓ CLEAR'
					: current
						? '• REACHED'
						: '— LOCKED';
				item.setAttribute(
					'aria-label',
					`Level ${ number }: ${
						LEVELS[ number - 1 ].label
					}, ${ complete ? 'cleared' : current ? 'reached' : 'not reached' }`
				);
				if ( current ) {
					item.setAttribute( 'aria-current', 'step' );
				} else {
					item.removeAttribute( 'aria-current' );
				}
			}

			if ( state.phase === 'results' ) {
				replayCopy.textContent = replayTip( state );
			}

			if (
				state.phase === 'playing' &&
				(
					lastPhase !== 'playing' ||
					level.number !== lastLevel
				)
			) {
				showLevel( level );
			}

			lastLevel = level.number;
			lastPhase = state.phase;
			frame = window.requestAnimationFrame( sync );
		}

		function onReplay( event ) {
			const button = event.target.closest( '[data-action="restart"]' );
			if (
				! button ||
				! root.contains( button ) ||
				button.hidden ||
				button.disabled ||
				controller.getState().phase !== 'results'
			) {
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			controller.restart();
			controller.start();
		}

		root.addEventListener( 'click', onReplay, true );
		sync();

		return () => {
			if ( disposed ) {
				return;
			}
			disposed = true;
			if ( frame !== null ) {
				window.cancelAnimationFrame( frame );
				frame = null;
			}
			if ( toastTimer !== null ) {
				window.clearTimeout( toastTimer );
				toastTimer = null;
			}
			root.removeEventListener( 'click', onReplay, true );
			levelBadge.remove();
			toast.remove();
			journey.remove();
			replayPitch.remove();
		};
	}

	function mount( container, options = {} ) {
		const controller = base.mount( container, options );
		const root = container.querySelector( '.siege-game' );
		const disposeProgression = enhanceProgression( container, controller );

		if ( root ) {
			root.classList.add( 'siege-game--level-system-060' );
			root.dataset.buildVersion = ASSET_VERSION;
			root.dataset.prototype = 'popup-siege-v0-6-0';
			root.dataset.uiSystem = 'popup-siege-0.6.0';
			root.dataset.replayFlow = 'one-click';
		}

		let disposed = false;

		return Object.freeze( {
			...controller,
			teardown() {
				if ( disposed ) {
					return;
				}
				disposed = true;
				disposeProgression();
				if ( root ) {
					root.classList.remove( 'siege-game--level-system-060' );
					root.dataset.buildVersion = '0.5.1';
					root.dataset.prototype = 'popup-siege-v0-5-1';
					root.dataset.uiSystem = 'popup-siege-0.5.1';
					delete root.dataset.level;
					delete root.dataset.totalLevels;
					delete root.dataset.replayFlow;
				}
				controller.teardown();
			},
		} );
	}

	return Object.freeze( {
		...base,
		ASSET_VERSION,
		LEVELS,
		levelForState,
		replayTip,
		mount,
	} );
} );
