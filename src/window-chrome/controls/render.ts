import { applyFilters, doAction, HOOKS } from '../../hooks';
import { controlsForWindow, type WindowControlDef } from './registry';
import { paintTitleBarButtonIcon } from '../../title-bar-buttons/paint-icon';
import { paintThemedControlIcon } from './paint-themed-icon';

import type { Window as DesktopWindow } from '../../window';
import type { WindowControlsConfig } from '../../types';

export function resolveWindowControls(
	win: DesktopWindow,
	override?: WindowControlsConfig,
): {
	left: WindowControlDef[];
	right: WindowControlDef[];
	controls: WindowControlDef[];
	placement: 'left' | 'right';
} {
	const buckets = controlsForWindow( win );
	const hide = new Set< string >( override?.hide ?? [] );

	let left = buckets.left.filter( ( c ) => ! hide.has( c.id ) );
	let right = buckets.right.filter( ( c ) => ! hide.has( c.id ) );
	let controls = buckets.controls.filter( ( c ) => ! hide.has( c.id ) );

	if ( override?.custom ) {
		for ( const def of override.custom ) {
			if ( hide.has( def.id ) ) {
				continue;
			}
			const adapted: WindowControlDef = {
				id: def.id,
				label: def.label,
				icon: def.icon,
				placement: def.placement ?? 'controls',
				order: def.order ?? 100,
				match: () => true,
				onClick: def.onClick
					? ( _: DesktopWindow, ev: MouseEvent ) => def.onClick!( ev )
					: undefined,
				render: def.render
					? ( host: HTMLElement ) => def.render!( host )
					: undefined,
			};
			if ( adapted.placement === 'left' ) {
				left.push( adapted );
			} else if ( adapted.placement === 'right' ) {
				right.push( adapted );
			} else {
				controls.push( adapted );
			}
		}

		left = sortByOrder( left );
		right = sortByOrder( right );
		controls = sortByOrder( controls );
	}

	if ( override?.order && override.order.length > 0 ) {
		controls = applyExplicitOrder( controls, override.order );
	}

	const placement = override?.placement ?? 'right';

	const ctx = { windowId: win.id, config: win.config };
	left = applyFilters< WindowControlDef[], [ typeof ctx & { placement: 'left' } ] >(
		HOOKS.WINDOW_CHROME_CONTROLS,
		left,
		{ ...ctx, placement: 'left' },
	);
	right = applyFilters< WindowControlDef[], [ typeof ctx & { placement: 'right' } ] >(
		HOOKS.WINDOW_CHROME_CONTROLS,
		right,
		{ ...ctx, placement: 'right' },
	);
	controls = applyFilters< WindowControlDef[], [ typeof ctx & { placement: 'controls' } ] >(
		HOOKS.WINDOW_CHROME_CONTROLS,
		controls,
		{ ...ctx, placement: 'controls' },
	);

	return { left, right, controls, placement };
}

function sortByOrder( list: WindowControlDef[] ): WindowControlDef[] {
	return [ ...list ].sort( ( a, b ) => {
		const oa = a.order ?? 100;
		const ob = b.order ?? 100;
		if ( oa !== ob ) {
			return oa - ob;
		}
		return a.id.localeCompare( b.id );
	} );
}

function applyExplicitOrder(
	list: WindowControlDef[],
	order: string[],
): WindowControlDef[] {
	const byId = new Map< string, WindowControlDef >();
	for ( const def of list ) {
		byId.set( def.id, def );
	}
	const out: WindowControlDef[] = [];
	const used = new Set< string >();
	for ( const id of order ) {
		const def = byId.get( id );
		if ( def && ! used.has( id ) ) {
			out.push( def );
			used.add( id );
		}
	}

	for ( const def of list ) {
		if ( ! used.has( def.id ) ) {
			out.push( def );
		}
	}
	return out;
}

function buildControlElement(
	def: WindowControlDef,
	win: DesktopWindow,
): { element: HTMLElement; teardown?: () => void } {
	const host = document.createElement( 'os-window-button' );

	host.setAttribute( 'aria-label', def.label || def.id );
	host.classList.add( 'os-window__btn' );

	const variant = legacyVariantFor( def.id );
	host.classList.add( `os-window__btn--${ variant }` );
	if ( def.id === 'core/close' ) {
		host.setAttribute( 'danger', '' );
	}

	if ( typeof def.render === 'function' ) {
		try {
			def.render( host, win );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'window-control-render',
				id: def.id,
				windowId: win.id,
				error: err,
			} );
			return { element: host };
		}
	} else {
		if ( ! paintThemedControlIcon( host, def.id ) ) {
			paintTitleBarButtonIcon( host, def.icon ?? '' );
		}
		if ( typeof def.onClick === 'function' ) {
			const handler = ( ev: Event ): void => {
				ev.stopPropagation();
				try {
					def.onClick!( win, ev as MouseEvent );
				} catch ( err ) {
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'window-control-onclick',
						id: def.id,
						windowId: win.id,
						error: err,
					} );
				}
			};

			host.addEventListener( 'os-button-activate', handler );
			return {
				element: host,
				teardown: () => {
					host.removeEventListener( 'os-button-activate', handler );
				},
			};
		}
	}

	return { element: host };
}

function legacyVariantFor( id: string ): string {
	if ( id.startsWith( 'core/' ) ) {
		return id.slice( 'core/'.length );
	}
	return id.replace( /\//g, '-' );
}

export function paintWindowControls(
	win: DesktopWindow,
	controlsHost: HTMLElement,
): () => void {
	const teardowns: Array< () => void > = [];

	while ( controlsHost.firstChild ) {
		controlsHost.removeChild( controlsHost.firstChild );
	}

	const resolved = resolveWindowControls(
		win,
		win.config.appearance?.controls,
	);

	controlsHost.classList.toggle(
		'os-window__controls--left',
		resolved.placement === 'left',
	);

	for ( const def of resolved.controls ) {
		const { element, teardown } = buildControlElement( def, win );
		controlsHost.appendChild( element );
		if ( teardown ) {
			teardowns.push( teardown );
		}
	}

	doAction( HOOKS.WINDOW_CHROME_APPLIED, {
		windowId: win.id,
		layer: 'controls',
	} );

	return () => {
		for ( const fn of teardowns ) {
			try {
				fn();
			} catch {

			}
		}
	};
}
