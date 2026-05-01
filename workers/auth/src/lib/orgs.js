import { nowIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const ORG_ROLES = Object.freeze(["owner", "admin", "member", "viewer"]);
export const ORG_ROLE_RANK = Object.freeze({
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
});

const ORG_NAME_MIN_LENGTH = 2;
const ORG_NAME_MAX_LENGTH = 120;
const ORG_SLUG_MAX_LENGTH = 80;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class OrgRbacError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "OrgRbacError";
    this.status = status;
    this.code = code;
  }
}

export function orgRbacErrorResponse(error) {
  return {
    status: error.status || 400,
    ok: false,
    error: error.message || "Organization request failed.",
    code: error.code || "bad_request",
  };
}

export function normalizeOrgId(value) {
  const orgId = String(value || "").trim();
  if (!orgId || orgId.length > 128 || !/^org_[a-f0-9]{32}$/.test(orgId)) {
    throw new OrgRbacError("A valid organization id is required.", {
      status: 400,
      code: "invalid_organization_id",
    });
  }
  return orgId;
}

export function normalizeOrgIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (
    key.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(key)
  ) {
    throw new OrgRbacError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

function normalizeOrgName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < ORG_NAME_MIN_LENGTH || name.length > ORG_NAME_MAX_LENGTH) {
    throw new OrgRbacError("Organization name must be between 2 and 120 characters.", {
      status: 400,
      code: "invalid_organization_name",
    });
  }
  return name;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ORG_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

function normalizeRequestedSlug(value, fallbackName) {
  const base = slugify(value || fallbackName);
  if (!base || base.length < 2) {
    throw new OrgRbacError("Organization slug is invalid.", {
      status: 400,
      code: "invalid_organization_slug",
    });
  }
  return base;
}

function normalizeUserId(value) {
  const userId = String(value || "").trim();
  if (!userId || userId.length > 128) {
    throw new OrgRbacError("A valid user id is required.", {
      status: 400,
      code: "invalid_user_id",
    });
  }
  return userId;
}

export function normalizeOrgRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (!ORG_ROLES.includes(role)) {
    throw new OrgRbacError("Invalid organization role.", {
      status: 400,
      code: "invalid_organization_role",
    });
  }
  return role;
}

function organizationId() {
  return `org_${randomTokenHex(16)}`;
}

function membershipId() {
  return `om_${randomTokenHex(16)}`;
}

function serializeOrganization(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role || null,
    memberCount: row.member_count == null ? null : Number(row.member_count),
  };
}

