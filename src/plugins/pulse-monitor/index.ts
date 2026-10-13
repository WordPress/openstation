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
 *   config.ts     the settings form (both faces edit one settings bag)
 *   sources.ts    the signal catalog
 *   settings.ts   settings sanitizing
 *
 * Server side: `includes/pulse-monitor.php` (feed, script handle,
 * widget registration) and `includes/wallpapers.php` (wallpaper).
 */

import type { WallpaperDef } from '../../wallpapers/types';
import type { WidgetContext, WidgetTeardown } from '../../widgets/types';
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
