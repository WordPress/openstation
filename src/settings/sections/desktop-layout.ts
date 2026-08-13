/**
 * Desktop-layout section — where navigation lives.
 *
 * Two cards, one per offered layout, each drawing the arrangement it
 * is offering rather than naming it. A layout is a spatial choice and
 * the words for them ("One dock", "Side bar") are not self-explaining:
 * a segmented bar of those labels asked the user to guess what each
 * one would do to their screen and then find out by trying. The
 * previews are schematic on purpose, a couple of window rectangles
 * and a rail, because the point is where things sit and not what they
 * contain.
 *
 * The `openstation` and `spatial` layouts still exist in the shell
 * and a stored selection of either keeps working; they are no longer
 * OFFERED here. Removing a stored value would silently rearrange the
 * desk of anyone already using it, so only the picker shrank.
 *
 * ## The dock options live under the card that has a dock
 *
 * Picking One dock reveals Dock position and Dock size right under
 * the cards, two columns, because those options only mean something
 * once that layout is the answer. They used to be a separate Dock
 * page in the sidebar; a page for two segmented controls sent people
 * hunting for what is really one decision made in one place. Dock
 * STYLE (the rail renderer registry) stays its own section on this
 * page, appended by `panel.ts`, because plugins can register rows
 * into it at runtime and it carries its own repaint wiring.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	DESKTOP_LAYOUTS,
	DOCK_PLACEMENTS,
	DOCK_SIZES,
} from '../constants';
import {
	translateDesktopLayoutDescription,
	translateDesktopLayoutLabel,
	translateDockPlacementLabel,
	translateDockSizeLabel,
} from '../labels';
import type {
	DesktopLayoutId,
	DockPlacementId,
	DockSizeId,
	SettingsCtx,
} from '../types';

/** The layouts the picker offers. See the file docblock. */
const OFFERED: readonly DesktopLayoutId[] = [ 'unified', 'classic' ];

/**
 * The schematic each card draws, as `{ class, style }` pairs applied
 * to absolutely-positioned spans inside the preview box.
 *
 * Kept as data rather than hand-written templates so the shapes sit
 * next to each other and can be compared: the whole job of these
 * previews is that they read as DIFFERENT arrangements at a glance,
 * and that is easier to get right in a table than spread across
 * markup. Geometry is in percentages of the preview box so the cards
 * stay legible as the grid reflows.
 */
interface PreviewShape {
	/** A window rectangle, or a rail. */
	kind: 'win' | 'bar';
	/** Painted in the accent: the dock. */
	accent?: boolean;
	style: string;
}

const PREVIEWS: Readonly< Record< string, readonly PreviewShape[] > > = {
	// Two stacked windows over one dock along the bottom.
	unified: [
		{ kind: 'win', style: 'left:12%;top:14%;width:44%;height:42%' },
		{ kind: 'win', style: 'left:30%;top:30%;width:44%;height:42%' },
		{ kind: 'bar', accent: true, style: 'left:24%;bottom:10%;width:52%;height:9%' },
	],
	// The classic wp-admin menu, wide, on the left. No dock.
	classic: [
		{ kind: 'bar', style: 'left:7%;top:12%;width:20%;height:70%' },
		{ kind: 'win', style: 'left:35%;top:17%;width:43%;height:50%' },
	],
};

export function buildDesktopLayoutSection( ctx: SettingsCtx ): HTMLElement {
	const onPick = ( id: string ): void => {
		if ( ! DESKTOP_LAYOUTS.some( ( l ) => l.id === id ) ) {
			return;
		}
		ctx.state.desktopLayout = id as DesktopLayoutId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const onPlacementPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! DOCK_PLACEMENTS.some( ( p ) => p.id === id ) ) {
			return;
		}
		ctx.state.dockPlacement = id as DockPlacementId;
		ctx.save();
		ctx.apply();
		paint();
	};

	const onSizePick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( ! DOCK_SIZES.some( ( s ) => s.id === id ) ) {
			return;
		}
		ctx.state.dockSize = id as DockSizeId;
		ctx.save();
		ctx.apply();
		paint();
	};

	/*
	 * Only One dock reveals the dock options: Side bar draws its own
	 * rails on its own edges, so a position control under it would
	 * point at an edge nothing reads.
	 */
	const dockOptions = () =>
		ctx.state.desktopLayout === 'unified'
			? html`<div class="os-settings__dock-options">
					<div class="os-settings__dock-option">
						<span
							class="os-settings__dock-option-label"
							id="os-settings-dock-placement-label"
							>${ __( 'Placement' ) }</span
						>
						<os-segmented
							value=${ ctx.state.dockPlacement }
							label=${ __( 'Dock position' ) }
							@os-pick=${ onPlacementPick }
						>
							${ DOCK_PLACEMENTS.map(
								( p ) => html`<os-segment value=${ p.id }
										>${ translateDockPlacementLabel(
											p.id,
											p.label,
										) }</os-segment
									>`,
							) }
						</os-segmented>
					</div>
					<div class="os-settings__dock-option">
						<span
							class="os-settings__dock-option-label"
							id="os-settings-dock-size-label"
							>${ __( 'Dock size' ) }</span
						>
						<os-segmented
							value=${ ctx.state.dockSize }
							label=${ __( 'Dock size' ) }
							@os-pick=${ onSizePick }
						>
							${ DOCK_SIZES.map(
								( s ) => html`<os-segment value=${ s.id }
										>${ translateDockSizeLabel(
											s.id,
											s.label,
										) }</os-segment
									>`,
							) }
						</os-segmented>
					</div>
			  </div>`
			: html``;

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Desktop layout' ) }
					description=${ __( 'Where the menus live.' ) }
				>
					<div
						class="os-settings__layout-grid"
						role="radiogroup"
						aria-label=${ __( 'Desktop layout' ) }
					>
						${ DESKTOP_LAYOUTS.filter( ( l ) =>
							OFFERED.includes( l.id ),
						).map( ( l ) => {
							const selected = ctx.state.desktopLayout === l.id;
							return html`<button
								type="button"
								class="os-settings__layout-card"
								role="radio"
								aria-checked=${ selected ? 'true' : 'false' }
								@click=${ () => onPick( l.id ) }
							>
								<span
									class="os-settings__layout-preview"
									aria-hidden="true"
								>
									${ ( PREVIEWS[ l.id ] ?? [] ).map(
										( shape ) => html`<span
											class="os-settings__layout-${ shape.kind }${ shape.accent
												? ' is-accent'
												: '' }"
											style=${ shape.style }
										></span>`,
									) }
								</span>
								<span class="os-settings__layout-name"
									>${ translateDesktopLayoutLabel(
										l.id,
										l.label,
									) }</span
								>
								<span class="os-settings__layout-desc"
									>${ translateDesktopLayoutDescription(
										l.id,
									) }</span
								>
							</button>`;
						} ) }
					</div>
					${ dockOptions() }
				</os-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
