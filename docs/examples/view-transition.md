# Register a custom view transition

**Status:** Experimental

A **view transition** is a whole-surface animation played through the
browser's [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)
while the shell changes state — the desktop you were on becoming the
desktop you switched to, or the window you clicked becoming a
maximized one. The browser snapshots the surface before and after the
change and animates one into the other; a transition says how.

The user picks one in **OpenStation Preferences → Effects → "View
transitions"**, with a global speed next to it. The 27 built-ins are
registered through exactly the API below.

> **Not the same as a [window reveal](./window-reveal.md).** A reveal
> uncovers *one window's content* after it loads. A transition animates
> *the change itself*. They compose fine — a desktop switch can play a
> transition, and a window loading inside it can play a reveal.

## The whole idea: a transition is CSS

The def is metadata. The motion lives in your own stylesheet, matched
by the **view-transition type** the shell activates for the run. You
never write an `Animation`, never own teardown, and never handle
interruption — the browser scopes the type to the transition's
lifetime, so one that is skipped or aborted leaves nothing behind.

```javascript
wp.os.ready( () => {
    wp.os.registerViewTransition( {
        id:          'acme/swoosh',
        label:       'Swoosh',
        description: 'Everything leans out of the way and the new screen skids in.',
        duration:    480,
        owner:       'my-plugin-transitions',
    } );
} );
```

```css
/* Your id, prefixed and slash-flattened: acme/swoosh → os-vt-acme-swoosh.
 *
 * The `:is()` is not decoration. The second selector is the fallback
 * the shell switches to on engines that have view transitions but not
 * view-transition TYPES, and `:is()` parses forgivingly — an engine
 * that has never heard of `:active-view-transition-type()` drops that
 * argument and still matches the attribute, where a plain comma would
 * throw away the whole selector list. */
html:is(
	:active-view-transition-type( os-vt-acme-swoosh ),
	[data-os-vt="acme/swoosh"]
)::view-transition-old( root ) {
	animation: acme-swoosh-out var( --os-vt-duration ) var( --os-vt-easing ) both;
	/* See "Two things that will bite you" below. */
	mix-blend-mode: normal;
}

html:is(
	:active-view-transition-type( os-vt-acme-swoosh ),
	[data-os-vt="acme/swoosh"]
)::view-transition-new( root ) {
	animation: acme-swoosh-in var( --os-vt-duration ) var( --os-vt-easing ) both;
	mix-blend-mode: normal;
}

@keyframes acme-swoosh-out {
	from { transform: translateX( 0 ) skewX( 0deg ); opacity: 1; }
	to   { transform: translateX( -30% ) skewX( 8deg ); opacity: 0; }
}

@keyframes acme-swoosh-in {
	from { transform: translateX( 30% ) skewX( -8deg ); opacity: 0; }
	to   { transform: translateX( 0 ) skewX( 0deg ); opacity: 1; }
}
```

Enqueue that stylesheet however you normally would — it is an ordinary
admin stylesheet, and it only ever matches while your transition is
running.

## What the shell publishes for you

On `<html>`, for the duration of the run, then removed:

| Property | Carries |
|---|---|
| `--os-vt-duration` | The resolved duration, e.g. `480ms`. **Read this rather than hard-coding a number** — it already has the user's speed override folded in. |
| `--os-vt-easing` | The resolved easing. |
| `--os-vt-x` / `--os-vt-y` | Pointer origin in viewport px. Only for `usesPointer: true` defs. |
| `--os-vt-mesh`, `--os-vt-accent`, `--os-vt-surface` | The resolved brand palette, lifted up from `body.os-active` — the pseudo-element tree inherits from the *root* element and cannot reach the palette on its own. |

## Two things that will bite you

**1. `new` paints on top of `old`.** They are siblings inside
`::view-transition-image-pair( root )`, and the new one comes second. A
transition where the OLD surface does the moving — any wipe, any
"uncover" — has to raise it:

```css
html:active-view-transition-type( os-vt-acme-wipe )::view-transition-old( root ) {
	z-index: 2;
	animation: acme-wipe var( --os-vt-duration ) both;
}
```

