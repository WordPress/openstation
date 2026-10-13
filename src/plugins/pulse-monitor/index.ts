/**
 * Pulse Monitor — bundle entry.
 *
 * A PixiJS ECG wired to the site: every HTTP request the shell makes or
 * sees, every signal the desk emits (windows, clicks, Heartbeat,
 * messages, errors) and every site-wide event the server relays over
 * Heartbeat (visitors, bots, comments, logins, cron, API) is a beat,
 * labelled with its cause. The rhythm is a diagnosis: a healthy site
 * keeps a sinus rhythm; failures, slow responses and outages turn it
 * into PVCs, atrial fibrillation, ventricular tachycardia or a
 * flatline. Failed (amber) beats say why.
 *
 * One bundle, two faces, so the engine loads once whichever is on the
 * desk — or both:
 *
 *   wallpaper.ts  the canvas wallpaper `wp-pulse`
 *   widget.ts     the widget `desktop-mode/pulse`
 *
 * Shared by both:
 *
 *   monitor.ts    one mounted trace: rhythm + scene + numbers + labels
 *   hub.ts        the page's single set of signal taps + diagnosis
 *   signals.ts    every tap, and the Heartbeat server feed
 *   health.ts     the diagnosis
 *   rhythm.ts     beat scheduling + waveform synthesis
 *   scene.ts      the Pixi trace and spike labels
 *   readout.ts    the numbers and the beeper
 *   incidents.ts  every failure with its URL, status and window
 *   issues.ts     the Issues window: the diagnosis, itemised, and the incidents
 *   config.ts     the settings form (each face edits its own settings)
 *   sources.ts    the signal catalog
 *   settings.ts   settings sanitizing
 *
 * Server side: `includes/pulse-monitor.php` (feed, script handle,
 * widget registration) and `includes/wallpapers.php` (wallpaper).
 */

import { __ } from '../../i18n';
import type { WallpaperDef } from '../../wallpapers/types';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
import { openIssues } from './issues';
import { WALLPAPER_ID, wallpaperDef } from './wallpaper';
import { WIDGET_ID, mountWidget } from './widget';

type WidgetMount = ( container: HTMLElement, ctx: WidgetContext ) => WidgetTeardown | Promise< WidgetTeardown >;

const w = window as unknown as {
	openStationWallpapers?: Record< string, WallpaperDef >;
	openStationWidgets?: Record< string, WidgetMount >;
};

w.openStationWallpapers = w.openStationWallpapers || {};
w.openStationWallpapers[ WALLPAPER_ID ] = wallpaperDef;

w.openStationWidgets = w.openStationWidgets || {};
w.openStationWidgets[ WIDGET_ID ] = mountWidget;

// "Pulse Monitor: issues" in the command palette — the way in when the
// trace is the full-screen wallpaper, under the desk and not clickable.
( window.wp as unknown as {
	os?: { registerCommand?: ( cmd: Record< string, unknown > ) => void };
} | undefined )?.os?.registerCommand?.( {
	slug: 'pulse-issues',
	label: __( 'Pulse Monitor: issues' ),
	description: __( 'Why the site’s health score is what it is, and every failed request and error with its URL.' ),
	icon: 'dashicons-heart',
	run: ( _args: string, ctx: { close?: () => void } ) => {
		openIssues();
		ctx?.close?.();
	},
} );
