import { listCatalog } from "../lib/model-registry.js";
import { ok } from "../lib/responses.js";

export async function handleModels() {
  const catalog = listCatalog();

  return ok({
    task: "models",
    ...catalog,
  });
}
