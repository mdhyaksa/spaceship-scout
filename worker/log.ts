/**
 * One row per question.
 *
 * The log ships in this release even though the clustering and coverage
 * machinery it feeds does not, because retrofitting logging after launch
 * throws away the most informative weeks of usage there are. Two fields earn
 * their place beyond the obvious: `returned_empty` catches queries that ran
 * perfectly and answered nothing, which is invisible if you only watch error
 * rates; `path` separates a refusal that was correct from a failure that was
 * not.
 *
 * Dashboard tiles are deliberately not logged. They are fixed plans rather
 * than questions, and nine rows per page load would bury the fall-throughs
 * the coverage report exists to surface.
 */
import type { Database } from './db.ts';
import type { Layer } from '../shared/layer-types.ts';
import type { QueryIR } from '../shared/ir.ts';
import { dataAsOf } from './time.ts';

export interface LogEntry {
  requestId: string;
  question?: string | null;
  path: 'ir' | 'clarify' | 'unanswerable' | 'planner_failed' | 'invalid' | 'tile';
  intent?: string | null;
  ir?: QueryIR | null;
  sql?: string | null;
  validatorErrors?: unknown;
  clarifyReason?: string | null;
  modelId?: string | null;
  plannerLatencyMs?: number | null;
  queryLatencyMs?: number | null;
  rowCount?: number | null;
}

function normalize(question: string): string {
  return question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

export async function writeLog(db: Database, layer: Layer, entry: LogEntry): Promise<void> {
  try {
    await db.run(
      `INSERT INTO nl_query_log (
         request_id, occurred_at, question_raw, question_normalized, path, trust, intent,
         ir, generated_sql, validator_errors, clarify_reason, model_id,
         planner_latency_ms, query_latency_ms, row_count, returned_empty,
         layer_version, data_as_of
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        entry.requestId,
        new Date().toISOString(),
        entry.question ?? null,
        entry.question ? normalize(entry.question) : null,
        entry.path,
        'verified',
        entry.intent ?? null,
        entry.ir ? JSON.stringify(entry.ir) : null,
        entry.sql ?? null,
        entry.validatorErrors ? JSON.stringify(entry.validatorErrors) : null,
        entry.clarifyReason ?? null,
        entry.modelId ?? null,
        entry.plannerLatencyMs ?? null,
        entry.queryLatencyMs ?? null,
        entry.rowCount ?? null,
        entry.rowCount === 0 ? 1 : 0,
        layer.version,
        dataAsOf(layer),
      ],
    );
  } catch {
    // Logging must never break an answer. A dropped log row costs a line in
    // the coverage report; a thrown error costs the user their result.
  }
}
