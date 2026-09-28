// src/lib/composer-height.ts
//
// Why the composer needs this (RN 0.85, Fabric, iOS): the multiline TextInput
// auto-grows natively (Yoga measures its text), but when the parent clears
// `value` from JS after a send, the input stays at its last-grown height.
//
// Fabric measures a TextInput from its shadow-node *state*
// (BaseTextInputShadowNode::measureContent -> attributedStringBoxToMeasure),
// and copies a new JS `value` into that state only in layout()
// (updateStateIfNeeded), which runs after Yoga has already measured the node
// for that commit. setStateData() there does not dirty the Yoga node, and the
// native view applies the empty string from that state without pushing a
// state update of its own back, so the clearing commit is measured against
// the previous, long text and nothing re-measures it afterwards. A typed
// change is fine: native pushes its state first, then JS echoes the value.
//
// Any later host-prop change clones the shadow node, which dirties its
// measurement (YogaLayoutableShadowNode::completeClone), and that re-measure
// sees the now-empty state and snaps back to one line. composerMinHeight()
// supplies that change: a layout-neutral `minHeight` that flips from
// `undefined` to 0 on the commit after the empty value was committed. The
// one-line height itself stays native, so it tracks Dynamic Type.

/**
 * `minHeight` for the composer TextInput. `emptyCommitted` is whether an empty
 * `value` has already been committed (it lags `value === ''` by one commit).
 */
export function composerMinHeight(value: string, emptyCommitted: boolean): 0 | undefined {
  return value === '' && emptyCommitted ? 0 : undefined;
}
