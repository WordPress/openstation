# Popup Siege 0.7.0 game brief

## Status

- Build: Studio-authored rules-v3 arcade candidate with an OpenStation score
  and challenge adapter.
- Current registered candidate: `games/popup-breaker/game.php`, version 0.7.0.
- Current presentation owner: `standalone/popup-breaker-0.7.0.css`.
- Production registration: Game Lab demo only; not promoted into Desktop Mode
  core.
- Fresh Human Fun Proof: not run.
- Production art: blocked until Fresh Human Fun Proof passes.
- Historical 0.1.0–0.6.1 wrappers, styles, runtimes, and Imagegen assets remain
  available as custody evidence.
- The current prototype runtime loads blank generated shell imagery while all
  words, values, controls, states, collision geometry, and focus remain live.
- Human calibration: the core game and visual design are approved for the demo;
  skill-based control, truthful objectives, restoration payoff, and replay
  clarity are the 0.7 acceptance targets.
- OpenStation Game Kit 0.1.0 remains an internal authoring candidate, not a
  promised public SDK.
- OpenStation Audio Kit 0.1.0 is the dependency-free pilot for scheduled music,
  music/effects buses, ducking, and lifecycle-safe teardown.

## Player promise

Mira Santos' fictional October 1999 astronomy homepage is the last page waiting
for an archive snapshot. Adware has taken over. Keep the ball alive, close four
popup X targets, and use the resulting cache bursts and multiballs to restore
the page before the connection fails.

The story is one sentence of stakes. No historical or technical knowledge is
tested.

## 0.7.0 agency and truthful-finale pass

The 0.7 candidate keeps the traditional Breakout verb and the established
right-side rescue-console object, but treats a hands-off clear as a failed
gameplay test. Paddle placement must materially change the ball's return angle;
specific popup threats own specific objectives; the Archive Sweep cannot claim
progress after its terminal snapshot is frozen; and simultaneous final events
resolve through one deterministic terminal arbiter.

The candidate also makes the premise pay off. Closing a threat exposes a
restored slice of Mira's page, the final state reveals the recovered page or
the first unfinished rescue task, and Results records the terminal snapshot
and score components that produced the displayed total. Challenge runs show
their target before play and their beaten, tied, or missed outcome at Results.

The supported OpenStation host is 520 × 480 or larger. The console stays on the
right at every width; smaller hosts are contained and explicitly unsupported
rather than silently switching to a different composition. All live controls
project above 44 CSS pixels at the supported minimum.

The release evidence is separated by cohort:

- Author/automated evidence may establish deterministic rules, schema,
  accessibility geometry, loading, teardown, and screenshot identity.
- An independent native-size reviewer may approve presentation evidence.
- Only Fresh Human Fun Proof may establish comprehension, agency, voluntary
  replay, and fun. That cohort remains pending.
- Imagegen remains deferred until the fun gate passes; it must not decorate a
  loop that still needs structural change.

## Fun hypothesis

Players will enjoy steering a familiar Breakout ball toward invasive popup X
targets because every close immediately destroys nearby corruption and creates
temporary multiball chaos, and they will feel a rising sense of rescue through
large state changes, visible page recovery, and a concise result.

The hypothesis fails if a fresh player cannot identify the X as the priority
target by the second wave, if ordinary runs expose fewer than three X targets,
or if understanding a loss does not produce voluntary replay.

## Core loop

`read ball and popup → place paddle → steer rebound → hit X → cache burst + multiball → re-plan`

- One direct verb: move the paddle.
- One pressure source: three lives inside a 90-second run.
- One principal objective: close all four popup X targets while clearing the
  corruption wall.
- One win: clear all thirty bricks after all four popups have closed.
- One recoverable failure: the timer or lives end the run with an exact score,
  restored percentage, popup count, and immediate replay.

## Signature-mechanic budget

| Wave | Active time | Targets | Change |
|---|---:|---:|---|
| Download trap | 3 s | 1 large stationary X | teaches the collider |
| Toolbar swarm | 12 s | 2 smaller stationary X targets | forces prioritization |
| Malware boss | 24 s | 1 moving large X | tests tracking under pressure |

