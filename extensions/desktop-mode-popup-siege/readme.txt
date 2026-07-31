=== Desktop Mode — Popup Siege ===
Contributors: nickhamze
Tags: admin, dashboard, desktop, game, arcade
Requires at least: 6.5
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.1.0
Requires Plugins: desktop-mode
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Save a 1999 sky log in a 90-second Breakout-style game for Desktop Mode, with leaderboards and score-to-beat challenges.

== Description ==

Popup Siege is a companion game for Desktop Mode.

Move the paddle, steer the ball into four invasive popup X targets, and clear
all 30 corruption bricks before the connection or your three lives run out.
Closing a popup purges nearby bricks and starts a temporary multiball.

Desktop Mode supplies the Games hub, unified leaderboard, play-time tracking,
and player-to-player score challenges. The game runtime is loaded only when a
player presses Play.

== Installation ==

1. Install and activate Desktop Mode.
2. Install and activate Desktop Mode — Popup Siege.
3. Open OS Settings in Desktop Mode.
4. Under Features → Extended options, turn on Games.
5. Open the Games desktop icon and choose Popup Siege.

== Frequently Asked Questions ==

= Why does Popup Siege not appear after activation? =

Desktop Mode's Games framework is opt-in. Turn on Games under OS Settings →
Features → Extended options.

= Does this bundle its own copy of PixiJS? =

No. Popup Siege uses Desktop Mode's shared PixiJS module.

= How are scores checked? =

The plugin validates the exact terminal result schema and recomputes popup
points, objectives, restoration, bonuses, and the final score. This is a
friendly arcade plausibility check, not a server-authoritative replay.

== Changelog ==

= 0.1.0 =

* First standalone Desktop Mode release of Popup Siege 0.7.0.
* Added leaderboards, play-time tracking, and score-to-beat challenge support.
* Added strict server-side terminal result validation.
