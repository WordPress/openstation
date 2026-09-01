/**
 * Appearance — accent, desktop layout, dock style, admin bar.
 *
 * Every section is a function of the settings snapshot: a pick calls
 * `update()`, the store applies and notifies, the app repaints. No
 * section holds state of its own.
 */

import { __, html } from '@openstation/app';
import {
	ADMIN_BAR_MODES,
	CUSTOM_ACCENT_ID,
	DESKTOP_LAYOUTS,
	DOCK_BEHAVIORS,
	DOCK_PLACEMENTS,
	DOCK_SIZES,
	getAccents,
} from '../../../src/settings/constants';
import { listDockRailRenderers } from '../../../src/dock-rail';
import type {
	AdminBarModeId,
	DesktopLayoutId,
	DockBehaviorId,
	DockPlacementId,
	DockSizeId,
	OsSettingsState,
} from '../../../src/settings/types';
import {
	translateAccentLabel,
	translateAdminBarModeLabel,
	translateDesktopLayoutDescription,
	translateDesktopLayoutLabel,
	translateDockBehaviorLabel,
	translateDockPlacementLabel,
	translateDockSizeLabel,
} from './labels';
import { update } from './store';
import { pickedValue, type Section } from './types';

// ------------------------------------------------------------- accent

/**
 * The Custom swatch's own face: the accent families as a colour wheel,
 * so the tile reads as "any colour" rather than as one more preset.
 * A conic gradient rather than the brand meshes, because those are
 * reserved for hero surfaces and this is a 28px chip.
 */
const CUSTOM_PREVIEW =
	'conic-gradient( #f252fc, #9af2ff, #93f0c6, #f8f2b6, #ff5a5a, #f252fc )';

/**
 * Opens the native colour wheel on the Custom swatch.
 *
 * Where the wheel appears is not something `showPicker()` takes an
 * argument for: it is a browser popup anchored to the box of the
 * `<input type="color">` it belongs to. So the input is laid out over
 * the Custom swatch in CSS (`.os-settings__accent-custom` gives the
 * cell its containing block, `.os-settings__accent-picker` fills it)
 * and the wheel follows the swatch for free, through every window
 * resize and grid reflow, with nothing to measure.
 */
function openWheel( grid: Element ): void {
	const input = grid.querySelector< HTMLInputElement >(
		'.os-settings__accent-picker',
	);
	if ( ! input ) {
		return;
	}
	try {
		input.showPicker();
	} catch {
		input.click();
	}
}

/**
 * The accent row. The last swatch is Custom, and it is not one of the
 * presets: it carries {@link CUSTOM_ACCENT_ID} and opens the native
 * colour wheel on the swatch itself. A site's brand colour is rarely
 * one of ten we picked, and before this the only way to get it was a
 * PHP filter, which is not a thing you ask a person choosing a
 * wallpaper to write.
 */
export const accentSection: Section = ( s ) => {
	const isCustom = s.accent === CUSTOM_ACCENT_ID;
	const onPick = ( e: Event ): void => {
		const id = pickedValue( e );
		if ( id !== CUSTOM_ACCENT_ID && ! getAccents().some( ( a ) => a.id === id ) ) {
			return;
		}
		update( { accent: id } );
		// Picking Custom means "I want a colour that is not here", so
		// the wheel opens on the same click, under the swatch.
		if ( id === CUSTOM_ACCENT_ID ) {
			openWheel( e.currentTarget as Element );
		}
	};
	const onCustomColor = ( e: Event ): void => {
		const value = ( e.target as HTMLInputElement ).value;
		if ( ! /^#[0-9a-fA-F]{6}$/.test( value ) ) {
			return;
		}
		// Picking a colour IS picking the custom accent. Making the
		// user choose the swatch and then the colour would leave the
		// obvious gesture doing nothing visible.
		update( { customAccent: value, accent: CUSTOM_ACCENT_ID } );
	};
	return html`
		<os-section
			heading=${ __( 'Accent color' ) }
			description=${ __( 'Used in focused window title bars, buttons, and focus rings.' ) }
		>
			<os-swatch-grid label=${ __( 'Accent color' ) } mode="row" @os-pick=${ onPick }>
				${ getAccents().map(
					( a ) => html`<os-swatch
						value=${ a.id }
						label=${ translateAccentLabel( a.id, a.label ) }
						preview=${ a.value }
						size="small"
						variant="accent"
						?selected=${ s.accent === a.id }
					></os-swatch>`,
				) }
				<span class="os-settings__accent-custom">
					<os-swatch
						value=${ CUSTOM_ACCENT_ID }
						label=${ __( 'Custom' ) }
						preview=${ isCustom ? s.customAccent : CUSTOM_PREVIEW }
						size="small"
						variant="accent"
						?selected=${ isCustom }
					></os-swatch>
					<input
						type="color"
						class="os-settings__accent-picker"
						tabindex="-1"
						aria-hidden="true"
						.value=${ s.customAccent }
						@input=${ onCustomColor }
					/>
				</span>
			</os-swatch-grid>
		</os-section>
	`;
};

