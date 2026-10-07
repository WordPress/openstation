import { applyFilters, HOOKS } from '../hooks';
import { getStore } from './registry';

export function resolveThemedIcon( slot: string ): string | null {
	const state = getStore().state;

	if ( state.activeIcons === null ) {
		return null;
	}
	if ( ! slot ) {
		return null;
	}
	const raw = state.activeIcons[ slot ];
	if ( typeof raw !== 'string' || raw === '' ) {
		return null;
	}
	const filtered = applyFilters< string, [ { slot: string; themeId: string } ] >(
		HOOKS.DESKTOP_THEME_ICON,
		raw,
		{ slot, themeId: state.activeId ?? '' },
	);
	return typeof filtered === 'string' && filtered !== '' ? filtered : null;
}

export function resolveThemedIconColor( slot: string ): string | null {
	const state = getStore().state;
	if ( state.activeIconColors === null || ! slot ) {
		return null;
	}
	const raw = state.activeIconColors[ slot ];
	if ( typeof raw !== 'string' || raw === '' ) {
		return null;
	}
	const filtered = applyFilters< string, [ { slot: string; themeId: string } ] >(
		HOOKS.DESKTOP_THEME_ICON_COLOR,
		raw,
		{ slot, themeId: state.activeId ?? '' },
	);
	return typeof filtered === 'string' && filtered !== ''
		? sanitizeIconColor( filtered )
		: null;
}

function sanitizeIconColor( value: string ): string | null {
	const trimmed = value.trim();
	if ( trimmed === '' || trimmed.length > 64 ) {
		return null;
	}
	if ( /[;{}<>"'\\]/.test( trimmed ) ) {
		return null;
	}

	let depth = 0;
	for ( const char of trimmed ) {
		if ( char === '(' ) {
			depth += 1;
		} else if ( char === ')' ) {
			depth -= 1;
			if ( depth < 0 ) {
				return null;
			}
		}
	}
	return depth === 0 ? trimmed : null;
}
