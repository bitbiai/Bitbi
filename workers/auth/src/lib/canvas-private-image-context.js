// Only trusted in-process media completion may select this identity. HTTP
// headers, JSON and the assistant's arguments cannot populate this WeakMap.
const contexts = new WeakMap();
export function canvasPrivateImageContext(ctx, user) {
    const scoped = { ...ctx }; contexts.set(scoped, user); return scoped;
}
export const canvasPrivateImageUser = ctx => contexts.get(ctx) || null;