// ------------------------------------------------------ desktop layout

/**
 * The schematic each card draws, as `{ kind, rail, style }` shapes
 * applied to absolutely-positioned spans inside the preview box.
 *
 * Kept as data rather than hand-written templates so the shapes sit
 * next to each other and can be compared: the whole job of these
 * previews is that they read as DIFFERENT arrangements at a glance.
 * Geometry is in percentages of the preview box so the cards stay
 * legible as the grid reflows.
 */
interface PreviewShape {
	kind: 'win' | 'bar';
	/** Painted in the accent, and which rail it stands for. */
	rail?: 'dock' | 'sidebar';
	style: string;
}

const PREVIEWS: Readonly< Record< string, readonly PreviewShape[] > > = {
	// Two stacked windows over one dock along the bottom.
	unified: [
		{ kind: 'win', style: 'left:12%;top:14%;width:44%;height:42%' },
		{ kind: 'win', style: 'left:30%;top:30%;width:44%;height:42%' },
		{ kind: 'bar', rail: 'dock', style: 'left:24%;bottom:10%;width:52%;height:9%' },
	],
	// The same desk, plus a rail down the left. Same two windows at
	// the same size as Unified, because the only thing this layout
	// adds IS the second rail. The rail is flush to the left edge and
	// as thin as the dock is tall (at 16/9, 9% of the height is 5.06%
	// of the width). The dock is shorter than Unified's for the honest
	// reason: in this layout it holds the plugins and the apps, not
	// every menu.
	classic: [
		{ kind: 'bar', rail: 'sidebar', style: 'left:0;top:0;bottom:0;width:5%' },
		{ kind: 'win', style: 'left:14%;top:14%;width:44%;height:42%' },
		{ kind: 'win', style: 'left:32%;top:30%;width:44%;height:42%' },
		{ kind: 'bar', rail: 'dock', style: 'left:33%;bottom:10%;width:38%;height:9%' },
	],
};

/** One of a fixed list, or nothing. */
const pickFrom =
	< T extends string >( list: ReadonlyArray< { id: T } >, write: ( id: T ) => void ) =>
		( e: Event ): void => {
			const id = pickedValue( e );
			if ( list.some( ( o ) => o.id === id ) ) {
				write( id as T );
			}
		};

/** The Static / Dynamic segments, shared by every behavior control. */
const behaviorSegments = () =>
	DOCK_BEHAVIORS.map(
		( b ) => html`<os-segment value=${ b.id }>${ translateDockBehaviorLabel( b.id, b.label ) }</os-segment>`,
	);

/** What the picked behavior does, in one line under its control. */
const describeBehavior = ( id: DockBehaviorId ): string =>
	id === 'dynamic'
		? __(
			'The dock folds into a thin line at its edge of the screen and comes back when you move the pointer there. Windows can use the whole desktop.',
		)
		: __( 'The dock is always visible, and windows open above it.' );

/**
 * Where navigation lives: two cards, one per offered layout, each
 * drawing the arrangement it is offering rather than naming it.
 *
 * Each card carries its own control, always. Unified holds Placement,
 * because an edge to park the dock on only means something in that
 * layout; Split holds Sidebar behavior, the one control only its
 * second rail can answer. Both are drawn whether or not their card is
 * selected, so the cards stay the same height and nothing shifts on
 * a pick. Dock size and Dock behavior sit under both cards: both
 * layouts have a dock, and either dock can fold.
 *
 * A card is not a `<button>`: a radio cannot hold a segmented control
 * (nested interactive content is invalid). The card is a plain box,
 * the radio is the region inside it that means "this layout", and
 * the box wears the selection ring on the radio's behalf via `:has()`.
 */
