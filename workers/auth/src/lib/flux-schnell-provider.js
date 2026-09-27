export const FLUX_SCHNELL = '@cf/black-forest-labs/flux-1-schnell';

// Preserve only an allowlisted reason, never provider prose or input. A binding
// exception is NOT an authoritative no-inference receipt or refund instruction.
export async function callFluxSchnell(ai, model, input, options) {
  try { return await ai.run(model, input, options); }
  catch (error) {
    const schema = error?.name === 'AiError' && /^5006: Error: Additional or unevaluated properties '\/(num_steps|steps|seed)' at '\/' not allowed$/.test(error.message || '');
    throw Object.assign(new Error('Image provider outcome requires review.'), {
      code: schema ? 'generation_schema_rejected_review' : 'generation_provider_outcome_unknown',
      providerDiagnostic: { model: FLUX_SCHNELL, stage: schema ? 'schema_rejected' : 'binding_outcome_unknown', noInference: false },
    });
  }
}