Without it your animation runs perfectly, underneath the thing it is
supposed to be uncovering, and nothing appears to happen.

**2. The UA puts both snapshots in `mix-blend-mode: plus-lighter`** so
its own crossfade sums to exactly 1.0 with no dip in the middle. That is
right for a fade and wrong for everything else: two opaque surfaces
sliding past each other in `plus-lighter` glow white where they overlap.
Set `mix-blend-mode: normal` unless your transition really is a fade.

## Growing out of the click

Set `usesPointer: true` and the shell publishes where the user last
pressed, so the transition reads as caused by what they clicked rather
than as decoration that happened afterwards. It falls back to the
viewport centre for keyboard-driven runs, so you never handle a missing
origin.

```javascript
wp.os.registerViewTransition( {
	id:          'acme/bloom',
	label:       'Bloom',
	usesPointer: true,
	duration:    600,
} );
```

```css
html:active-view-transition-type( os-vt-acme-bloom )::view-transition-new( root ) {
	animation: acme-bloom var( --os-vt-duration ) cubic-bezier( 0.22, 1, 0.36, 1 ) both;
}

@keyframes acme-bloom {
	from { clip-path: circle( 0 at var( --os-vt-x, 50vw ) var( --os-vt-y, 50vh ) ); }
	to   { clip-path: circle( 150vmax at var( --os-vt-x, 50vw ) var( --os-vt-y, 50vh ) ); }
}
```

## Direction, and the types the shell adds

Direction is **not** a field on your def. The caller knows whether the
user went to the next desktop or the previous one, and publishes it as
a context type — so you declare the forward form once and mirror it:

```css
html:active-view-transition-type( os-vt-acme-swoosh ):active-view-transition-type( os-vt-backward )::view-transition-old( root ) {
	animation-name: acme-swoosh-out-reverse;
}
```

| Type | Meaning |
|---|---|
| `os-vt-on` | Every run. Where the shell's shared setup lives — bind your keyframes to your own type, not this one. |
| `os-vt-desktop` | The active virtual desktop changed. |
| `os-vt-appearance` | Wallpaper, accent, desktop theme, dock placement or layout changed. |
| `os-vt-window` | One window changed. Also switches on per-window `view-transition-name: match-element`. |
| `os-vt-open` / `-close` / `-minimize` / `-restore` / `-maximize` | Which window moment this is. |
| `os-vt-preview` | Played from the Preferences panel rather than by a real state change. |
| `os-vt-forward` / `os-vt-backward` | Direction hint. |

You can also declare your own extra types with `types: [ … ]` — the way
a family of transitions shares one chunk of CSS. The built-in `cube`,
`flip` and `fold` all declare `os-vt-3d`, which is where the perspective
and `transform-style` live, written once.

## Window transitions

`scope: 'element'` puts a transition in the **window** family instead of
the screen family. There are two settings, and this is what decides
which selector yours appears in:

| `scope` | Setting | Plays on |
|---|---|---|
| `'root'` (default) | Screen transitions | Switching Space; any appearance change |
| `'element'` | Window transitions | A window opening, closing, minimizing, restoring, maximizing |

Two rather than one because the two questions have no overlapping good
answers: a cube rotation is right for "the screen changed" and absurd
for "a window opened", where it would freeze and rotate the whole desk
to animate one corner of it.

**You get the launcher morph for free.** When a window opens, the shell
pairs it with whatever the user last pressed — the dock tile, the
wallpaper icon, your own button — so the window's box interpolates out
of it. Your def does not arrange this and cannot break it: the pairing
decides *where* the window comes from, your CSS decides *how* it
arrives. Mark your own launcher with `data-os-vt-launcher` and it joins
in with no JS at all.

Two classes matter:

- `.os-vt-card` — every open window. The shell already holds these
  still, so the seven windows that merely happen to be on screen do not
  flicker while the eighth opens.
- `.os-vt-morph` — **the** window this transition is about. That is the
  one you style.

```javascript
wp.os.registerViewTransition( {
	id:       'acme/squash',
	label:    'Squash',
	scope:    'element',
	duration: 380,
} );
```

