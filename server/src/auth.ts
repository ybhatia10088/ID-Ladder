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

/**
 * Resolves the organization this user acts for, creating the membership on
 * first sign-in.
 *
 * The default organization is read from configuration or from the first row in
 * the table — never a hardcoded id — so the demo works without manual setup.
 */
function resolveOrganization(user: AuthenticatedUser): RequestOrganization | null {
  const db = openDatabase();
  try {
    const membership = db
      .prepare(`SELECT organization_id FROM user_organizations WHERE auth0_user_id = ?`)
      .get(user.sub) as { organization_id: string } | undefined;

    let organizationId = membership?.organization_id;

    if (!organizationId) {
      const fallback = process.env.DEFAULT_ORGANIZATION_ID
        ? (db
            .prepare(`SELECT id FROM organizations WHERE id = ?`)
            .get(process.env.DEFAULT_ORGANIZATION_ID) as { id: string } | undefined)
        : undefined;

      const first = fallback
        ? fallback
        : (db.prepare(`SELECT id FROM organizations ORDER BY id LIMIT 1`).get() as
            | { id: string }
            | undefined);

      if (!first) {
        return null;
      }

      organizationId = first.id;
      db.prepare(
        `INSERT OR IGNORE INTO user_organizations (auth0_user_id, email, organization_id, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(user.sub, user.email ?? null, organizationId, new Date().toISOString());
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
