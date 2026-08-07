/**
 * mio-js — the empty module every unused PixiJS feature resolves to.
 *
 * PixiJS registers its features by side effect: `lib/index.mjs`
 * imports two dozen `init.mjs` files, each of which calls
 * `extensions.add( … )` with the pipes and systems for one feature —
 * text, events, meshes, compressed textures, and so on. Those init
 * files are named in Pixi's own `sideEffects` allowlist, which is
 * exactly right and is also why a bundler cannot tree-shake any of
 * them: a side effect is by definition something rollup must keep.
 *
 * The pipes are what pull the weight. `scene/text/init.mjs` is four
 * lines; the text renderer, the canvas text measurer and the font
 * machinery behind them are 127 kB. Registering a pipe Mio will never
 * hand a renderable to costs the whole subtree.
 *
 * So the build redirects the registrations Mio doesn't need to this
 * file, which registers nothing. The classes stay exported from the
 * barrel and are dropped normally by tree-shaking once nothing
 * references them. See `PIXI_UNUSED` in `vite.config.js` for the list
 * and the reasoning per entry.
 */

export {};
