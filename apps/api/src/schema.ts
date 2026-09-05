import { pgTable, text, timestamp, boolean, jsonb, uuid, uniqueIndex, index, integer } from "drizzle-orm/pg-core";

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/Minsk"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  planStatus: text("plan_status").notNull().default("none"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    scopes: text("scopes").array().notNull().default(["obligations:read", "obligations:capture", "obligations:advance", "evidence:propose"]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("agent_tokens_household_idx").on(t.householdId)],
);

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginTokens = pgTable("login_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    householdId: uuid("household_id").notNull().references(() => households.id),
    role: text("role").notNull().default("member"), // owner | member
  },
  (t) => [uniqueIndex("memberships_user_household_unique").on(t.userId, t.householdId)],
);

export const obligations = pgTable(
  "obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    title: text("title").notNull(),
    summary: text("summary"),
    status: text("status").notNull().default("captured"),
    priority: text("priority").notNull().default("normal"),
    risk: text("risk").notNull().default("none"),
    source: text("source"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    assignedTo: uuid("assigned_to").references(() => users.id),
    createdByKind: text("created_by_kind").notNull().default("human"),
    createdById: text("created_by_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("obligations_household_state_idx").on(t.householdId, t.status),
    index("obligations_household_due_idx").on(t.householdId, t.dueAt),
  ],
);

/** Append-only lifecycle log. Every status change writes exactly one event. */
export const obligationEvents = pgTable(
  "obligation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => obligations.id),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    actorKind: text("actor_kind").notNull(), // human | agent | system
    actorId: text("actor_id").notNull(),
    reason: text("reason").notNull(),
    evidenceId: uuid("evidence_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("obligation_events_obligation_idx").on(t.obligationId, t.createdAt)],
);

/**
 * Evidence for verification. `verified` requires a human principal and an
 * evidence row belonging to the same household + obligation.
 */
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => obligations.id),
    kind: text("kind").notNull().default("note"), // note | url | receipt | document | photo | external_confirmation
    value: text("value").notNull(),
    createdByKind: text("created_by_kind").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_obligation_idx").on(t.obligationId)],
);

/** Idempotency for the email webhook: (provider, message_id, household) is unique. */
export const ingestedEmails = pgTable(
  "ingested_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    messageId: text("message_id").notNull(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id),
    provenance: jsonb("provenance"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ingested_emails_unique").on(t.provider, t.messageId, t.householdId)],
);

/** Explicit inbound identity for email: each mailbox maps to exactly one household. */
export const inboundMailboxes = pgTable("inbound_mailboxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id),
  address: text("address").notNull().unique(),
  webhookSecretHash: text("webhook_secret_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
