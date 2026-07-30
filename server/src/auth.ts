/**
 * Auth0 authentication for the API.
 *
 * The client signs in through Auth0 Universal Login and sends its access token
 * as a Bearer header. We validate that token by calling Auth0's /userinfo
 * endpoint — a token Auth0 does not recognise gets a 401 from Auth0, which is
 * exactly the check we need, and it avoids pulling in a JWKS/JWT dependency.
 *
 * Organization membership comes from our own `user_organizations` table rather
 * than Auth0 Organizations, which is not configured on this tenant.
 */
import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { openDatabase } from "./db/index.js";

export type AuthenticatedUser = {
  sub: string;
  email?: string;
  name?: string;
};

export type RequestOrganization = {
  id: string;
  name: string;
  standing_jurisdictions: string[];
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      organization?: RequestOrganization;
    }
  }
}

// Auth0's /userinfo is rate limited and the UI refetches the plan after every
// action, so cache validated tokens briefly.
const TOKEN_CACHE_MS = 60_000;
const tokenCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();

async function verifyToken(token: string): Promise<AuthenticatedUser | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) {
    return null;
  }

  const response = await fetch(`https://${domain}/userinfo`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return null;
  }

  const profile = (await response.json()) as { sub?: string; email?: string; name?: string };
  if (!profile.sub) {
    return null;
  }

  const user: AuthenticatedUser = { sub: profile.sub, email: profile.email, name: profile.name };
  tokenCache.set(token, { user, expiresAt: Date.now() + TOKEN_CACHE_MS });
  return user;
}

