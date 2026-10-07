import { applyFilters, doAction, HOOKS } from '../hooks';
import { workAreaRectOf } from '../work-area';
import type { Window } from '../window';
import {
	isValidGrid,
	pickGridDimensions,
	shareRowByMinWidth,
	splitRowByMinWidth,
} from './geometry';
import type { WindowManager } from './index';

export function cascade( mgr: WindowManager ): void {
	const eligible = mgr._stack.filter(
		( w ) => w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return;
	}

	doAction( HOOKS.ARRANGE_CASCADE_STARTING, {
		windowCount: eligible.length,
	} );

	for ( const w of eligible ) {
		if ( w.state === 'minimized' ) {
			w.restore();
		}
		if ( w.state === 'fullscreen' ) {
			w.toggleFullscreen();
		}
		if ( w.state === 'maximized' ) {
			w.toggleMaximize();
		}
	}

	const rect = workAreaRectOf( mgr._desktop );
	const padding = 30;
	const offset = 30;
	const targetWidth = Math.min( Math.round( rect.width * 0.7 ), 1100 );
	const targetHeight = Math.min( Math.round( rect.height * 0.75 ), 750 );

	const maxStepsX = Math.max(
		1,
		Math.floor( ( rect.width - targetWidth - padding ) / offset ),
	);
	const maxStepsY = Math.max(
		1,
		Math.floor( ( rect.height - targetHeight - padding ) / offset ),
	);
	const maxSteps = Math.min( maxStepsX, maxStepsY );

	eligible.forEach( ( w, i ) => {
		const step = i % Math.max( 1, maxSteps );

		w._gridSpan = null;
		w.element.style.left = `${ rect.x + padding + step * offset }px`;
		w.element.style.top = `${ rect.y + padding + step * offset }px`;
		w.element.style.width = `${ targetWidth }px`;
		w.element.style.height = `${ targetHeight }px`;
	} );

	const focused = mgr.getFocused();
	if ( focused ) {
		mgr.focus( focused );
	}

	document.dispatchEvent(
		new CustomEvent( 'os-window-changed', {
			detail: { reason: 'cascade' },
		} ),
	);

	doAction( HOOKS.ARRANGE_CASCADE_APPLIED, {
		windowCount: eligible.length,
	} );
}

export function tile( mgr: WindowManager ): void {
	const eligible = mgr._stack.filter(
		( w ) => w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return;
	}

	for ( const w of eligible ) {
		if ( w.state === 'minimized' ) {
			w.restore();
		}
		if ( w.state === 'fullscreen' ) {
			w.toggleFullscreen();
		}
		if ( w.state === 'maximized' ) {
			w.toggleMaximize();
		}
	}

	const rect = workAreaRectOf( mgr._desktop );
	const auto = pickGridDimensions(
		eligible.length,
		rect.width,
		rect.height,
	);

	const filtered = applyFilters<
		{ cols: number; rows: number },
		[ { windowCount: number; areaWidth: number; areaHeight: number } ]
	>(
		HOOKS.ARRANGE_TILE_DIMENSIONS,
		auto,
		{
			windowCount: eligible.length,
			areaWidth: rect.width,
			areaHeight: rect.height,
		},
	);
	const { cols, rows } = isValidGrid( filtered, eligible.length )
		? { cols: Math.floor( filtered.cols ), rows: Math.floor( filtered.rows ) }
		: auto;

	doAction( HOOKS.ARRANGE_TILE_STARTING, {
		windowCount: eligible.length,
		cols,
		rows,
	} );

	const padding = 16;
	const gap = 12;
	const cellHeight = Math.floor(
		( rect.height - padding * 2 - gap * ( rows - 1 ) ) / rows,
	);

	for ( let row = 0; row * cols < eligible.length; row++ ) {
		const members = eligible.slice( row * cols, row * cols + cols );
		const mins = Array.from(
			{ length: cols },
			( _, col ) => members[ col ]?.config.minWidth || 0,
		);
		const spans = shareRowByMinWidth( rect.width - padding * 2, gap, mins );
		members.forEach( ( w, col ) => {
			w._gridSpan = null;
			w.element.style.left = `${ rect.x + padding + spans[ col ].x }px`;
			w.element.style.top = `${ rect.y + padding + row * ( cellHeight + gap ) }px`;
			w.element.style.width = `${ spans[ col ].width }px`;
			w.element.style.height = `${ cellHeight }px`;
		} );
	}

	const focused = mgr.getFocused();
	if ( focused ) {
		mgr.focus( focused );
	}

	document.dispatchEvent(
		new CustomEvent( 'os-window-changed', {
			detail: { reason: 'tile' },
		} ),
	);

	doAction( HOOKS.ARRANGE_TILE_APPLIED, {
		windowCount: eligible.length,
		cols,
		rows,
	} );
}

