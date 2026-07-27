/**
 * Experimental section — the canvas stage and its screen effects.
 *
 * Home of the master `canvasStageEnabled` toggle, which puts the whole
 * desktop inside a `<canvas layoutsubtree>` via the experimental
 * HTML-in-Canvas browser API, plus a checkbox and parameter sliders for
 * every registered screen effect.
 *
 * Two behaviours worth knowing:
 *
 * - **No fallback, no pretending.** On a browser without the API the
 *   master toggle renders disabled under a notice naming what is
 *   needed. Nothing else in the tab is shown, because nothing else
 *   would do anything.
 * - **Effects come from the lazy stage bundle**, which only loads once
 *   the stage is actually running. So an empty effect list right after
 *   switching the toggle on is expected, not broken — the section
 *   subscribes to the registry and repaints when the built-ins land.
 *
 * Every control here is live: `ctx.save()` fans the new snapshot out to
 * `subscribeOsSettings`, and the stage controller applies it without a
 * reload. Only the master toggle can need one, and only when open
 * windows would be reloaded by the DOM move — the controller owns that
 * prompt, not this section.
 *
 * @since 0.9.8
 */

import { __ } from '../../i18n';
import { MAX_SCREEN_EFFECTS, resolveParams } from '../../stage/chain';
import {
	isStageSupported,
	probeElementUpload,
	stageSupportDetail,
} from '../../stage/feature-detect';
import {
	listScreenEffects,
	subscribeScreenEffects,
} from '../../stage/registry';
import type { ScreenEffectDef } from '../../stage/types';
import { html, render } from '../../ui/core';
import type { SettingsCtx } from '../types';