function serializeMembership(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    email: row.email || null,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hashRequest(value) {
  return sha256Hex(JSON.stringify(value));
}

async function fetchUser(env, userId) {
  const user = await env.DB.prepare(
    "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
  ).bind(userId).first();
  if (!user) {
    throw new OrgRbacError("User not found.", {
      status: 404,
      code: "user_not_found",
    });
  }
  return user;
}

async function fetchOrganizationBySlug(env, slug) {
  return env.DB.prepare(
    "SELECT id FROM organizations WHERE slug = ? LIMIT 1"
  ).bind(slug).first();
}

async function fetchOrganizationCreateByIdempotency(env, { userId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT id, name, slug, status, created_by_user_id, create_request_hash,
            created_at, updated_at
     FROM organizations
     WHERE created_by_user_id = ? AND create_idempotency_key = ?
     LIMIT 1`
  ).bind(userId, idempotencyKey).first();
}

async function fetchMembershipCreateByIdempotency(env, { organizationId, actorUserId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status,
            om.create_request_hash, om.created_at, om.updated_at
     FROM organization_memberships om
     INNER JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = ? AND om.created_by_user_id = ? AND om.create_idempotency_key = ?
     LIMIT 1`
  ).bind(organizationId, actorUserId, idempotencyKey).first();
}

export async function getOrgMembership(env, { organizationId, userId }) {
  const orgId = normalizeOrgId(organizationId);
  const normalizedUserId = normalizeUserId(userId);
  return env.DB.prepare(
    `SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status,
            om.created_at, om.updated_at
     FROM organization_memberships om
     INNER JOIN users u ON u.id = om.user_id
     INNER JOIN organizations o ON o.id = om.organization_id
     WHERE om.organization_id = ?
       AND om.user_id = ?
       AND om.status = 'active'
       AND o.status = 'active'
     LIMIT 1`
  ).bind(orgId, normalizedUserId).first();
}

export async function requireOrgMembership(env, { organizationId, userId }) {
  const membership = await getOrgMembership(env, { organizationId, userId });
  if (!membership) {
    throw new OrgRbacError("Organization access denied.", {
      status: 404,
      code: "organization_not_found",
    });
  }
  return membership;
}

export async function requireOrgRole(env, { organizationId, userId, minRole }) {
  const membership = await requireOrgMembership(env, { organizationId, userId });
  const requiredRank = ORG_ROLE_RANK[normalizeOrgRole(minRole)] || 99;
  const actualRank = ORG_ROLE_RANK[membership.role] || 0;
  if (actualRank < requiredRank) {
    throw new OrgRbacError("Organization role is not sufficient.", {
      status: 403,
      code: "organization_role_required",
    });
  }
  return membership;
}

export async function createOrganization({ env, user, body, idempotencyKey }) {
  const userId = normalizeUserId(user?.id);
  const name = normalizeOrgName(body?.name);
  const requestedSlug = body?.slug == null
    ? normalizeRequestedSlug(`${name}-${randomTokenHex(3)}`, name)
    : normalizeRequestedSlug(body.slug, name);
  const requestHash = await hashRequest({
    name,
    slug: body?.slug == null ? null : requestedSlug,
  });

  const existing = await fetchOrganizationCreateByIdempotency(env, { userId, idempotencyKey });
  if (existing) {
    if (existing.create_request_hash !== requestHash) {
      throw new OrgRbacError("Idempotency-Key conflicts with a different organization request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      organization: serializeOrganization({
        ...existing,
        role: "owner",
      }),
      reused: true,
    };
  }

  const slugCollision = await fetchOrganizationBySlug(env, requestedSlug);
  if (slugCollision) {
    throw new OrgRbacError("Organization slug is already in use.", {
      status: 409,
      code: "organization_slug_conflict",
    });
  }

  const now = nowIso();
  const org = {
    id: organizationId(),
    name,
    slug: requestedSlug,
    status: "active",
    created_by_user_id: userId,
    create_idempotency_key: idempotencyKey,
    create_request_hash: requestHash,
    created_at: now,
    updated_at: now,
  };
  const membership = {
    id: membershipId(),
    organization_id: org.id,
    user_id: userId,
    role: "owner",
    status: "active",
    created_by_user_id: userId,
    create_idempotency_key: idempotencyKey,
    create_request_hash: requestHash,
    created_at: now,
    updated_at: now,
  };

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (
           id, name, slug, status, created_by_user_id, create_idempotency_key,
           create_request_hash, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        org.id,
        org.name,
        org.slug,
        org.status,
        org.created_by_user_id,
        org.create_idempotency_key,
        org.create_request_hash,
        org.created_at,
        org.updated_at
      ),
      env.DB.prepare(
        `INSERT INTO organization_memberships (
           id, organization_id, user_id, role, status, created_by_user_id,
           create_idempotency_key, create_request_hash, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        membership.id,
        membership.organization_id,
        membership.user_id,
        membership.role,
        membership.status,
        membership.created_by_user_id,
        membership.create_idempotency_key,
        membership.create_request_hash,
        membership.created_at,
        membership.updated_at
      ),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new OrgRbacError("Organization create conflict.", {
        status: 409,
        code: "organization_create_conflict",
      });
    }
    throw error;
  }

  return {
    organization: serializeOrganization({
      ...org,
      role: membership.role,
      member_count: 1,
    }),
    reused: false,
  };
}

export async function listUserOrganizations(env, { userId, limit = 50 }) {
  const normalizedUserId = normalizeUserId(userId);
  const appliedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await env.DB.prepare(
    `SELECT o.id, o.name, o.slug, o.status, o.created_by_user_id, o.created_at, o.updated_at,
            om.role,
            (SELECT COUNT(*) FROM organization_memberships active_members
             WHERE active_members.organization_id = o.id AND active_members.status = 'active') AS member_count
     FROM organization_memberships om
     INNER JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = ?
       AND om.status = 'active'
       AND o.status = 'active'
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ?`
  ).bind(normalizedUserId, appliedLimit).all();
  return (rows.results || []).map(serializeOrganization);
}

export async function getOrganizationForUser(env, { organizationId, userId }) {
  const orgId = normalizeOrgId(organizationId);
  const normalizedUserId = normalizeUserId(userId);
  const row = await env.DB.prepare(
    `SELECT o.id, o.name, o.slug, o.status, o.created_by_user_id, o.created_at, o.updated_at,
            om.role,
            (SELECT COUNT(*) FROM organization_memberships active_members
             WHERE active_members.organization_id = o.id AND active_members.status = 'active') AS member_count
     FROM organizations o
     INNER JOIN organization_memberships om ON om.organization_id = o.id
     WHERE o.id = ?
       AND om.user_id = ?
       AND om.status = 'active'
       AND o.status = 'active'
     LIMIT 1`
  ).bind(orgId, normalizedUserId).first();
  if (!row) {
    throw new OrgRbacError("Organization not found.", {
      status: 404,
      code: "organization_not_found",
    });
  }
  return serializeOrganization(row);
}

export async function listOrganizationMembers(env, { organizationId, actorUserId, limit = 100 }) {
  const orgId = normalizeOrgId(organizationId);
  await requireOrgMembership(env, { organizationId: orgId, userId: actorUserId });
  const appliedLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const rows = await env.DB.prepare(
    `SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status,
            om.created_at, om.updated_at
     FROM organization_memberships om
     INNER JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = ?
       AND om.status = 'active'
     ORDER BY
       CASE om.role
         WHEN 'owner' THEN 1
         WHEN 'admin' THEN 2
         WHEN 'member' THEN 3
         ELSE 4
       END,
       om.created_at ASC,
       om.user_id ASC
     LIMIT ?`
  ).bind(orgId, appliedLimit).all();
  return (rows.results || []).map(serializeMembership);
}

function assertCanGrantRole(actorRole, targetRole) {
  if (actorRole === "owner") return;
  if (actorRole === "admin" && (targetRole === "member" || targetRole === "viewer")) return;
  throw new OrgRbacError("Organization role cannot grant that membership.", {
    status: 403,
    code: "organization_role_required",
  });
}

async function fetchExistingMembership(env, { organizationId, userId }) {
  return env.DB.prepare(
    `SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status,
            om.created_at, om.updated_at
     FROM organization_memberships om
     INNER JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = ?
       AND om.user_id = ?
     LIMIT 1`
  ).bind(organizationId, userId).first();
}

export async function addOrganizationMember({ env, actorUser, organizationId, body, idempotencyKey }) {
  const orgId = normalizeOrgId(organizationId);
  const actorUserId = normalizeUserId(actorUser?.id);
  const actorMembership = await requireOrgRole(env, {
    organizationId: orgId,
    userId: actorUserId,
    minRole: "admin",
  });
  const targetUserId = normalizeUserId(body?.userId ?? body?.user_id);
  const targetRole = normalizeOrgRole(body?.role || "member");
  assertCanGrantRole(actorMembership.role, targetRole);

  const targetUser = await fetchUser(env, targetUserId);
  if (targetUser.status !== "active") {
    throw new OrgRbacError("Target user must be active.", {
      status: 400,
      code: "target_user_not_active",
    });
  }

  const requestHash = await hashRequest({
    organizationId: orgId,
    targetUserId,
    role: targetRole,
  });
  const existingForKey = await fetchMembershipCreateByIdempotency(env, {
    organizationId: orgId,
    actorUserId,
    idempotencyKey,
  });
  if (existingForKey) {
    if (existingForKey.create_request_hash !== requestHash) {
      throw new OrgRbacError("Idempotency-Key conflicts with a different membership request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      membership: serializeMembership(existingForKey),
      reused: true,
    };
  }

  const existingMembership = await fetchExistingMembership(env, {
    organizationId: orgId,
    userId: targetUserId,
  });
  if (existingMembership) {
    if (existingMembership.role !== targetRole || existingMembership.status !== "active") {
      throw new OrgRbacError("User already has a different organization membership.", {
        status: 409,
        code: "organization_membership_conflict",
      });
    }
    return {
      membership: serializeMembership(existingMembership),
      reused: true,
    };
  }

  const now = nowIso();
  const membership = {
    id: membershipId(),
    organization_id: orgId,
    user_id: targetUserId,
    role: targetRole,
    status: "active",
    created_by_user_id: actorUserId,
    create_idempotency_key: idempotencyKey,
    create_request_hash: requestHash,
    created_at: now,
    updated_at: now,
    email: targetUser.email,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO organization_memberships (
         id, organization_id, user_id, role, status, created_by_user_id,
         create_idempotency_key, create_request_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      membership.id,
      membership.organization_id,
      membership.user_id,
      membership.role,
      membership.status,
      membership.created_by_user_id,
      membership.create_idempotency_key,
      membership.create_request_hash,
      membership.created_at,
      membership.updated_at
    ).run();
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new OrgRbacError("Organization membership conflict.", {
        status: 409,
        code: "organization_membership_conflict",
      });
    }
    throw error;
  }

  return {
    membership: serializeMembership(membership),
    reused: false,
  };
}

export async function listAdminOrganizations(env, { limit = 50, search = null } = {}) {
  const appliedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const searchTerm = String(search || "").trim();
  const whereClause = searchTerm
    ? "WHERE o.name LIKE ? OR o.slug LIKE ?"
    : "";
  const bindings = searchTerm ? [`%${searchTerm}%`, `%${searchTerm}%`] : [];
  const rows = await env.DB.prepare(
    `SELECT o.id, o.name, o.slug, o.status, o.created_by_user_id, u.email AS created_by_email,
            o.created_at, o.updated_at,
            (SELECT COUNT(*) FROM organization_memberships active_members
             WHERE active_members.organization_id = o.id AND active_members.status = 'active') AS member_count
     FROM organizations o
     INNER JOIN users u ON u.id = o.created_by_user_id
     ${whereClause}
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ?`
  ).bind(...bindings, appliedLimit).all();
  return (rows.results || []).map((row) => ({
    ...serializeOrganization(row),
    createdByEmail: row.created_by_email || null,
  }));
}

export async function getAdminOrganization(env, { organizationId }) {
  const orgId = normalizeOrgId(organizationId);
  const organization = await env.DB.prepare(
    `SELECT o.id, o.name, o.slug, o.status, o.created_by_user_id, u.email AS created_by_email,
            o.created_at, o.updated_at,
            (SELECT COUNT(*) FROM organization_memberships active_members
             WHERE active_members.organization_id = o.id AND active_members.status = 'active') AS member_count
     FROM organizations o
     INNER JOIN users u ON u.id = o.created_by_user_id
     WHERE o.id = ?
     LIMIT 1`
  ).bind(orgId).first();
  if (!organization) {
    throw new OrgRbacError("Organization not found.", {
      status: 404,
      code: "organization_not_found",
    });
  }
  const members = await listOrganizationMembersForAdmin(env, { organizationId: orgId });
  return {
    organization: {
      ...serializeOrganization(organization),
      createdByEmail: organization.created_by_email || null,
    },
    members,
  };
}

async function listOrganizationMembersForAdmin(env, { organizationId }) {
  const rows = await env.DB.prepare(
    `SELECT om.id, om.organization_id, om.user_id, u.email, om.role, om.status,
            om.created_at, om.updated_at
     FROM organization_memberships om
     INNER JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = ?
     ORDER BY
       CASE om.role
         WHEN 'owner' THEN 1
         WHEN 'admin' THEN 2
         WHEN 'member' THEN 3
         ELSE 4
       END,
       om.created_at ASC,
       om.user_id ASC
     LIMIT 100`
  ).bind(organizationId).all();
  return (rows.results || []).map(serializeMembership);
}