Popup windows persist until closed or the run ends. They never silently expire.
The visual window body is deliberately non-colliding; only the visible X is a
collider. This fixes the 0.1.x geometry bug where a shot rising from below hit
the popup body before it could physically reach the X.

Every close:

- awards 750 points, or 1,100 for the boss;
- purges the nearest three corruption bricks, or four for the boss;
- awards 150 points per purged brick;
- spawns one additional ball, up to three balls;
- starts or refreshes an eight-second multiball window;
- produces a restrained hit pause, particle burst, sound, HUD change, and
  status sentence.

## 0.2.1 rough-edge pass

The 0.2.1 polish layer deliberately preserves the 0.2 rules and scoring.

- Every popup gets a code-native dashed ghost boundary and a pulsing corner
  reticle around the real X collider. The shape—not color or copy alone—now
  distinguishes the pass-through window from its solid target.
- The help and live message moved into a compact browser-owned status rail.
  The former outer footer could overlap the playfield and clip at the viewport
  edge.
- Wave arrival is derived from the wave state, not only `lastEvent`. A brick
  collision can replace the wave event inside the same fixed simulation step,
  so the essential “red X only” message now has a short priority hold.
- Popup-close copy also keeps a short priority hold over routine brick and
  paddle messages, while a miss, pause, resume, or terminal result can still
  interrupt it.
- The cache meter is active only while more than one playable ball exists.
  The underlying timer can outlive both spawned balls after a miss and must not
  claim that multiball is still usable.
- Pause is hidden when it has no effect and becomes a real Pause/Resume toggle
  during a run.
- Portrait browser chrome no longer stretches beyond the stage. The complete
  browser object is vertically balanced in the remaining compact viewport.

## 0.3.0 adaptive-audio pass

The 0.3.0 layer preserves the exact 0.2 rules and 0.2.1 target presentation.
It changes only audio presentation, audio controls, one browser-address joke,
and Results focus behavior.

- “Skylog Midnight MOD” is a 120 BPM, 32-bar, E-Dorian tracker-style score
  generated locally with Web Audio. It has no streamed or downloaded asset.
- The tempo stays fixed. Drums, bass, chords, Mira's five-note sky motif,
  adware interference, cache arpeggios, pressure ticks, and boss accents enter
  or leave from durable game state.
- The playable cache condition is still `balls.length > 1` with a positive
  timer. A stale timer cannot activate either the meter or the music layer.
- Popup closes brighten Mira's motif and get a short rising stinger plus music
  duck. Life loss, wave arrival, boss arrival, win, and loss have distinct
  compact musical responses.
- Menu is silent. Music is unlocked only by deliberate player input, pauses
  with the simulation, and is torn down with the game.
- Music and Effects are separately controllable. Every essential event remains
  visual and textual with both off.
- Results still move programmatic focus to the result heading once for
  assistive technology. The Chromium outline is suppressed only on that static
  heading, and the fixed-step loop no longer steals focus back from Play Again.
- Programmatic playfield and Results focus uses `preventScroll`; an
  `overflow: hidden` game host can still be scrolled by focus and otherwise
  push the header offscreen even when the document itself has no overflow.
- The visible fake address is
  `geocities.com/CapeCanaveral/Launchpad/404/definitely_not_aliens/`.

The research, tool comparison, composition contract, and next production path
are recorded in `music-direction-0.3.0.md`.

## 0.4.0 header and control-deck pass

The 0.4.0 layer preserves the exact 0.2 rules, 0.2.1 behavior, and 0.3 audio
system. It changes only the header, its labels, and responsive fit.

- One Imagegen UI study answered a named composition question. It is archived
  with prompt, dimensions, hash, and five-pass critique, but it is not loaded
  by the game.
- The implemented header is one code-native 1999 shareware control deck:
  identity plaque, integrated four-segment instrument display, and coherent
  control cluster.
- Music, Effects, Pause/Resume, and Close use large glyphs plus short labels.
  Desktop controls are 62 × 64 CSS pixels; the smallest supported portrait
  controls remain 46 × 50.
- The menu hides only Pause because it has no effect. Live and paused states
  keep all four operational controls visible.
