import {
  handleGetImageDerivative,
  handleGetImageFile,
  handleGetTextAssetFile,
  handleGetTextAssetPoster,
} from "./ai/files-read.js";
import {
  handleDeleteImage,
  handleGenerateImage,
  handleRenameImage,
  handleSaveImage,
} from "./ai/images-write.js";
import { handleUpdateImagePublication, handleUpdateTextAssetPublication } from "./ai/publication.js";
import {
  handleDeleteTextAsset,
  handleRenameTextAsset,
  handleSaveAudio,
} from "./ai/text-assets-write.js";
import { handleBulkDeleteAssets, handleBulkMoveAssets } from "./ai/bulk-assets.js";
import { handleBulkDelete, handleBulkMove } from "./ai/bulk-images.js";
// ── Main dispatcher ──
export async function handleAI(ctx) {
  const { pathname, method } = ctx;

  if (pathname === "/api/ai/quota" && method === "GET") {
    return handleQuota(ctx);
  }
  if (pathname === "/api/ai/generate-image" && method === "POST") {
    return handleGenerateImage(ctx);
  }
  if (pathname === "/api/ai/folders" && method === "GET") {
    return handleGetFolders(ctx);
  }
  if (pathname === "/api/ai/folders" && method === "POST") {
    return handleCreateFolder(ctx);
  }
  if (pathname === "/api/ai/images" && method === "GET") {
    return handleGetImages(ctx);
  }
  if (pathname === "/api/ai/assets" && method === "GET") {
    return handleGetAssets(ctx);
  }
  if (pathname === "/api/ai/assets/bulk-move" && method === "PATCH") {
    return handleBulkMoveAssets(ctx);
  }
  if (pathname === "/api/ai/assets/bulk-delete" && method === "POST") {
    return handleBulkDeleteAssets(ctx);
  }
  if (pathname === "/api/ai/images/save" && method === "POST") {
    return handleSaveImage(ctx);
  }
  if (pathname === "/api/ai/audio/save" && method === "POST") {
    return handleSaveAudio(ctx);
  }
  if (pathname === "/api/ai/images/bulk-move" && method === "PATCH") {
    return handleBulkMove(ctx);
  }
  if (pathname === "/api/ai/images/bulk-delete" && method === "POST") {
    return handleBulkDelete(ctx);
  }

  // DELETE /api/ai/folders/:id
  const folderMatch = pathname.match(/^\/api\/ai\/folders\/([a-f0-9]+)$/);
  if (folderMatch && method === "PATCH") {
    return handleRenameFolder(ctx, folderMatch[1]);
  }
  if (folderMatch && method === "DELETE") {
    return handleDeleteFolder(ctx, folderMatch[1]);
  }

  // /api/ai/images/:id/file
  const fileMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/file$/);
  if (fileMatch && method === "GET") {
    return handleGetImageFile(ctx, fileMatch[1]);
  }

  const thumbMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/thumb$/);
  if (thumbMatch && method === "GET") {
    return handleGetImageDerivative(ctx, thumbMatch[1], "thumb");
  }

  const mediumMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/medium$/);
  if (mediumMatch && method === "GET") {
    return handleGetImageDerivative(ctx, mediumMatch[1], "medium");
  }

  const textFileMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/file$/);
  if (textFileMatch && method === "GET") {
    return handleGetTextAssetFile(ctx, textFileMatch[1]);
  }

  const textPosterMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/poster$/);
  if (textPosterMatch && method === "GET") {
    return handleGetTextAssetPoster(ctx, textPosterMatch[1]);
  }

  // DELETE /api/ai/images/:id
  const deleteMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)$/);
  if (deleteMatch && method === "DELETE") {
    return handleDeleteImage(ctx, deleteMatch[1]);
  }

  const publicationMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/publication$/);
  if (publicationMatch && method === "PATCH") {
    return handleUpdateImagePublication(ctx, publicationMatch[1]);
  }

  const imageRenameMatch = pathname.match(/^\/api\/ai\/images\/([a-f0-9]+)\/rename$/);
  if (imageRenameMatch && method === "PATCH") {
    return handleRenameImage(ctx, imageRenameMatch[1]);
  }

  const textPublicationMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/publication$/);
  if (textPublicationMatch && method === "PATCH") {
    return handleUpdateTextAssetPublication(ctx, textPublicationMatch[1]);
  }

  const textRenameMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)\/rename$/);
  if (textRenameMatch && method === "PATCH") {
    return handleRenameTextAsset(ctx, textRenameMatch[1]);
  }

  const textDeleteMatch = pathname.match(/^\/api\/ai\/text-assets\/([a-f0-9]+)$/);
  if (textDeleteMatch && method === "DELETE") {
    return handleDeleteTextAsset(ctx, textDeleteMatch[1]);
  }

  return null;
}
