// Reviewable creative expectations, not measured model rankings. No paid
// benchmark has been run. Record future owned evaluations separately from the
// deterministic capability/permission/price gates exercised by these fixtures.
export const canvasAgentProfiles = Object.freeze([
  { id: 'comic-construction', brief: 'A comic style film: villagers construct a house beside a duck pool, then visitors celebrate.',
    style: 'comic, clear outlines, consistent character proportions', continuity: ['same house geometry', 'pool remains beside house', 'recurring visitors'],
    provisionalCandidates: ['minimax/h3', 'pixverse/v6'], evidence: 'Existing Canvas model descriptions and safely integrated text-to-video controls only.' },
  { id: 'realistic-construction', brief: 'A realistic documentary film of Amish builders raising a house by a neighboring duck pool, followed by a celebration.',
    style: 'realistic, natural daylight, coherent camera cuts', continuity: ['same house geometry', 'pool remains beside house', 'recurring visitors'],
    provisionalCandidates: ['minimax/h3', 'pixverse/v6'], evidence: 'Existing Canvas model descriptions and safely integrated text-to-video controls only.' },
]);