export const layoutSection: Section = ( s ) => {
	const cardClass = ( id: string ): string => {
		const classes = [ 'os-settings__layout-card' ];
		if ( s.dockBehavior === 'dynamic' ) {
			classes.push( 'is-dock-dynamic' );
		}
		if ( id === 'classic' && s.sideDockBehavior === 'dynamic' ) {
			classes.push( 'is-sidebar-dynamic' );
		}
		return classes.join( ' ' );
	};
	const option = ( labelId: string, label: string, control: unknown, hint = '' ) =>
		html`<div class="os-settings__dock-option">
			<span class="os-settings__dock-option-label" id=${ labelId }>${ label }</span>
			${ control }
			${ hint ? html`<span class="os-settings__dock-option-hint">${ hint }</span>` : '' }
		</div>`;
	const placementOption = () =>
		html`<div class="os-settings__dock-options">
			${ option(
				'os-settings-dock-placement-label',
				__( 'Placement' ),
				html`<os-segmented
					value=${ s.dockPlacement }
					label=${ __( 'Dock position' ) }
					@os-pick=${ pickFrom( DOCK_PLACEMENTS, ( id: DockPlacementId ) => update( { dockPlacement: id } ) ) }
				>
					${ DOCK_PLACEMENTS.map(
						( p ) => html`<os-segment value=${ p.id }>${ translateDockPlacementLabel( p.id, p.label ) }</os-segment>`,
					) }
				</os-segmented>`,
			) }
		</div>`;
	const sidebarBehaviorOption = () =>
		html`<div class="os-settings__dock-options">
			${ option(
				'os-settings-side-dock-behavior-label',
				__( 'Sidebar behavior' ),
				html`<os-segmented
					value=${ s.sideDockBehavior }
					label=${ __( 'Sidebar behavior' ) }
					@os-pick=${ pickFrom( DOCK_BEHAVIORS, ( id: DockBehaviorId ) => update( { sideDockBehavior: id } ) ) }
				>
					${ behaviorSegments() }
				</os-segmented>`,
			) }
		</div>`;
	return html`
		<os-section heading=${ __( 'Desktop layout' ) } description=${ __( 'Where the menus live.' ) }>
			<div class="os-settings__layout-grid" role="radiogroup" aria-label=${ __( 'Desktop layout' ) }>
				${ DESKTOP_LAYOUTS.map( ( l ) => {
					const selected = s.desktopLayout === l.id;
					return html`<div class=${ cardClass( l.id ) }>
						<button
							type="button"
							class="os-settings__layout-choice"
							role="radio"
							aria-checked=${ selected ? 'true' : 'false' }
							@click=${ () => update( { desktopLayout: l.id as DesktopLayoutId } ) }
						>
							<span class="os-settings__layout-preview" aria-hidden="true">
								${ ( PREVIEWS[ l.id ] ?? [] ).map(
									( shape ) => html`<span
										class="os-settings__layout-${ shape.kind }${ shape.rail ? ` is-accent is-${ shape.rail }` : '' }"
										style=${ shape.style }
									></span>`,
								) }
							</span>
							<span class="os-settings__layout-name">${ translateDesktopLayoutLabel( l.id, l.label ) }</span>
							<span class="os-settings__layout-desc">${ translateDesktopLayoutDescription( l.id ) }</span>
						</button>
						${ l.id === 'classic' ? sidebarBehaviorOption() : placementOption() }
					</div>`;
				} ) }
			</div>
			<div class="os-settings__dock-options os-settings__dock-options--page">
				${ option(
					'os-settings-dock-size-label',
					__( 'Dock size' ),
					html`<os-segmented
						value=${ s.dockSize }
						label=${ __( 'Dock size' ) }
						@os-pick=${ pickFrom( DOCK_SIZES, ( id: DockSizeId ) => update( { dockSize: id } ) ) }
					>
						${ DOCK_SIZES.map(
							( d ) => html`<os-segment value=${ d.id }>${ translateDockSizeLabel( d.id, d.label ) }</os-segment>`,
						) }
					</os-segmented>`,
				) }
				${ option(
					'os-settings-dock-behavior-label',
					__( 'Dock behavior' ),
					html`<os-segmented
						value=${ s.dockBehavior }
						label=${ __( 'Dock behavior' ) }
						@os-pick=${ pickFrom( DOCK_BEHAVIORS, ( id: DockBehaviorId ) => update( { dockBehavior: id } ) ) }
					>
						${ behaviorSegments() }
					</os-segmented>`,
					describeBehavior( s.dockBehavior ),
				) }
			</div>
		</os-section>
	`;
};

