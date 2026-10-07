export interface VisibilityAwarePoller {

	stop: () => void;
}

export function startVisibilityAwarePoller(
	refresh: () => void | Promise< void >,
	intervalMs: number,
): VisibilityAwarePoller {
	let intervalId: ReturnType< typeof setInterval > | null = null;
	let lastRunMs = Date.now();

	const run = (): void => {
		lastRunMs = Date.now();
		void refresh();
	};

	const startInterval = (): void => {
		if ( intervalId === null ) {
			intervalId = setInterval( run, intervalMs );
		}
	};

	const stopInterval = (): void => {
		if ( intervalId !== null ) {
			clearInterval( intervalId );
			intervalId = null;
		}
	};

	const onVisibilityChange = (): void => {
		if ( document.hidden ) {
			stopInterval();
			return;
		}
		if ( Date.now() - lastRunMs >= intervalMs ) {
			run();
		}
		startInterval();
	};

	document.addEventListener( 'visibilitychange', onVisibilityChange );
	if ( ! document.hidden ) {
		startInterval();
	}

	return {
		stop(): void {
			stopInterval();
			document.removeEventListener( 'visibilitychange', onVisibilityChange );
		},
	};
}
