import { json } from "../lib/response.js";
import {
  getNewsPulseItems,
  NEWS_PULSE_CACHE_CONTROL,
  normalizeNewsPulseLocale,
} from "../lib/news-pulse.js";

export async function handlePublicNewsPulse(ctx) {
  const locale = normalizeNewsPulseLocale(ctx.url.searchParams.get("locale"));
  const result = await getNewsPulseItems(ctx.env, locale);
  return json(
    {
      items: result.items,
      updated_at: result.updated_at,
    },
    {
      headers: {
        "cache-control": NEWS_PULSE_CACHE_CONTROL,
      },
    }
  );
}
