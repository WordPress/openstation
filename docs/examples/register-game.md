# Register a game

The **Games** window on the wallpaper (gamepad icon) is registry-driven: every registered game becomes a launcher tile, gets a tab in the unified scoreboard, and can be played in score-to-beat challenges between users. Registration is two-sided, like wallpapers and widgets: **PHP declares the metadata** (so the launcher and scoreboard paint at boot without downloading game code) and **JS supplies the render callback** (loaded lazily on first launch).

Only server-registered games can persist scores and challenges — the REST routes 404 unknown game ids.

The games framework is **opt-in and off by default** — an admin enables it site-wide in OS Settings → Features → Extended options (or via the `openstation_games_enabled` filter). While it's off, none of the games module loads — `openstation_register_game()` is undefined, exactly as if OpenStation weren't active. The `function_exists()` guard in the recipe below covers both cases; saved scores and play time survive a disable/re-enable round trip untouched.

---

## Recipe — a minimal game

**my-plugin.php**

```php
<?php
/** Plugin Name: My Game */
defined( 'ABSPATH' ) || exit;

add_action( 'init', function () {
    if ( ! function_exists( 'openstation_register_game' ) ) {
        return; // OpenStation not active.
    }

    // The handle is NOT enqueued — the shell fetches it lazily the
    // first time someone presses Play.
    wp_register_script(
        'my-plugin-tap-game',
        plugins_url( 'tap-game.js', __FILE__ ),
        array( 'openstation' ),
        '1.0.0',
        true
    );

    openstation_register_game( 'my-plugin-tap', array(
        'title'         => __( 'Tap', 'my-plugin' ),
        'description'   => __( 'Tap the dot before it fades.', 'my-plugin' ),
        'icon'          => 'dashicons-marker',
        'script'        => 'my-plugin-tap-game',
        'score_columns' => array(
            array( 'key' => 'score', 'label' => __( 'Score', 'my-plugin' ), 'type' => 'number' ),
            array( 'key' => 'taps',  'label' => __( 'Taps', 'my-plugin' ),  'type' => 'number' ),
            array( 'key' => 'time',  'label' => __( 'Time', 'my-plugin' ),  'type' => 'time' ),
        ),
        // Arbitrary blob handed to the game's launch context.
        'config'        => array(
            'roundsUrl' => plugins_url( 'rounds.json', __FILE__ ),
        ),
    ) );
}, 20 );
```

**tap-game.js**

```javascript
// Publish the full def on the games global — the analogue of
// window.openStationWallpapers for wallpapers. The framework merges
// this with the server metadata (server wins for title/icon/etc.).
window.openStationGames = window.openStationGames || {};
window.openStationGames[ 'my-plugin-tap' ] = {
    id: 'my-plugin-tap',
    title: 'Tap',
    icon: 'dashicons-marker',
    scoreColumns: [ { key: 'score', label: 'Score', type: 'number' } ],
    window: { width: 640, height: 480, minWidth: 400, minHeight: 320 },

    render( ctx ) {
        // ctx.container — the native window body (yours until teardown)
        // ctx.config    — the PHP-registered blob ({ roundsUrl })
        // ctx.challenge — set when this run is an accepted challenge:
        //                 { id, scoreToBeat, scoreMeta, challengerName }
        const button = document.createElement( 'button' );
        button.type = 'button';
        button.textContent = 'Tap!';
        let score = 0;
        button.addEventListener( 'click', () => {
            score += 10;
            if ( score >= 100 ) {
                // Persist the run: leaderboard in free play, the
                // challenge-completion endpoint in challenge mode.
                // Keys in `meta` line up with `score_columns`.
                void ctx.submitScore( {
                    score,
                    meta: { taps: score / 10, time: 12 },
                } );
                ctx.close();
            }
        } );
        ctx.container.appendChild( button );

        // Teardown runs on EVERY close path — stop loops here.
        return () => button.remove();
    },
};
```

That's the whole integration. For free you get:

- a launcher tile in the Games window (live — activating your plugin mid-session adds the tile without a reload; deactivating removes it);
- a detail panel when your game is selected — description, **Play**, and **Challenge** (the latter throws down the player's best score), plus a scoreboard with your declared columns, a Player column (name + avatar + presence dot), and a Date column;
- score persistence (`POST /desktop-mode/v1/games/{game}/scores`, always credited to the submitting session);
- challenges: any player can pick one of their scores and challenge another user; recipients get a notification + **Accept & Play** toast, and your game sees `ctx.challenge` during the run;
- wallpaper suspension while your game's window is open (the framework holds `wp.os.wallpaper.suspend( 'game:<windowId>' )` and releases it on every close path);
- play-time tracking: the framework measures how long each player keeps your game's window open (the clock pauses while it's minimized) and accumulates per-user lifetime totals plus daily buckets — shown Steam-style on your game's detail panel ("Play time (last two weeks)" / "Play time (total)"), readable via `wp.os.games.getPlaytime()` / `openstation_games_get_playtime( $user_id, $game )` / `openstation_games_get_playtime_daily( $user_id, $game )`.

---

## Tuning and policy hooks

```php
// Anti-cheat / plausibility gate — return a WP_Error to reject a save.
add_filter( 'openstation_game_score_pre_save', function ( $pre, $game, $user_id, $score ) {
    if ( 'my-plugin-tap' === $game && $score > 100000 ) {
        return new WP_Error( 'implausible', 'No.' );
    }
    return $pre;
}, 10, 4 );

// Block challenges (do-not-disturb, roles…).
add_filter( 'openstation_games_can_challenge', function ( $allowed, $challenger_id, $recipient_id ) {
    return get_user_meta( $recipient_id, 'dnd', true ) ? false : $allowed;
}, 10, 3 );

// React to finished runs.
add_action( 'openstation_game_score_saved', function ( $id, $game, $user_id, $score ) {
    // e.g. award a badge at 10k.
}, 10, 4 );

// React to accumulated play time — e.g. a dedication badge at 10 hours.
add_action( 'openstation_game_playtime_recorded', function ( $game, $user_id, $seconds, $total ) {
    if ( 'my-plugin-tap' === $game && $total >= 10 * HOUR_IN_SECONDS ) {
        // …
    }
}, 10, 4 );
```

The built-in **Inkfall** typing game (`src/games/inkfall/`, registered in `includes/games/inkfall.php`) is the full-fat reference: PixiJS rendering, the framework dictionary via the injected `config.wordsUrl` (every server-registered game receives it — see `openstation_games_words_url` in the hooks reference), challenge-mode HUD, and pure, unit-tested gameplay modules. The second built-in, **Alphabet Soup** (`src/games/alphabet-soup/`), shows the seeded-daily-puzzle pattern (same grid worldwide from a `dd-mm-yyyy` date seed), a Time Attack countdown mode, and the game-over share-card image (`src/games/share-card.ts`).
