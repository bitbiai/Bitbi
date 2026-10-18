import { core, personality } from './core.mjs';
import creativeBriefing from './skills/creative-briefing.mjs';
import storyAndContinuity from './skills/story-and-continuity.mjs';
import modelSelection from './skills/model-selection.mjs';
import canvasEditing from './skills/canvas-editing.mjs';
import generationAndRecovery from './skills/generation-and-recovery.mjs';
import reviewAndExport from './skills/review-and-export.mjs';

// Static imports are the approval boundary. Never resolve paths from project data.
export const CANVAS_AGENT_POLICY_VERSION = 'canvas-policy-1';
const phases = Object.freeze({
  briefing: Object.freeze([creativeBriefing]),
  planning: Object.freeze([storyAndContinuity, modelSelection, canvasEditing, generationAndRecovery]),
  correction: Object.freeze([storyAndContinuity, modelSelection, canvasEditing, generationAndRecovery]),
  evaluation: Object.freeze([reviewAndExport]),
  explanation: Object.freeze([creativeBriefing, canvasEditing, generationAndRecovery]),
});
function selected(phase) {
  if (!Object.hasOwn(phases, phase)) throw new TypeError('canvas_agent_policy_phase_invalid');
  return [core, personality, ...phases[phase]];
}
export function canvasAgentSystem(phase) {
  return selected(phase).map(entry => entry.purpose
    ? `${entry.id} v${entry.version}\nPurpose: ${entry.purpose}\nUse: ${entry.when}\nRequired context: ${entry.context}\nExisting operations: ${entry.operations}\nExpected result: ${entry.result}\nRecovery: ${entry.recovery}\n${entry.text}`
    : entry.text).join('\n\n');
}
export async function canvasAgentPolicyIdentity(phase) {
  const entries = selected(phase);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canvasAgentSystem(phase)));
  return { version: CANVAS_AGENT_POLICY_VERSION, phase,
    sha256: Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''),
    skills: entries.map(({ id, version }) => ({ id, version })) };
}
export function validateCanvasAgentPolicyIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['version', 'phase', 'sha256', 'skills'].includes(key))
    || !/^canvas-policy-[1-9][0-9]{0,5}$/.test(value.version || '') || !Object.hasOwn(phases, value.phase)
    || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || !Array.isArray(value.skills) || value.skills.length < 2 || value.skills.length > 10
    || value.skills.some(skill => !skill || Object.keys(skill).some(key => !['id', 'version'].includes(key))
      || typeof skill.id !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(skill.id) || !Number.isSafeInteger(skill.version) || skill.version < 1)
    || new Set(value.skills.map(skill => skill.id)).size !== value.skills.length) throw new TypeError('canvas_agent_policy_identity_invalid');
  // Accepted old content hashes remain valid receipt identities after releases.
  // The signed caller's persisted context supplies identity, not model output.
  return structuredClone(value);
}
