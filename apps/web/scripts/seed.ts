/**
 * PharmIQ — Demo Seed Script
 *
 * Localhost demo tek-tenant'la çalışır. Bu script:
 * 1. Default tenant (Demo Pharma) oluşturur
 * 2. Default user (demo@pharmiq.local) oluşturur
 *
 * İdempotent — birden fazla çalıştırılabilir, çakışmaz.
 *
 * Kullanım: pnpm seed
 */

import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "..", ".env.local") });

import { db } from "../lib/db/client";
import { tenants, users } from "../lib/db/schema";
import {
  DEMO_TENANT_ID,
  DEMO_TENANT_SLUG,
  DEMO_USER_ID,
  DEMO_USER_EMAIL,
} from "../lib/db/constants";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("🌱 PharmIQ demo seed başlıyor...\n");

  // 1. Demo Tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      id: DEMO_TENANT_ID,
      name: "Demo Pharma",
      slug: DEMO_TENANT_SLUG,
      plan: "trial",
      region: "eu",
      settings: { demoMode: true },
    })
    .onConflictDoUpdate({
      target: tenants.id,
      set: { name: sql`EXCLUDED.name`, updatedAt: new Date() },
    })
    .returning();

  console.log(`✓ Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Demo User
  const [user] = await db
    .insert(users)
    .values({
      id: DEMO_USER_ID,
      tenantId: DEMO_TENANT_ID,
      email: DEMO_USER_EMAIL,
      fullName: "Demo Kullanıcı",
      role: "admin",
      preferredLanguage: "tr",
    })
    .onConflictDoNothing({ target: users.id })
    .returning();

  if (user) {
    console.log(`✓ User: ${user.email} (${user.id})`);
  } else {
    console.log(`✓ User: ${DEMO_USER_EMAIL} (zaten mevcut)`);
  }

  console.log("\n✅ Seed tamam.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed başarısız:", err);
  process.exit(1);
});