export function buildExperimentalSection( ctx: SettingsCtx ): HTMLElement {
	const wrapper = document.createElement( 'div' );
	// Two-stage gate. The sniff is cheap; the probe actually performs an
	// upload, because a browser can expose `texElementImage2D` with a
	// signature PixiJS's uploader does not match — and finding that out
	// after wrapping the shell means an invisible desktop.
	const uploadProbe = isStageSupported()
		? probeElementUpload()
		: { ok: false };
	const supported = uploadProbe.ok;

	// Sorted by chain position so the list reads in the order the
	// shaders actually run — which is what the section description
	// promises.
	const byChainOrder = ( defs: ScreenEffectDef[] ): ScreenEffectDef[] =>
		defs
			.slice()
			.sort( ( a, b ) => ( a.order ?? 100 ) - ( b.order ?? 100 ) );

	let effects: ScreenEffectDef[] = byChainOrder( listScreenEffects() );

	const onStageToggle = ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		ctx.state.canvasStageEnabled = checked;
		ctx.save();
		paint();
	};

	const isSelected = ( id: string ): boolean =>
		ctx.state.screenEffects.some( ( entry ) => entry.id === id );

	const onEffectToggle = ( def: ScreenEffectDef ) => ( e: Event ): void => {
		const checked = ( e as CustomEvent ).detail?.checked === true;
		const rest = ctx.state.screenEffects.filter(
			( entry ) => entry.id !== def.id,
		);
		if ( checked ) {
			if ( rest.length >= MAX_SCREEN_EFFECTS ) {
				// Silently refusing would look like a broken checkbox, so
				// repaint to snap it back and leave the cap visible in the
				// section description.
				paint();
				return;
			}
			// Seed the entry with its resolved defaults so the sliders
			// have real values to show the moment it is ticked.
			rest.push( { id: def.id, params: resolveParams( def ) } );
		}
		ctx.state.screenEffects = rest;
		ctx.save();
		paint();
	};

	const onParamChange =
		( def: ScreenEffectDef, key: string ) =>
			( e: Event ): void => {
				const value = Number( ( e as CustomEvent ).detail?.value );
				if ( ! Number.isFinite( value ) ) {
					return;
				}
				ctx.state.screenEffects = ctx.state.screenEffects.map(
					( entry ) => {
						if ( entry.id !== def.id ) {
							return entry;
						}
						const params = resolveParams( def, entry.params );
						params[ key ] = value;
						return { id: entry.id, params };
					},
				);
				ctx.save();
				// No repaint: the slider owns its own value while
				// dragging, and re-rendering mid-drag would fight the
				// pointer capture.
			};

	const paramsFor = ( def: ScreenEffectDef ): Record< string, number > => {
		const entry = ctx.state.screenEffects.find( ( s ) => s.id === def.id );
		return resolveParams( def, entry?.params );
	};

	const renderEffect = ( def: ScreenEffectDef ) => {
		const selected = isSelected( def.id );
		const values = paramsFor( def );
		return html`
			<div class="desktop-mode-experimental__effect">
				<wpd-checkbox-label
					label=${ def.label }
					?checked=${ selected }
					@wpd-checkbox-change=${ onEffectToggle( def ) }
				></wpd-checkbox-label>
				${ def.description
					? html`<p class="desktop-mode-experimental__hint">
							${ def.description }
					  </p>`
					: '' }
				${ selected && def.params?.length
					? html`<div class="desktop-mode-experimental__params">
							${ def.params.map(
								( param ) => html`
									<wpd-range-field
										label=${ param.label }
										min=${ String( param.min ) }
										max=${ String( param.max ) }
										step=${ String( param.step ) }
										suffix=${ param.suffix ?? '' }
										value=${ String( values[ param.key ] ) }
										@wpd-range-change=${ onParamChange(
											def,
											param.key,
										) }
									></wpd-range-field>
								`,
							) }
					  </div>`
					: '' }
			</div>
		`;
	};

	/**
	 * Name the specific primitives this browser is missing. A flat
	 * "not supported" is unhelpful when the flag *is* on and something
	 * else is wrong — this line tells the user (and us) exactly which
	 * leg failed, without them having to open a console.
	 */
	const missingCapabilities = (): string => {
		const detail = stageSupportDetail();
		const missing: string[] = [];
		if ( ! detail.texElementImage2D ) {
			missing.push( 'gl.texElementImage2D()' );
		} else if ( ! uploadProbe.ok ) {
			// The method exists but rejected a real upload — almost always
			// a signature mismatch between this browser's build of the
			// experimental API and the one PixiJS targets.
			missing.push(
				`gl.texElementImage2D() ${ __( 'rejected a test upload' ) }: ${
					uploadProbe.error ?? ''
				}`,
			);
		}
		// Reported but never a gate — see `isStageSupported()`.
		const optional: string[] = [];
		if ( ! detail.requestPaint ) {
			optional.push( 'canvas.requestPaint()' );
		}
		if ( ! detail.drawElementImage ) {
			optional.push( 'ctx2d.drawElementImage()' );
		}
		const parts: string[] = [];
		if ( missing.length ) {
			parts.push( `${ __( 'Missing:' ) } ${ missing.join( ', ' ) }` );
		}
		if ( optional.length ) {
			parts.push( `${ __( 'Also absent:' ) } ${ optional.join( ', ' ) }` );
		}
		return parts.join( ' · ' );
	};

	const paint = (): void => {
		if ( ! supported ) {
			render(
				html`
					<wpd-section
						heading=${ __( 'Canvas rendering' ) }
						description=${ __(
							'Render the whole desktop through a canvas so shaders can post-process it.',
						) }
					>
						<wpd-notice tone="info" not-dismissible>
							${ __(
								'This browser does not support HTML-in-Canvas. It needs Chrome 148 or newer with the feature enabled at chrome://flags/#canvas-draw-element, then a full restart of the browser.',
							) }
						</wpd-notice>
						<p class="desktop-mode-experimental__hint">
							${ missingCapabilities() }
						</p>
						<wpd-checkbox-label
							label=${ __( 'Render the desktop in a canvas' ) }
							?checked=${ false }
							disabled
						></wpd-checkbox-label>
					</wpd-section>
				`,
				wrapper,
			);
			return;
		}

		const enabled = ctx.state.canvasStageEnabled;

		render(
			html`
				<wpd-section
					heading=${ __( 'Canvas rendering' ) }
					description=${ __(
						'Put the desktop inside a canvas using the experimental HTML-in-Canvas browser API. Everything stays fully interactive — only the pixels take a detour through the GPU.',
					) }
				>
					<wpd-notice tone="warning" not-dismissible>
						${ __(
							'Experimental. This relies on a browser API that is still a proposal, and it renders every window through the GPU each frame. Turning it on while windows are open reloads them.',
						) }
					</wpd-notice>
					<wpd-checkbox-label
						label=${ __( 'Render the desktop in a canvas' ) }
						?checked=${ enabled }
						@wpd-checkbox-change=${ onStageToggle }
					></wpd-checkbox-label>
				</wpd-section>
				${ enabled
					? html`<wpd-section
							heading=${ __( 'Screen effects' ) }
							description=${ __(
								'Shaders applied to the whole desktop, in the order listed. Stack up to eight.',
							) }
						>
							${ effects.length === 0
								? html`<p class="desktop-mode-experimental__hint">
										${ __(
											'No screen effects available yet — they load with the canvas renderer. Reload the page if this persists.',
										) }
								  </p>`
								: effects.map( renderEffect ) }
					  </wpd-section>`
					: '' }
			`,
			wrapper,
		);
	};

	const unsubscribe = subscribeScreenEffects( () => {
		effects = byChainOrder( listScreenEffects() );
		paint();
	} );

	// Same teardown idiom as the sibling registry-backed sections (see
	// `effects.ts`): watch the parent's child list so the registry
	// listener is dropped when the panel unmounts this wrapper.
	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
			observer.disconnect();
		}
	} );
	queueMicrotask( () => {
		if ( wrapper.parentNode ) {
			observer.observe( wrapper.parentNode, {
				childList: true,
				subtree: false,
			} );
		}
	} );

	paint();
	return wrapper;
}
