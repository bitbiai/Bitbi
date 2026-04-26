import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const CHECKS = Object.freeze([
  {
    file: "workers/auth/src/routes/admin.js",
    pattern: /meta_json\s+LIKE|LIKE\s+\?[^`"']*meta_json|meta_json[^`"']*LIKE\s+\?/i,
    message: "Admin activity request-path search must not scan raw meta_json.",
  },
  {
    file: "workers/auth/src/routes/admin.js",
    pattern: /SELECT\s+action,\s*COUNT\(\*\)\s+AS\s+cnt\s+FROM\s+admin_audit_log\s+GROUP\s+BY\s+action/i,
    message: "Admin activity counts must be bounded by the hot retention window.",
  },
  {
    file: "workers/auth/src/routes/admin.js",
    pattern: /indexOf\("\|"\)|created_at\}\|\$\{last\.id\}|Invalid cursor format/i,
    message: "Admin activity endpoints must use signed pagination cursors, not raw created_at|id cursors.",
  },
]);

const REQUIRED_PATTERNS = Object.freeze([
  {
    file: "workers/auth/src/routes/admin.js",
    pattern: /FROM\s+activity_search_index\s+idx\s+JOIN\s+admin_audit_log\s+a\s+ON\s+a\.id\s+=\s+idx\.source_event_id/i,
    message: "Admin audit search must be driven from activity_search_index.",
  },
  {
    file: "workers/auth/src/routes/admin.js",
    pattern: /FROM\s+activity_search_index\s+idx\s+JOIN\s+user_activity_log\s+a\s+ON\s+a\.id\s+=\s+idx\.source_event_id/i,
    message: "Admin user-activity search must be driven from activity_search_index.",
  },
]);

const issues = [];

for (const check of CHECKS) {
  const absolute = path.join(repoRoot, check.file);
  const source = fs.readFileSync(absolute, "utf8");
  if (check.pattern.test(source)) {
    issues.push(`${check.file}: ${check.message}`);
  }
}

for (const check of REQUIRED_PATTERNS) {
  const absolute = path.join(repoRoot, check.file);
  const source = fs.readFileSync(absolute, "utf8");
  if (!check.pattern.test(source)) {
    issues.push(`${check.file}: ${check.message}`);
  }
}

if (issues.length > 0) {
  console.error("Admin activity query-shape guard failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Admin activity query-shape guard passed.");
