import { Client } from "@elastic/elasticsearch";
import type { Email } from "@prisma/client";
import { config } from "../../config/env.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ operation: "elasticsearch" });

export const esClient = new Client({
  node: config.elasticsearchUrl,
  requestTimeout: 10_000,
});

const INDEX = () => config.elasticsearchIndex;

const INDEX_MAPPINGS = <const>{
  properties: {
    id: { type: "keyword" },
    userId: { type: "keyword" },
    senderId: { type: "keyword" },
    recipient: { type: "text", fields: { keyword: { type: "keyword" } } },
    subject: { type: "text" },
    body: { type: "text" },
    status: { type: "keyword" },
    scheduledAt: { type: "date" },
    sentAt: { type: "date" },
    createdAt: { type: "date" },
  },
};

/** Create the emails index if it does not exist. Idempotent. */
export async function ensureEmailIndex(): Promise<void> {
  const exists = await esClient.indices.exists({ index: INDEX() });
  if (!exists) {
    await esClient.indices.create({
      index: INDEX(),
      mappings: INDEX_MAPPINGS,
    });
    log.info({ index: INDEX() }, "elasticsearch index created");
  }
}

function toDocument(email: Email) {
  return {
    id: email.id,
    userId: email.userId,
    senderId: email.senderId,
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString(),
  };
}

/**
 * Index/upsert an email document. Never throws to the caller: PostgreSQL
 * is the source of truth and an indexing outage must not break email
 * sending. Failures are logged for reconciliation.
 */
export async function indexEmail(email: Email): Promise<boolean> {
  try {
    await esClient.index({
      index: INDEX(),
      id: email.id,
      document: toDocument(email),
    });
    log.debug({ emailId: email.id }, "elasticsearch indexed");
    return true;
  } catch (err) {
    log.error({ emailId: email.id, err }, "elasticsearch indexing failed");
    return false;
  }
}

export interface SearchParams {
  userId: string;
  q?: string;
  status?: string;
  senderId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
}

export interface SearchHit {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
}

export interface SearchResult {
  items: SearchHit[];
  total: number;
}

/** Full-text search across recipient/subject/body with term filters. */
export async function searchEmails(params: SearchParams): Promise<SearchResult> {
  const filters: Record<string, unknown>[] = [
    { term: { userId: params.userId } },
  ];
  if (params.status) filters.push({ term: { status: params.status } });
  if (params.senderId) filters.push({ term: { senderId: params.senderId } });
  if (params.dateFrom || params.dateTo) {
    filters.push({
      range: {
        scheduledAt: {
          ...(params.dateFrom ? { gte: params.dateFrom.toISOString() } : {}),
          ...(params.dateTo ? { lte: params.dateTo.toISOString() } : {}),
        },
      },
    });
  }

  const body: Record<string, unknown> = {
    from: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    query: {
      bool: {
        filter: filters,
        ...(params.q
          ? {
              must: {
                multi_match: {
                  query: params.q,
                  fields: ["recipient^2", "subject^2", "body"],
                  fuzziness: "AUTO",
                },
              },
            }
          : {}),
      },
    },
    sort: params.q
      ? undefined
      : [{ scheduledAt: { order: "desc", missing: "_last" } }, "_score"],
  };

  const response = await esClient.search<SearchHit>({
    index: INDEX(),
    ...body,
  });

  return {
    items: response.hits.hits.map((h) => h._source!).filter(Boolean),
    total: typeof response.hits.total === "number"
      ? response.hits.total
      : (response.hits.total?.value ?? 0),
  };
}

/**
 * Startup reconciliation for the search projection: re-index recently
 * changed emails so documents missing due to an Elasticsearch outage
 * are repaired. Runs once at boot — never a continuous poll.
 */
export async function reconcileEmailIndex(
  findRecent: (since: Date) => Promise<Email[]>,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const emails = await findRecent(since);
  let indexed = 0;
  for (const email of emails) {
    if (await indexEmail(email)) indexed++;
  }
  if (indexed > 0) log.info({ indexed }, "elasticsearch reconciliation done");
  return indexed;
}