- Music and Effects have explicit stateful accessible names. Pause changes to
  `Resume game`; Close is `Close game`.
- The header, fake browser, and status rail fit without page overflow at
  771 × 863 desktop, 390 × 844 portrait, and 844 × 390 short landscape.
- The pass repaired a cumulative-style bug: the 0.3 version marker prevented
  the earlier version-qualified browser-rail layout from applying, stretching
  the rail and clipping the game. The 0.4 layer deliberately re-expresses the
  required browser and rail rules; the reusable skills now recommend stable
  feature selectors for future cumulative layers.

Imagegen's strong three-block hierarchy, large-icon scale, grouped controls,
and semantic colors were retained. Its generated text, body changes, repeated
screws, and wall-to-wall metal bevels were rejected.

## 0.4.1 control-deck correction

The user's first comparison correctly favored the Imagegen picture. The
initial browser tab was also stale on 0.3.0, which made the visible gap much
larger than the current files implied. Reloading exposed 0.4.0, but a direct
native-size comparison still found that the implementation had copied the
picture's arrangement while weakening its finish.

The 0.4.1 presentation preserves the 0.4 layout and every game/audio rule, then
restores the picture's decisive qualities:

- one dark integrated chassis with a restrained metal edge and four corner
  fasteners;
- a substantially larger yellow `POPUP SIEGE` title and centered mint
  `ARCHIVE RESCUE` signature;
- deeper segmented instrument glass with amber labels and large mint values;
- a framed control bay with mounted cream-on-green Music and FX buttons,
  code-native speaker icon, amber Pause/Resume, and red Close;
- three wide controls when Pause is unavailable, then four equal controls
  during play and pause;
- 50 × 76 CSS-pixel live controls at 771 × 863, 44 × 48 in portrait, and at
  least 44 × 44 in short landscape.

The implementation uses a stable `siege-game--control-deck-041` feature class
and `data-build-version="0.4.1"` while retaining the cumulative 0.4 asset
marker. This prevents the visual layer from erasing the earlier layout contract.

The fake browser ends at 853.5 CSS pixels inside the 863-pixel desktop
viewport and at 836.8 inside the 844-pixel portrait viewport. Neither document
overflows.

## 0.4.2 single-chassis correction

The user rejected 0.4.1 as still needing header work. A new header-only
Imagegen study and independent game-team passes identified the remaining
problem as structural, not ornamental: brand, HUD, and actions were flat peer
nodes with matching heavy frames and open gaps, so CSS polish still produced
three widgets instead of one control console.

The 0.4.2 enhancer moves the existing live brand, HUD, and action nodes into
one reversible `.siege-header__chassis`. No nodes are cloned, so cached
counters, delegated actions, labels, focus, Pause availability, and audio
states keep their original behavior. The new layer:

- gives the header one centered outer silhouette and one set of outer hardware;
- makes the larger yellow wordmark the first read;
- treats the four HUD cells as one continuous glass instrument with quiet
  dividers;
- keeps button depth inside one restrained control bay;
- preserves three menu controls and four live/paused controls;
- uses explicit desktop, portrait, and short-landscape grid areas instead of
  inheriting placement from older layers;
- uses a zero-minimum flexible instrument column so medium windows shrink
  instead of expanding the root and bypassing their own responsive breakpoint.

Rendered checks preserve no document overflow and controls of 45.5 × 48 CSS
pixels or larger in 390 × 844 portrait, and 47.75 × 44 or larger in 844 × 390
short landscape. The generated header pixels remain outside runtime; only the
accepted enclosure, proportion, value, and material relationships were
translated into DOM/CSS.

## 0.4.3 browser-medic correction

The user's response to 0.4.2 exposed a deeper cohesion problem. A unified
chassis was still a separate, browser-width utility bar floating above the
premise hero. A new Imagegen study and independent game-team review converged
on a more specific object: a molded 1999 browser-rescue appliance physically
attached to Mira's fake browser.

The 0.4.3 enhancer preserves every rule and moves the existing live header
inside `.siege-browser` before its bar. It does not clone the brand, HUD, or
controls, so values, labels, focus, delegated clicks, and audio state keep the
same identity. Teardown restores the header to its original parent and
position.

