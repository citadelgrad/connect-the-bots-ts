// ─── Attractor Pipeline Types ───────────────────────────────────────────────

export type NodeShape =
  | "Mdiamond"  // start
  | "Msquare"   // exit
  | "box"       // codergen (LLM task)
  | "hexagon"   // wait.human
  | "diamond"   // conditional
  | "component" // parallel
  | "tripleoctagon" // parallel.fan_in
  | "parallelogram" // tool
  | "house";    // stack.manager_loop

export type HandlerType =
  | "start"
  | "exit"
  | "codergen"
  | "wait.human"
  | "conditional"
  | "parallel"
  | "parallel.fan_in"
  | "tool"
  | "stack.manager_loop";

export const SHAPE_TO_HANDLER: Record<string, HandlerType> = {
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
  house: "stack.manager_loop",
};

export type OutcomeStatus =
  | "success"
  | "partial_success"
  | "retry"
  | "fail"
  | "skipped";

export type FidelityMode =
  | "full"
  | "compact"
  | "summary:high"
  | "summary:medium"
  | "summary:low"
  | "truncate";

export type JoinPolicy = "wait_all" | "k_of_n" | "first_success" | "quorum";
export type ErrorPolicy = "continue" | "fail_fast" | "ignore";

// ─── Graph Model ────────────────────────────────────────────────────────────

export interface NodeAttributes {
  label?: string;
  shape?: string;
  type?: string;
  prompt?: string;
  llm_model?: string;
  llm_provider?: string;
  reasoning_effort?: "low" | "medium" | "high";
  max_retries?: number;
  timeout?: string;
  goal_gate?: boolean;
  retry_target?: string;
  fallback_retry_target?: string;
  allow_partial?: boolean;
  fidelity?: FidelityMode;
  thread_id?: string;
  class?: string;
  tool_command?: string;
  join_policy?: JoinPolicy;
  error_policy?: ErrorPolicy;
  max_parallel?: number;
  [key: string]: unknown;
}

export interface GraphNode {
  id: string;
  attributes: NodeAttributes;
}

export interface EdgeAttributes {
  label?: string;
  condition?: string;
  weight?: number;
  fidelity?: FidelityMode;
  thread_id?: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  attributes: EdgeAttributes;
}

export interface GraphAttributes {
  goal?: string;
  default_fidelity?: FidelityMode;
  default_max_retry?: number;
  retry_target?: string;
  fallback_retry_target?: string;
  model_stylesheet?: string;
  [key: string]: unknown;
}

export interface Graph {
  name: string;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  attributes: GraphAttributes;
  node_defaults: Record<string, string>;
  edge_defaults: Record<string, string>;
}

// ─── Outcome ────────────────────────────────────────────────────────────────

export interface Outcome {
  status: OutcomeStatus;
  preferred_label?: string;
  suggested_next_ids?: string[];
  context_updates: Record<string, unknown>;
  notes?: string;
  failure_reason?: string;
}

// ─── Context ────────────────────────────────────────────────────────────────

export class PipelineContext {
  private store = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get(key: string, defaultValue?: unknown): unknown {
    return this.store.has(key) ? this.store.get(key) : defaultValue;
  }

  snapshot(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this.store) {
      obj[k] = v;
    }
    return obj;
  }

  clone(): PipelineContext {
    const ctx = new PipelineContext();
    for (const [k, v] of this.store) {
      ctx.store.set(k, JSON.parse(JSON.stringify(v)));
    }
    return ctx;
  }

  applyUpdates(updates: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(updates)) {
      this.store.set(k, v);
    }
  }

  keys(): string[] {
    return [...this.store.keys()];
  }
}

// ─── Checkpoint ─────────────────────────────────────────────────────────────

export interface Checkpoint {
  timestamp: string;
  current_node: string;
  completed_nodes: string[];
  node_retries: Record<string, number>;
  context_values: Record<string, unknown>;
  logs: string[];
}

// ─── Handler Interface ──────────────────────────────────────────────────────

export interface HandlerContext {
  node: GraphNode;
  context: PipelineContext;
  graph: Graph;
  logs_root: string;
}

export type Handler = (ctx: HandlerContext) => Promise<Outcome>;

// ─── Interviewer ────────────────────────────────────────────────────────────

export type QuestionType =
  | "yes_no"
  | "multiple_choice"
  | "freeform"
  | "confirmation";

export interface QuestionOption {
  key: string;
  label: string;
}

export interface Question {
  text: string;
  type: QuestionType;
  options?: QuestionOption[];
  default?: Answer;
  timeout_seconds?: number;
  stage?: string;
  metadata?: Record<string, unknown>;
}

export interface Answer {
  value: string; // "yes" | "no" | "skipped" | "timeout" | custom
  selected_option?: QuestionOption;
  text?: string;
}

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
  inform?(message: string, stage?: string): void;
}

// ─── Codergen Backend ───────────────────────────────────────────────────────

export interface CodergenBackend {
  run(
    node: GraphNode,
    prompt: string,
    context: PipelineContext
  ): Promise<Outcome>;
}

// ─── Pipeline Events ────────────────────────────────────────────────────────

export type PipelineEventType =
  | "pipeline_started"
  | "pipeline_completed"
  | "pipeline_failed"
  | "stage_started"
  | "stage_completed"
  | "stage_failed"
  | "stage_retrying"
  | "parallel_started"
  | "parallel_branch_started"
  | "parallel_branch_completed"
  | "parallel_completed"
  | "interview_started"
  | "interview_completed"
  | "interview_timeout"
  | "checkpoint_saved";

export interface PipelineEvent {
  type: PipelineEventType;
  timestamp: Date;
  data: Record<string, unknown>;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ─── Validation ─────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationResult {
  severity: ValidationSeverity;
  message: string;
  node_id?: string;
}

// ─── Stylesheet Rule ────────────────────────────────────────────────────────

export interface StylesheetRule {
  selector: string;
  specificity: number;
  properties: Record<string, string>;
}

// ─── Retry Preset ───────────────────────────────────────────────────────────

export interface RetryPreset {
  max_retries: number;
  initial_delay_ms: number;
  backoff_factor: number;
  max_delay_ms: number;
  jitter: boolean;
}

export const RETRY_PRESETS: Record<string, RetryPreset> = {
  none: { max_retries: 0, initial_delay_ms: 0, backoff_factor: 1, max_delay_ms: 0, jitter: false },
  standard: { max_retries: 5, initial_delay_ms: 200, backoff_factor: 2, max_delay_ms: 10000, jitter: true },
  aggressive: { max_retries: 5, initial_delay_ms: 500, backoff_factor: 2, max_delay_ms: 10000, jitter: true },
  linear: { max_retries: 3, initial_delay_ms: 500, backoff_factor: 1, max_delay_ms: 500, jitter: false },
  patient: { max_retries: 3, initial_delay_ms: 2000, backoff_factor: 3, max_delay_ms: 30000, jitter: true },
};

// ─── Artifact Store ─────────────────────────────────────────────────────────

export interface ArtifactInfo {
  id: string;
  name: string;
  size: number;
  file_backed: boolean;
}
