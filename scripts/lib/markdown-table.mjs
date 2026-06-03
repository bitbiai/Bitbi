export function escapeMarkdownTableCell(value, fallback = "") {
  return String(value ?? fallback)
    .split("\\").join("\\\\")
    .split("|").join("\\|")
    .replace(/\r\n?|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
