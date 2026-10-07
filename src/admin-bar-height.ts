export const ADMIN_BAR_HEIGHT_PROP = '--os-admin-bar-height';

export const ADMIN_BAR_ID = 'wpadminbar';

export interface AdminBarHeightDeps {

	bar?: HTMLElement | null;

	root?: HTMLElement;
}

export interface AdminBarHeightController {

	refresh(): void;

	destroy(): void;
}

export function measureAdminBarBottom( bar: Element ): number | null {
	const rect = bar.getBoundingClientRect();
	if ( rect.height <= 0 || rect.top < 0 ) {
		return null;
	}

	return Math.round( rect.bottom * 100 ) / 100;
}

export function installAdminBarHeight(
	deps: AdminBarHeightDeps = {},
): AdminBarHeightController {
	const bar = deps.bar === undefined ? document.getElementById( ADMIN_BAR_ID ) : deps.bar;
	const root = deps.root ?? document.documentElement;
	const noop: AdminBarHeightController = {
		refresh: () => undefined,
		destroy: () => undefined,
	};
	if ( ! bar ) {
		return noop;
	}

	let last: number | null | undefined;
	let destroyed = false;

	const measure = (): void => {
		if ( destroyed ) {
			return;
		}
		const next = measureAdminBarBottom( bar );
		if ( next === last ) {
			return;
		}
		last = next;
		if ( next === null ) {
			root.style.removeProperty( ADMIN_BAR_HEIGHT_PROP );
		} else {
			root.style.setProperty( ADMIN_BAR_HEIGHT_PROP, `${ next }px` );
		}
	};

	let resizeObserver: ResizeObserver | null = null;
	if ( typeof ResizeObserver !== 'undefined' ) {
		resizeObserver = new ResizeObserver( measure );

		resizeObserver.observe( bar, { box: 'border-box' } );
	}

	let bodyObserver: MutationObserver | null = null;
	if ( typeof MutationObserver !== 'undefined' && document.body ) {
		bodyObserver = new MutationObserver( measure );
		bodyObserver.observe( document.body, {
			attributes: true,
			attributeFilter: [ 'class' ],
		} );
	}

	window.addEventListener( 'resize', measure );

	measure();

	return {
		refresh: measure,
		destroy: () => {
			destroyed = true;
			resizeObserver?.disconnect();
			bodyObserver?.disconnect();
			window.removeEventListener( 'resize', measure );
			root.style.removeProperty( ADMIN_BAR_HEIGHT_PROP );
		},
	};
}
