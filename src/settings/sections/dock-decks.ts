/**
 * Dock-decks section — the opt-in, and the one decision it leaves
 * open.
 *
 * A bottom dock can fold its tiles into groups and show one at a time
 * (see `src/dock-decks/index.ts`). That is a real change to how the
 * rail is read, not a refinement of it — a tile that was on screen
 * becomes one click away — so it is off until asked for.
 *
 * The second toggle answers what should happen when a window in a
 * deck you are *not* looking at takes focus. The default is nothing:
 * the deck's tab picks up an indicator dot and waits to be clicked,
 * which is the framework being a transport rather than a UX policy
 * maker. The other answer is just as defensible for anyone who treats
 * the dock as a view of what they're doing, which is why it's a
 * toggle rather than a decision made for them. It is disabled while
 * decks are off — there are no decks to follow into.
 *
 * Sits next to Dock size in Appearance rather than in Features: it is
 * a property of the dock, and someone changing how the dock looks is
 * exactly who is about to wonder about this.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import type { SettingsCtx } from '../types';

export function buildDockDecksSection( ctx: SettingsCtx ): HTMLElement {
	/*
	 * `apply()` BEFORE `save()`, which is the opposite of every other
	 * section here and is load-bearing for exactly one of these two
	 * toggles.
	 *
	 * `save()` fires the os-settings subscribers synchronously, and
	 * the one in `desktop.ts` calls `layoutDispatcher.refresh()` →
	 * `Dock.replaceItems()` → `DockDecks.sync()`. `sync()` reads
	 * `data-os-decks` off the shell, and `apply()` is what writes it.
	 * In the usual order the rail would repaint against the PREVIOUS
	 * value and only catch up on the next unrelated settings change.
	 *
	 * Nothing in `apply()` writes state, so running it first is safe.
	 */
	const commit = (): void => {
		ctx.apply();
		ctx.save();
		paint();
	};

	const onDecksToggle = ( e: Event ): void => {
		ctx.state.dockDecksEnabled =
			( e as CustomEvent ).detail?.checked === true;
		commit();
	};

	const onFollowFocusToggle = ( e: Event ): void => {
		ctx.state.dockDeckFollowFocus =
			( e as CustomEvent ).detail?.checked === true;
		commit();
	};

	const wrapper = document.createElement( 'div' );
	const paint = (): void =>
		render(
			html`
				<os-section
					heading=${ __( 'Dock groups' ) }
					description=${ __(
						'Fold the bottom dock into groups — Favorites, WordPress, Plugins and OpenStation — and show one at a time, with tabs at its leading edge to switch between them. Useful once the dock has more icons than fit across the screen.',
					) }
				>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Group the dock into tabs' ) }
							?checked=${ ctx.state.dockDecksEnabled }
							@os-checkbox-change=${ onDecksToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Off by default: every icon stays on screen, and a dock wider than the viewport scrolls. Only applies to a dock on the bottom edge — a side dock has the height to show everything. Star an icon from its right-click menu to give it a Favorites tab.',
							) }
						</p>
					</div>
					<div class="os-features__item">
						<os-checkbox-label
							label=${ __( 'Follow the focused window' ) }
							?checked=${ ctx.state.dockDeckFollowFocus }
							?disabled=${ ! ctx.state.dockDecksEnabled }
							@os-checkbox-change=${ onFollowFocusToggle }
						></os-checkbox-label>
						<p class="os-features__hint">
							${ __(
								'Switch the dock to the group holding a window whenever that window takes focus, so the icon you would reach for next is always on screen. Off by default: the group keeps an indicator dot instead, and the dock stays where you left it.',
							) }
						</p>
					</div>
				</os-section>
			`,
			wrapper,
		);
	paint();
	return wrapper;
}