function parseStanding(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

type DatabaseHandle = ReturnType<typeof openDatabase>;

/**
 * The organization whose cases are cloned for every new user.
 *
 * Read from configuration or from the first row — never a hardcoded id. Once
 * users get their own organizations, nobody is a member of the template org,
 * so the seeded cases become an invisible blueprint rather than shared state.
 */
function templateOrganizationId(db: DatabaseHandle): string | null {
  const configured = process.env.TEMPLATE_ORGANIZATION_ID ?? process.env.DEFAULT_ORGANIZATION_ID;
  if (configured) {
    const match = db.prepare(`SELECT id FROM organizations WHERE id = ?`).get(configured) as
      | { id: string }
      | undefined;
    if (match) {
      return match.id;
    }
  }

  // Prefer an organization nobody is a member of: that is a seeded template,
  // never a user's private workspace. Ordering by id alone would start
  // cloning from real users' data once enough workspaces exist.
  const template = db
    .prepare(
      `SELECT o.id FROM organizations o
       WHERE NOT EXISTS (SELECT 1 FROM user_organizations u WHERE u.organization_id = o.id)
       ORDER BY o.id LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (template) {
    return template.id;
  }

  const first = db.prepare(`SELECT id FROM organizations ORDER BY id LIMIT 1`).get() as
    | { id: string }
    | undefined;
  return first?.id ?? null;
}

function displayNameFor(user: AuthenticatedUser): string {
  return user.name ?? user.email ?? user.sub;
}

/**
 * Provisions a private workspace on first sign-in: a fresh organization for
 * this user, plus a clone of every template case with new ids.
 *
 * Each user therefore gets their own organization, their own cases, and — as a
 * consequence of the cases being new rows — their own attestations and
 * payments. Nobody can mutate anybody else's demo.
 *
 * Attestations and payments are deliberately NOT cloned: a new workspace
 * starts from the untouched state, which is the whole point of the demo.
 */
export function provisionWorkspace(
  db: DatabaseHandle,
  user: AuthenticatedUser,
): string | null {
  const templateId = templateOrganizationId(db);
  if (!templateId) {
    return null;
  }

  const template = db
    .prepare(`SELECT id, standing_jurisdictions FROM organizations WHERE id = ?`)
    .get(templateId) as { id: string; standing_jurisdictions: string } | undefined;

  if (!template) {
    return null;
  }

  const templateCases = db
    .prepare(
      `SELECT id, client_ref, birth_jurisdiction, current_jurisdiction, goal_document_id
       FROM cases WHERE organization_id = ? ORDER BY id`,
    )
    .all(templateId) as {
    id: string;
    client_ref: string;
    birth_jurisdiction: string;
    current_jurisdiction: string;
    goal_document_id: string;
  }[];

  const insertOrganization = db.prepare(
    `INSERT INTO organizations (id, auth0_org_id, name, standing_jurisdictions)
     VALUES (?, NULL, ?, ?)`,
  );
  const insertCase = db.prepare(
    `INSERT INTO cases (id, organization_id, client_ref, birth_jurisdiction,
                        current_jurisdiction, goal_document_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const templateHoldings = db.prepare(
    `SELECT document_id FROM case_holdings WHERE case_id = ?`,
  );
  const insertHolding = db.prepare(
    `INSERT INTO case_holdings (case_id, document_id) VALUES (?, ?)`,
  );
  const insertMembership = db.prepare(
    `INSERT INTO user_organizations (auth0_user_id, email, organization_id, created_at)
     VALUES (?, ?, ?, ?)`,
  );

  return db.transaction((): string | null => {
    // Re-check inside the transaction: two requests can race on first sign-in.
    const existing = db
      .prepare(`SELECT organization_id FROM user_organizations WHERE auth0_user_id = ?`)
      .get(user.sub) as { organization_id: string } | undefined;
    if (existing) {
      return existing.organization_id;
    }

    const now = new Date().toISOString();
    const organizationId = `org_${randomUUID()}`;

    // Standing is inherited from the template (California), so a cloned
    // workspace reproduces the cross-jurisdiction demo exactly.
    insertOrganization.run(
      organizationId,
      `${displayNameFor(user)} · demo workspace`,
      template.standing_jurisdictions,
    );

    for (const templateCase of templateCases) {
      const caseId = `case_${randomUUID()}`;
      insertCase.run(
        caseId,
        organizationId,
        templateCase.client_ref,
        templateCase.birth_jurisdiction,
        templateCase.current_jurisdiction,
        templateCase.goal_document_id,
        now,
      );

      for (const holding of templateHoldings.all(templateCase.id) as { document_id: string }[]) {
        insertHolding.run(caseId, holding.document_id);
      }
    }

    insertMembership.run(user.sub, user.email ?? null, organizationId, now);
    return organizationId;
  })();
}

/** Resolves the organization this user acts for, provisioning it if needed. */
function resolveOrganization(user: AuthenticatedUser): RequestOrganization | null {
  const db = openDatabase();
  try {
    const membership = db
      .prepare(`SELECT organization_id FROM user_organizations WHERE auth0_user_id = ?`)
      .get(user.sub) as { organization_id: string } | undefined;

    const organizationId = membership?.organization_id ?? provisionWorkspace(db, user);
    if (!organizationId) {
      return null;
    }

    const organization = db
      .prepare(`SELECT id, name, standing_jurisdictions FROM organizations WHERE id = ?`)
      .get(organizationId) as
      | { id: string; name: string; standing_jurisdictions: string }
      | undefined;

    if (!organization) {
      return null;
    }

    return {
      id: organization.id,
      name: organization.name,
      standing_jurisdictions: parseStanding(organization.standing_jurisdictions),
    };
  } finally {
    db.close();
  }
}

/** Express middleware: rejects anything without a valid Auth0 access token. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;

  if (!token) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }

  try {
    const user = await verifyToken(token);
    if (!user) {
      res.status(401).json({ error: "Your session has expired. Sign in again." });
      return;
    }

    const organization = resolveOrganization(user);
    if (!organization) {
      res.status(403).json({ error: "Your account is not linked to a verifying organization" });
      return;
    }

    req.user = user;
    req.organization = organization;
    next();
  } catch (error) {
    console.error("[auth]", error);
    res.status(500).json({ error: "Could not verify your session" });
  }
}
