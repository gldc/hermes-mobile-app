// src/lib/composer-height.ts
//
// Why the composer needs this (RN 0.85, Fabric, iOS): the multiline TextInput
// auto-grows natively (Yoga measures its text), but when the parent sets
// `value` from JS it keeps the height of the previous text: after a send's
// clear it stays at its last-grown height, and a multi-line restore (a failed
// steer) would show at one line.
//
// Fabric measures a TextInput from its shadow-node *state*
// (BaseTextInputShadowNode::measureContent -> attributedStringBoxToMeasure),
// and copies a new JS `value` into that state only in layout()
// (updateStateIfNeeded), which runs after Yoga has already measured the node
// for that commit. setStateData() there does not dirty the Yoga node, and the
// native view applies the new string from that state without pushing a
// state update of its own back, so the setting commit is measured against
// the previous text and nothing re-measures it afterwards. A typed
// change is fine: native pushes its state first, then JS echoes the value.
//
// Any later host-prop change clones the shadow node, which dirties its
// measurement (YogaLayoutableShadowNode::completeClone), and that re-measure
// sees the now-current state: one line after a clear, the restored text's
// full height after a restore. composerMinHeight() supplies that change: a
// layout-neutral `minHeight` that flips between `undefined` and 0 on the
// commit after any JS-driven value was committed. The height itself stays
// native, so it tracks Dynamic Type; neither value ever constrains auto-grow.
//
// Scope: every JS-driven value set — the CLEAR after a send or steer, and
// NON-EMPTY sets such as Plan B's steer-failure restore (`setInput((cur) =>
// restoreSteerText(cur, text))`) or a future draft restore. The composer
// records the last `onChangeText` text in a ref and, in its `value` layout
// effect, treats `valueSetFromJs(value, lastEmitted)` as a JS set; the ref is
// consumed per commit, so restoring the exact text typed before a steer still
// counts. A typed value is echoed back unchanged and never flips.
//
// This also relies on an RN 0.85 Fabric ordering detail: TextInput is
// measured from state before layout() runs updateStateIfNeeded. Re-verify
// this on every React Native upgrade.

/**
 * Whether a committed `value` was set from JS rather than typed. `lastEmitted`
 * is the last text `onChangeText` reported since the previous value commit
 * (null once consumed): a typed change arrives there first, a JS set never does.
 */
export function valueSetFromJs(value: string, lastEmitted: string | null): boolean {
  return value !== lastEmitted;
}

/**
 * `minHeight` for the composer TextInput. `remeasure` flips on the commit after
 * each JS-driven value set; both results are layout-neutral.
 */
export function composerMinHeight(remeasure: boolean): 0 | undefined {
  return remeasure ? 0 : undefined;
}
