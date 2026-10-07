import {
	getUnfocusEffect,
	listUnfocusEffects,
	subscribeUnfocusEffects,
	UNFOCUS_EFFECT_NONE,
} from './registry';
import type { UnfocusEffectDef } from './types';
import type { OsSettings } from '../settings';
import type { Window as DesktopWindow } from '../window';
import type { WindowManager } from '../window-manager';

const EFFECT_ATTR = 'data-desktop-unfocus-effect';

const EFFECT_CLASS_ATTR = 'data-desktop-unfocus-effect-class';

let _started = false;

function hostsCanvas( el: HTMLElement ): boolean {
	return el.querySelector( 'canvas' ) !== null;
}

function isSplitTile( win: DesktopWindow ): boolean {
	return win.state === 'snapped-left' || win.state === 'snapped-right';
}

export interface UnfocusEngineDeps {
	manager: WindowManager;
	osSettings: OsSettings;
}

export function startUnfocusEngine( { manager, osSettings }: UnfocusEngineDeps ): void {
	if ( _started ) {
		return;
	}
	_started = true;

	let currentId = osSettings.getOsSettingsSnapshot().unfocusEffect;

	const clear = ( el: HTMLElement, allEffects: UnfocusEffectDef[] ): void => {
		const storedClass = el.getAttribute( EFFECT_CLASS_ATTR );
		if ( storedClass ) {
			el.classList.remove( storedClass );
			el.removeAttribute( EFFECT_CLASS_ATTR );
		}

		const priorId = el.getAttribute( EFFECT_ATTR );
		if ( priorId ) {
			getUnfocusEffect( priorId )?.clear?.( el );
		}

		for ( const def of allEffects ) {
			if ( def.className ) {
				el.classList.remove( def.className );
			}
		}
		el.removeAttribute( EFFECT_ATTR );
	};

	const apply = ( el: HTMLElement, def: UnfocusEffectDef ): void => {
		if ( def.className ) {
			el.classList.add( def.className );
			el.setAttribute( EFFECT_CLASS_ATTR, def.className );
		}
		el.setAttribute( EFFECT_ATTR, def.id );
		def.apply?.( el );
	};

	const recompute = (): void => {
		const def =
			currentId === UNFOCUS_EFFECT_NONE
				? undefined
				: getUnfocusEffect( currentId );

		const allEffects = listUnfocusEffects();
		for ( const win of manager.getAll() ) {
			const el = win.element;
			if ( ! el ) {
				continue;
			}

			clear( el, allEffects );
			if ( ! def || win.isFocused() || win.state === 'minimized' ) {
				continue;
			}

			if ( isSplitTile( win ) ) {
				continue;
			}

			if ( hostsCanvas( el ) ) {
				continue;
			}
			apply( el, def );
		}
	};

	for ( const name of [
		'os-window-opened',
		'os-window-reopened',
		'os-window-closed',
		'os-window-focused',
		'os-window-blurred',
	] ) {
		document.addEventListener( name, () => recompute() );
	}

	document.addEventListener( 'os-window-changed', ( e: Event ) => {
		if ( ( e as CustomEvent< { reason?: string } > ).detail?.reason === 'state' ) {
			recompute();
		}
	} );

	osSettings.subscribeOsSettings( ( snapshot ) => {
		currentId = snapshot.unfocusEffect;
		recompute();
	} );

	subscribeUnfocusEffects( () => recompute() );

	recompute();
}