The code-native translation:

- gives normal desktop views a 700 × 96 cream marquee that overhangs the
  narrower browser;
- increases the two-line yellow wordmark and mint instrument values at the
  real viewing scale;
- uses one horizontal identity → instrument glass → control-bank composition;
- adds only two quiet connector tabs between marquee and browser;
- keeps the same live controls at 44 CSS pixels or larger;
- returns to a compact top deck below 430 pixels wide;
- docks the same header beside the playfield below 650 pixels high;
- explicitly assigns the legacy status rail to its responsive grid area so an
  implicit row cannot stretch into empty beige space.

The generated 0.4.3 PNG remains an archived direction study and is never loaded
by the game. The current human verdict is refine: “Better but not perfect.”

## 0.4.4 literal Imagegen-shell translation

The remaining gap was translation fidelity. The 0.4.3 CSS preserved the
concept's palette and arrangement but rebuilt its most distinctive material
and silhouette choices as generic rectangles. The code looked inspired by the
picture instead of derived from it.

The 0.4.4 pass separates decoration from operation:

- Imagegen produced one blank 2172 × 724 molded shell with a left marquee
  recess, one horizontal four-cell HUD glass, four empty physical key wells,
  and two browser clamps;
- a rejected three-key generation was corrected before implementation;
- the chroma-key source was converted locally to an alpha PNG and validated at
  the real 840-pixel display size;
- every word, number, icon, state, accessible name, focus ring, and pointer
  target remains live DOM over the blank shell;
- the generated shell applies only above 800 pixels wide and 650 pixels high;
  portrait, short landscape, and forced-colors keep code-native presentation;
- an explicit zero-minimum browser column prevents inherited content minimums
  from widening the stage past its measured container.

At 1280 × 720, the shell is 840 pixels wide, all four live controls are about
50.8 × 86 CSS pixels, the complete browser ends at 711.8 pixels, and the
document has no overflow. The asset is prototype runtime art, not production
approval; Fresh Human Fun Proof remains the next release gate.

## 0.4.5 OpenStation viewport correction

The first real OpenStation capture exposed two integration failures that the
standalone candidate did not:

- the 900 × 900 launch window extended behind the large OpenStation dock;
- the 840-pixel horizontal header became a detached billboard above a much
  narrower browser.

The 0.4.5 presentation keeps rules-v2 unchanged and corrects the real host:

- the OpenStation launch window is 900 × 620 instead of 900 × 900;
- the adapter caps only its owned host to the visible viewport above a
  112-pixel large-dock band when the container would extend behind it;
- 900-pixel-wide viewports at 780 pixels high or shorter use one generated
  vertical side console physically attached to the browser;
- the console contains exactly one blank title recess, one 2 × 2 HUD recess,
  and four 2 × 2 key wells, with all live DOM overlaid at measured positions;
- taller windows retain the horizontal shell, capped at 740 pixels instead of
  840 pixels;
- the funny GeoCities address is applied in the OpenStation adapter as well as
  the standalone wrapper.

At the dock-safe 900 × 640 proof size, the browser is 704 × 629 pixels, the
stage is 480 × 559 pixels, the side console is 224 × 595 pixels, the live
control faces are about 64 × 78 pixels, and document scroll extents equal the
viewport. This is rendered integration evidence, not Fresh Human Fun Proof.

## 0.4.6 live logo correction

The user selected the 0.4.5 side-console composition and rejected only its
compressed yellow logo. A built-in Imagegen edit established a clearer
hierarchy—small tracked mint `POPUP`, dominant warm `SIEGE`, cyan offset, and
one thin magenta rule—but drifted outside the allowed edit region. The image is
therefore retained only as a non-runtime direction study.

The shipped prototype rebuilds the accepted relationship as two explicit live
text spans. It adds no bitmap logo, false control, new game rule, or layout
change. The mark remains accessible as “Popup Siege” and has a forced-colors
fallback.

## 0.4.7 unconditional side-console correction

