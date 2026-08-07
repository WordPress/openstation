# Popup Siege 0.7.0 scoring and integration audit

## Source boundary

Historical versioned layers through 0.6.1 remain byte-identical custody
evidence. Rules v3, UI system 0.7.0, Audio 0.7.0, and Game Kit 0.1.1 are new
versioned layers. The deterministic browser bundle records hashes for every
input and is the adapter's single production runtime request.

## Lifecycle

Each launch receives a fresh mount. The adapter uses the rules-v3 state
subscription, unregisters native window lifecycle handlers, disconnects its
resize observer, tears down the game and audio owners, and clears the container
when OpenStation closes the game. A failed runtime load clears its promise so
a later launch can retry.

## Score submission

Submission starts only after the simulation enters its results phase. The
payload is frozen before submission. A failed save exposes an accessible retry
control. Free Play may begin a new round and submit a new result; a Challenge
launch hides and blocks replay after its first completed result.

## Server checks

The score filter preserves an existing `WP_Error`, applies manifest score
bounds, requires the exact flat rules-v3 terminal schema, rejects non-integers
and out-of-range components, recomputes the score total and popup points, and
checks closed identities, objective states, restored percentage, clear bonus,
and archive-sweep, timeout, or lives outcomes.

This is plausibility validation for a friendly arcade game, not
server-authoritative replay verification.

## Open gate

Automated rules, lifecycle, source-integrity, packaging, and accessibility
checks are required for release. Fresh independent human fun proof remains a
clearly labeled pending gate.
