/**
 * Desktop-layout section — where navigation lives.
 *
 * Two cards, one per offered layout, each drawing the arrangement it
 * is offering rather than naming it. A layout is a spatial choice and
 * the words for them ("Unified", "Split") are not self-explaining:
 * a segmented bar of those labels asked the user to guess what each
 * one would do to their screen and then find out by trying. The
 * previews are schematic on purpose, a couple of window rectangles
 * and a rail, because the point is where things sit and not what they
 * contain.
 *
 * ## Placement lives inside the card, dock size does not
 *
 * Picking Unified opens Placement within that card, because an edge
 * to park the dock on only means something once that layout is the
 * answer, and saying so by containment beats saying it by proximity.
 * Dock size sits under both cards instead: both layouts have a dock,
 * and Split's bottom rail reads `--os-dock-width` exactly as Unified's
 * does.
 * They used to be a separate Dock page in the sidebar; a page for two
 * segmented controls sent people hunting for what is really one
 * decision made in one place. Dock STYLE (the rail renderer registry)
 * stays its own section on this page, appended by `panel.ts`, because
 * plugins can register rows into it at runtime and it carries its own
 * repaint wiring.
 *
 * That containment is why a card is not a `<button>`. A radio cannot
 * hold a segmented control: nested interactive content is invalid,
 * and every click on a segment would also land on the card behind it.
 * So the card is a plain box, and the radio is the region inside it
 * that means "this layout" — the preview, the name, the description.
 * The box wears the selection ring and the hover lift on the radio's
 * behalf, through `:has()`, so nothing about how it reads changed.
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
	// The same desk, plus a rail down the left. Same two windows at
	// the same size as Unified, because the only thing this layout
	// adds IS the second rail — and a preview that also resized the
	// windows would have the user hunting for which difference is the
	// one being offered.
	//
	// The rail is flush to the left edge and as thin as the dock is
	// tall (3% of the box's width reads the same as 9% of its height,
	// which is a third as long). It is the one shape here that is
	// attached to the screen rather than floating on it, which is what
	// the side bar actually does. The dock is shorter than Unified's
	// for the honest reason: in this layout it holds the plugins and
	// the apps, not every menu.
	classic: [
		{ kind: 'bar', accent: true, style: 'left:0;top:0;bottom:0;width:3%' },
		{ kind: 'win', style: 'left:14%;top:14%;width:44%;height:42%' },
		{ kind: 'win', style: 'left:32%;top:30%;width:44%;height:42%' },
		{ kind: 'bar', accent: true, style: 'left:33%;bottom:10%;width:38%;height:9%' },
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
	 * Placement belongs to the Unified card, and only there: Split
	 * draws its rails on its own edges, so a position control in its
	 * card would point at an edge nothing reads.
	 */
	const placementOption = () =>
		html`<div class="os-settings__dock-options">
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
			  </div>`;

	/*
	 * Dock size sits BELOW the cards, outside both of them, because
	 * both layouts have a dock: Split's bottom rail sizes off
	 * `--os-dock-width` exactly as Unified's does. Inside the Unified
	 * card it was a control that applied to a layout it could not be
	 * reached from.
	 *
	 * Which is also why it says "Dock size" again out here. Inside the
	 * card the heading above it supplied the noun and "Size" was
	 * enough; on its own under two cards, it has to name what it
	 * sizes.
	 */
	const sizeOption = () =>
		html`<div
					class="os-settings__dock-options os-settings__dock-options--page"
				>
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
			  </div>`;

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
						${ DESKTOP_LAYOUTS.map( ( l ) => {
							const selected = ctx.state.desktopLayout === l.id;
							return html`<div class="os-settings__layout-card">
								<button
									type="button"
									class="os-settings__layout-choice"
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
								</button>
								${ l.id === 'unified' && selected
									? placementOption()
									: html`` }
							</div>`;
						} ) }
					</div>
					${ sizeOption() }
				</os-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