The user clarified that the selected console belongs on the right at every
width. The prior presentation changed back to a top header in tall standalone
windows and could miss its Imagegen side-console treatment when the usable
OpenStation content width fell just below a breakpoint.

The 0.4.7 layer removes that fallback. Browser, playfield, and side console now
scale together as one 704:629 appliance at every supported width. Its single
grid always uses `bar/header`, `stage/header`, and `rail/rail`; no responsive
rule moves the live header above the playfield. Rules, score, audio, logo,
controls, and the selected 0.4.5 shell remain unchanged.

## 0.4.8 measured control correction

The four live controls previously inherited padding, type, and narrow-layout
rules from several historical header treatments. That made their icons and
labels drift independently of the painted key faces. The 0.4.8 layer registered
one control-bank rectangle to the shell and gave every key the same 76/24
icon-label tracks and label baseline.

## 0.5.0 UI-system foundation

The 0.5.0 wrapper stopped loading the full historical CSS cascade. It loads
the frozen 0.2.0 structural foundation plus one presentation owner:
`standalone/popup-breaker-0.5.0.css`.

The stable `.siege-game--design-system-050` feature class owns the appliance,
shell, wordmark, instruments, control bank, browser chrome, gameplay target
feedback, responsive tuning, reduced motion, and forced colors. Normalized
geometry and state vocabulary live in
`assets/popup-siege-ui-system-0.5.0.json`; the CSS mirrors those tokens and
tests reject unused tokens, undefined tokens, duplicate declarations,
unscoped rules, localized state selectors, and historical CSS links in the
current wrapper.

Pause/Resume visuals derive from explicit `data-control-mode` state rather than
English accessible-name text. Music and FX use `aria-pressed` plus a visible
off treatment. The inactive menu Pause slot is visually distinct and cannot
leak into live play.

## 0.5.1 Imagegen sidebar refinement

The current wrapper preserves the 0.5.0 component selector and every gameplay,
audio, and accessibility rule while replacing its sidebar skin with a new
purpose-built Imagegen shell:

- warm ivory molded ABS separates the console from the navy playfield;
- a translucent grape-purple edge optically joins the appliance without
  obscuring the browser frame;
- dark navy title and instrument recesses keep live type legible;
- teal, purple, amber, and red physical key wells support the four live
  controls without generated icons, labels, values, or states;
- the live control bank is registered to the complete physical wells rather
  than only their colored inner faces, keeping the center and edge error within
  tolerance while preserving 44-pixel minimum targets at the 500-pixel
  appliance floor.

The mutable wrapper loads only the frozen 0.2.0 foundation and
`standalone/popup-breaker-0.5.1.css`. Geometry and state tokens live in
`assets/popup-siege-ui-system-0.5.1.json`; the build, prototype, UI-system,
asset, wrapper, and test markers advance together even though the stable
feature selector remains `.siege-game--design-system-050`.

## 0.6.0 objective-level and replay pass

The 0.6.0 layer turns the existing popup sequence into four named objectives
without changing physics, score, wave timing, lives, win conditions, or rules
version:

1. **Download Trap** — close the first red X.
2. **Toolbar Swarm** — close two more X targets.
3. **Malware Boss** — track and close the moving X.
4. **Archive Sweep** — clear the corruption that remains.

Progress comes from the durable popup-close count, so a transient collision
message cannot skip or rewind a level. Level changes use a short, non-modal
playfield strap; the ball, paddle, timer, and player input continue normally.
The browser rail keeps the current objective visible without competing with
score or controls.

Results now show the four-step journey, the exact point reached, and one
state-specific next-run instruction. The old generic results sentence is
hidden because it could contradict the new advice. **Run It Back** restarts and
starts a fresh run in one explicit click; **Back to Desktop** remains equally
available and pressure-free. The static Results heading receives programmatic
focus without a decorative focus outline, while real controls retain visible
keyboard focus.

Author play on the exact frozen wrapper reached all four levels, closed all
four popups, restored 97%, and verified the one-click replay path. This is
implementation evidence, not Fresh Human Fun Proof.

## Controls and feel

- Pointer and touch directly place the paddle under the finger. There is no
  artificial chase-speed lag.
