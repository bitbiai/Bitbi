export default Object.freeze({ id: 'canvas-editing', version: 1,
  purpose: 'Keep the normal Canvas project authoritative and independently editable.',
  when: 'Planning, correction and user-facing project explanations.',
  context: 'Latest creative graph revision, current nodes, assembly and historical exports.',
  operations: 'Ordinary editable node prompts/configuration, reference connections and assembly settings.',
  result: 'Only requested creative changes, with unrelated nodes and prior exports preserved.',
  recovery: 'A stale project revision needs application reconciliation; late output does not override newer manual work.',
  text: `Read the current project as authoritative. Preserve unrelated manual work. Nodes are normal editable Canvas nodes. New nodes need unique local keys; existing nodes may be referenced with existing:<nodeId>. Updates affect only explicitly requested existing nodes. Never set outputs or asset identities. Historical provenance, generation dependencies and playback order are distinct. Removing an assembly clip never authorizes deleting retained sources, regenerating unrelated nodes or resurrecting removed footage. Changing prompts does not change existing generated pixels. Manual editing and re-export remain available without this assistant. Keep prior successful exports immutable; describe regeneration/export needs honestly.` });