function prepareForArrange( mgr: WindowManager ): Window[] {
	const eligible = mgr._stack.filter(
		( w ) => w.config.desktopId === mgr._activeDesktopId,
	);
	if ( eligible.length === 0 ) {
		return [];
	}
	for ( const w of eligible ) {
		if ( w.state === 'minimized' ) {
			w.restore();
		}
		if ( w.state === 'fullscreen' ) {
			w.toggleFullscreen();
		}
		if ( w.state === 'maximized' ) {
			w.toggleMaximize();
		}

		w._gridSpan = null;
	}
	return eligible;
}

function settleArrange( mgr: WindowManager, reason: string ): void {
	const focused = mgr.getFocused();
	if ( focused ) {
		mgr.focus( focused );
	}
	document.dispatchEvent(
		new CustomEvent( 'os-window-changed', { detail: { reason } } ),
	);
}

const MAX_COLUMNS = 4;

export function columns( mgr: WindowManager ): void {
	const eligible = prepareForArrange( mgr );
	if ( eligible.length === 0 ) {
		return;
	}
	if ( eligible.length > MAX_COLUMNS ) {
		tile( mgr );
		return;
	}

	const cols = eligible.length;
	doAction( HOOKS.ARRANGE_COLUMNS_STARTING, {
		windowCount: eligible.length,
		cols,
	} );

	const rect = workAreaRectOf( mgr._desktop );
	const padding = 16;
	const gap = 12;
	const colHeight = Math.floor( rect.height - padding * 2 );

	const spans = shareRowByMinWidth(
		rect.width - padding * 2,
		gap,
		eligible.map( ( w ) => w.config.minWidth || 0 ),
	);

	eligible.forEach( ( w, i ) => {
		w.element.style.left = `${ rect.x + padding + spans[ i ].x }px`;
		w.element.style.top = `${ rect.y + padding }px`;
		w.element.style.width = `${ spans[ i ].width }px`;
		w.element.style.height = `${ colHeight }px`;
	} );

	settleArrange( mgr, 'columns' );
	doAction( HOOKS.ARRANGE_COLUMNS_APPLIED, {
		windowCount: eligible.length,
		cols,
	} );
}

const FOCUS_SPLIT = 0.64;

export function focus( mgr: WindowManager ): void {
	const eligible = prepareForArrange( mgr );
	if ( eligible.length === 0 ) {
		return;
	}

	const rect = workAreaRectOf( mgr._desktop );
	const filtered = applyFilters<
		number,
		[ { windowCount: number; areaWidth: number; areaHeight: number } ]
	>( HOOKS.ARRANGE_FOCUS_SPLIT, FOCUS_SPLIT, {
		windowCount: eligible.length,
		areaWidth: rect.width,
		areaHeight: rect.height,
	} );

	const split =
		Number.isFinite( filtered ) && filtered >= 0.3 && filtered <= 0.9
			? filtered
			: FOCUS_SPLIT;

	doAction( HOOKS.ARRANGE_FOCUS_STARTING, {
		windowCount: eligible.length,
		split,
	} );

	const padding = 16;
	const gap = 12;
	const areaWidth = rect.width - padding * 2;
	const areaHeight = rect.height - padding * 2;

	const current = mgr.getFocused();
	const leadIndex =
		current && eligible.includes( current ) ? eligible.indexOf( current ) : 0;
	const lead = eligible[ leadIndex ];
	const rest = eligible.filter( ( _, i ) => i !== leadIndex );

	const row = splitRowByMinWidth(
		areaWidth,
		gap,
		Math.floor( areaWidth * split ),
		lead.config.minWidth || 0,
		rest.reduce( ( max, w ) => Math.max( max, w.config.minWidth || 0 ), 0 ),
	);
	const leadWidth = rest.length === 0 ? areaWidth : row.first.width;
	lead.element.style.left = `${ rect.x + padding }px`;
	lead.element.style.top = `${ rect.y + padding }px`;
	lead.element.style.width = `${ leadWidth }px`;
	lead.element.style.height = `${ areaHeight }px`;

	if ( rest.length > 0 ) {
		const stackX = rect.x + padding + row.second.x;
		const stackWidth = row.second.width;
		const stackHeight = Math.floor(
			( areaHeight - gap * ( rest.length - 1 ) ) / rest.length,
		);
		rest.forEach( ( w, i ) => {
			w.element.style.left = `${ stackX }px`;
			w.element.style.top = `${ rect.y + padding + i * ( stackHeight + gap ) }px`;
			w.element.style.width = `${ stackWidth }px`;
			w.element.style.height = `${ stackHeight }px`;
		} );
	}

	mgr.focus( lead );
	document.dispatchEvent(
		new CustomEvent( 'os-window-changed', { detail: { reason: 'focus' } } ),
	);

	doAction( HOOKS.ARRANGE_FOCUS_APPLIED, {
		windowCount: eligible.length,
		split,
	} );
}