- A/D and arrow keys use acceleration, top speed, and friction.
- The initial serve is nearly vertical and forgiving. Missed balls get a
  1.15-second visible recovery beat before relaunch.
- The fixed 1/120-second simulation renders with interpolation.
- Pixi uses a DPR-aware backing store capped at 2 and no pixelated CSS scaling.
- Ball trails, paddle response, brick damage, close bursts, optional effects,
  and adaptive music reinforce the same state changes.
- P or Escape pauses. Blur and hidden-tab events pause automatically.
- Music and effects are independent and optional.

## Mobile-game research translated into this build

Apple's current game-control guidance recommends direct interaction when it can
replace overlaid virtual controls, controls near natural reach, at least
44 × 44 points for frequently used controls, visible press states, and the
platform's default interaction method. Popup Siege therefore uses the whole
playfield as one direct touch surface instead of a virtual thumbstick, keeps
Pause and Close available on narrow screens. The selected shell preserves
44-pixel key targets down to an appliance width of roughly 500 pixels. Below
that, a separately generated compact side shell with larger normalized key
wells is required; the console must not move above the playfield and the
current build does not claim sub-500-pixel target compliance.

Microsoft's current game-accessibility guidance recommends alternative input
types, equivalent digital input for analog actions, redundant non-audio cues,
and the ability to stop moving content. Popup Siege gives touch/pointer and
keyboard equivalent paddle control, keeps every critical event visual and
textual when sound is off, and freezes the timer, boss, particles, and
simulation while paused.

Sources:

- <https://developer.apple.com/design/human-interface-guidelines/game-controls>
- <https://developer.apple.com/design/human-interface-guidelines/designing-for-games>
- <https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107>
- <https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/117>

## Visual direction

This is a professionally composed 1999 shareware arcade game running inside a
browser window, not a modern dashboard with retro decoration and not a full
screen of equally loud Windows 95 controls.

- Quiet navy OpenStation shell.
- One centered fake browser window.
- Story and target personality inside the playfield.
- Bright page fragments with a five-row content vocabulary.
- System-gray popup windows with cobalt or malware-red title bars.
- One red X target with a thick code-native border.
- DOM-owned title, HUD, start, pause, results, and status.
- Pixi-owned ball, paddle, bricks, popups, damage, and effects.

The 0.6.0 build retains the approved 0.5.1 warm-ivory and translucent-purple
Imagegen shell as the current prototype-runtime composition reference. It
keeps the stable 0.5.0 component
contract, code-native 0.4.6 wordmark, unconditional 0.4.7 side placement, and a
remeasured control bank registered to the new painted key wells. The 0.4.5
shell and all earlier studies remain archived history.
After Fun Proof, the
next production art pass may replace only a few large surfaces: page scenery,
popup villains, and result art. It must not replace target geometry, controls,
words, damage, or state cues.

## Fresh Human Fun Proof gate

Use at least five people who have not seen the build. Observe without coaching
in the exact registered OpenStation 0.6.0 runtime.

Pass only if:

- at least 4/5 start and understand paddle/ball play without coaching;
- at least 4/5 deliberately aim for a popup X by the second wave;
- at least 4/5 close at least one popup;
- at least 3/5 reach the boss or close three popups;
- at least 3/5 voluntarily start another run after understanding the result;
- at least 4/5 rate audiovisual fit at least 4/5;
- no more than 1/5 reports repetition fatigue or says music obscured a cue;
- clarity, responsiveness, agency, and outcome readability each average at
  least 4/5;
- overall Fun Proof average is at least 4/5;
- no more than 1/5 mistakes decoration for a collider or control.

Automation and author play prove implementation behavior only. They do not
prove silent comprehension, fun, or replay desire.

## Score contract

- Ordinary brick hit: row value from 80–140.
- Popup close: 750; moving boss: 1,100.
- Cache-purged brick: 150.
- Full clear: 20 × each remaining second + 500 × remaining lives.
- Survival time alone awards nothing.
- Higher is better; score is a non-negative integer.
- There is no submission, persistence, challenge, analytics, music streaming,
  or active-run network traffic in 0.4.2.