```css
html:active-view-transition-type( os-vt-acme-squash )::view-transition-new( .os-vt-morph ) {
	animation: acme-squash-in var( --os-vt-duration ) both;
}

html:active-view-transition-type( os-vt-acme-squash )::view-transition-old( .os-vt-morph ) {
	animation: acme-squash-out var( --os-vt-duration ) both;
}

@keyframes acme-squash-in {
	from { transform: scaleY( 0.8 ) scaleX( 1.1 ); opacity: 0; }
	to   { transform: none; opacity: 1; }
}

@keyframes acme-squash-out {
	from { transform: none; opacity: 1; }
	to   { transform: scaleY( 0.8 ) scaleX( 1.1 ); opacity: 0; }
}
```

Both sides, because the same def plays in both directions: `new` is the
arrival (open, restore, maximize) and `old` is the departure (close,
minimize). If you want them to differ per moment, key off the lifecycle
context types — `os-vt-open`, `os-vt-close`, `os-vt-minimize`,
`os-vt-restore`, `os-vt-maximize`:

```css
html:active-view-transition-type( os-vt-acme-squash ):active-view-transition-type( os-vt-minimize )::view-transition-old( .os-vt-morph ) {
	animation-name: acme-squash-down;
}
```

Under the hood the `os-vt-window` type switches on
`view-transition-name: match-element` for every window (unique names, no
bookkeeping), plus `view-transition-class: os-vt-card` and
`view-transition-group: contain` — so any named element a plugin puts
*inside* a window nests in that window's group and travels with it
rather than flying independently across the desk.

**The title bar is deliberately left unnamed**, except while maximizing.
Naming an element lifts it out of its ancestor's snapshot into a group
of its own, and for a window that is opening that is exactly wrong: the
title bar has no "old" side to interpolate from, so it appears instantly
at final size while the body scales up underneath it — two pieces
arriving on different schedules. Unnamed, it is captured inside the
window image and scales with it, so title text, controls and tab strip
all zoom out of the icon together. Maximize is the one case that wants
the opposite (the bar should keep its height and just widen), and gets
its own nested group under the `os-vt-maximize` type.

## Playing one around your own change

Any plugin can animate its own DOM mutation with the user's chosen
transition — or a named one:

```javascript
await wp.os.runViewTransition( {
	update: () => panel.replaceChildren( nextView ),
	types:  [ 'acme-panel' ],
} );
```

`update` runs **exactly once**, animated where the browser, the user's
motion preference and their selection all allow it, and plainly where
they do not. You never branch on support. It resolves to
`{ animated, reason }` if you want to know which happened.

Pass `whenBusy: 'drop'` for a background change that must land but must
not fight for the screen; the default (`'skip'`) finishes any in-flight
transition immediately and starts yours, which is what a user holding a
shortcut key wants.

## What you get for free

- **Four-tier graceful degradation** — no `startViewTransition`, no
  types, no element-scoped transitions, no `activeViewTransition`: each
  missing piece costs one step of fidelity, never the state change.
- **`prefers-reduced-motion` skips the animation entirely.** Deliberately
  total: a view transition moves the whole surface the user is reading,
  and there is no reduced version of that which is still the transition.
- **The user's speed override**, already folded into
  `--os-vt-duration`.

## Housekeeping

Set `owner` to your script handle so the transition can be swept on
deactivation. Registration is JS-only for now — there is no
`openstation_register_view_transition_script()` PHP companion yet, so a
transition from a plugin activated mid-session appears in the selector
after a reload (the same known gap as window reveals and palettes).

To reorder, remove, or conditionally swap transitions — including the
built-ins — filter the registry:

```javascript
wp.os.addFilter( 'os.view-transitions', 'acme/only-calm', ( list ) =>
	list.filter( ( t ) => ! [ 'glitch', 'warp' ].includes( t.id ) )
);
```

## See also

- [`docs/javascript-reference.md`](../javascript-reference.md) — the full
  `registerViewTransition` / `runViewTransition` contract, and the
  cross-document transitions that animate page-to-page navigation
  *inside* a window.
- [`docs/examples/window-reveal.md`](./window-reveal.md) — the other
  animation layer, for a window's content finishing its load.