// ------------------------------------------------------ dock renderer

/**
 * Dock style — every renderer registered via
 * `wp.os.registerDockRailRenderer`. Hidden entirely when only the
 * shipped default exists: a one-pill segmented control adds noise
 * without giving the user a real choice. A plugin that registers a
 * renderer flips the count and the picker materialises live (the app
 * subscribes to the registry).
 */
export const dockRailRendererSection: Section = ( s ) => {
	const renderers = listDockRailRenderers();
	if ( renderers.length <= 1 ) {
		return html``;
	}
	return html`
		<os-section
			heading=${ __( 'Dock style' ) }
			description=${ __(
				'How the rail itself paints — the shipped icon strip, or anything a plugin replaces it with. Switching is instant; the dock rebuilds with the new renderer.',
			) }
		>
			<os-segmented
				value=${ s.dockRailRenderer }
				label=${ __( 'Dock style' ) }
				@os-pick=${ ( e: Event ) => {
					const id = pickedValue( e );
					if ( id !== '' ) {
						update( { dockRailRenderer: id } );
					}
				} }
			>
				${ renderers.map( ( r ) => html`<os-segment value=${ r.id }>${ r.label }</os-segment>` ) }
			</os-segmented>
		</os-section>
	`;
};

// ----------------------------------------------------------- admin bar

/** Per-mode helper copy, shown under the segmented control. */
function describeAdminBar( id: AdminBarModeId ): string {
	switch ( id ) {
		case 'dynamic':
			return __(
				'The admin bar slides out of the way and comes back when you move the pointer to the top edge of the screen.',
			);
		case 'hidden':
			return __(
				'The admin bar is never shown. Use the Exit OpenStation tile on the dock to get back to the classic admin.',
			);
		default:
			return __( 'The admin bar is always visible above the desktop.' );
	}
}

/**
 * Static / Dynamic / Hidden. The pick lands as an `os-admin-bar-<mode>`
 * body class through the store's apply pass. `Hidden` takes away the
 * admin bar's "Switch to Classic Admin" toggle, so the description
 * names the replacement route out — the "Exit OpenStation" tile on
 * the dock, which is always present on the core rail.
 */
export const adminBarSection: Section = ( s ) => html`
	<os-section heading=${ __( 'Admin bar' ) } description=${ describeAdminBar( s.adminBarMode ) }>
		<os-segmented
			value=${ s.adminBarMode }
			label=${ __( 'Admin bar' ) }
			@os-pick=${ pickFrom( ADMIN_BAR_MODES, ( id: AdminBarModeId ) => update( { adminBarMode: id } ) ) }
		>
			${ ADMIN_BAR_MODES.map(
				( m ) => html`<os-segment value=${ m.id }>${ translateAdminBarModeLabel( m.id, m.label ) }</os-segment>`,
			) }
		</os-segmented>
	</os-section>
`;

/** The Appearance page, top to bottom. */
export function renderAppearance( s: OsSettingsState, wallpaper: unknown, ctx: Parameters< Section >[ 1 ] ) {
	// Accent first. It is one row of swatches and the fastest thing on
	// the page to change, where the wallpaper grid below it is fourteen
	// tiles deep. Under the grid it fell below the fold on a short
	// window and read as an afterthought to it.
	return html`
		${ accentSection( s, ctx ) }
		${ wallpaper }
		${ layoutSection( s, ctx ) }
		${ dockRailRendererSection( s, ctx ) }
		${ adminBarSection( s, ctx ) }
	`;
}
