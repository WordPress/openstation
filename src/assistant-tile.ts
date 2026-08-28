/**
 * The site assistant's dock tile, for rails that have no tray.
 *
 * The bottom dock carries the tray, and the tray carries the
 * assistant. A side-placed rail has no tray, so the assistant becomes
 * the first thing on the rail instead — and deliberately not drawn
 * like the menus below it, which are places in wp-admin where this is
 * a way to ask the site a question. `dock.css` gives it a band; the
 * exit gets the same treatment at the other end, for the same reason.
 */

import { ASSISTANT_TILE_ID } from './dock-shell-tiles';
import type { SystemDockItem } from './dock';
import { addAction, HOOKS } from './hooks';
import { __ } from './i18n';
import { buildChord } from './ui/chord';
import { OS_SITE_LOGO_ICON } from './ui/site-logo-icon';

/** Marks a tile as decorated, so a re-render cannot double it up. */
const DECORATED = 'os-dock__item--assistant';

/**
 * `navKind: 'core'` is what puts it AHEAD of Dashboard: the leading
 * zone is the core admin menus, and every other kind sorts after them.
 * A negative order then puts it first within that zone, since menu
 * items start at 0.
 */
export function getAssistantTileDef(): SystemDockItem {
	return {
		id: ASSISTANT_TILE_ID,
		title: __( 'Open site assistant' ),
		navKind: 'core',
		order: -1,
		icon: OS_SITE_LOGO_ICON,
		onOpen: () =>
			document.dispatchEvent( new CustomEvent( 'os-open-ai' ) ),
	};
}

/**
 * Put the shortcut hint inside the tile, once per render.
 *
 * Through `os.dock.tile-rendered` rather than by reaching into the
 * dock's DOM: the rail rebuilds on every menu refresh and layout
 * change, so anything written in by hand is gone the next repaint.
 * Idempotent, because the dock also re-renders in place.
 */
export function decorateAssistantTile(): void {
	addAction(
		HOOKS.DOCK_TILE_RENDERED,
		'desktop-mode/assistant-tile',
		( detail: unknown ) => {
			const { item, el } = ( detail ?? {} ) as {
				item?: { id?: string };
				el?: HTMLElement;
			};
			if (
				! el ||
				item?.id !== ASSISTANT_TILE_ID ||
				el.classList.contains( DECORATED )
			) {
				return;
			}
			el.classList.add( DECORATED );
			// Inside the button, beside the glyph — appended to the tile
			// it would sit under the icon, outside the hit area.
			el.querySelector( '.os-dock__item-primary' )?.appendChild(
				buildChord(),
			);
		},
	);
}
