/**
 * Dock behavior section — segmented control (Static / Dynamic) bound
 * to `state.dockBehavior`. The pick is written as an
 * `os-dock-<behavior>` body class by `ctx.apply()`, which is what
 * `dock.css` keys off to park the rail behind a peek strip and what
 * `src/dock-behavior.ts` reads to bring it back when the pointer
 * reaches its edge.
 *
 * `Dynamic` also releases the band the rail floats over from the
 * work area (`src/work-area/index.ts`), so windows get the whole
 * desktop and the rail slides over them when summoned — the same
 * deal the admin bar's Dynamic mode offers one edge up.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import { DOCK_BEHAVIORS } from '../constants';
import { translateDockBehaviorLabel } from '../labels';
import type { DockBehaviorId, SettingsCtx } from '../types';

/** Per-behavior helper copy, shown under the segmented control. */
function describe( id: DockBehaviorId ): string {
	switch ( id ) {
		case 'dynamic':
			return __(
				'The dock slides out of the way and comes back when you move the pointer to its edge of the screen. Windows can use the whole desktop.',
			);
		default:
			return __(
				'The dock is always visible, and windows open above it.',
			);
	}
}

export function buildDockBehaviorSection( ctx: SettingsCtx ): HTMLElement {
	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! DOCK_BEHAVIORS.some( ( b ) => b.id === id ) ) {
			return;
		}
		ctx.state.dockBehavior = id as DockBehaviorId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Dock behavior' ) }
					description=${ describe( ctx.state.dockBehavior ) }
				>
					<os-segmented
						value=${ ctx.state.dockBehavior }
						label=${ __( 'Dock behavior' ) }
						@os-pick=${ onPick }
					>
						${ DOCK_BEHAVIORS.map(
		( b ) => html`<os-segment value=${ b.id }
								>${ translateDockBehaviorLabel(
			b.id,
			b.label,
		) }</os-segment
							>`,
	) }
					</os-segmented>
				</os-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
