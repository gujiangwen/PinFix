import type { AnnotationSessionDetail } from "@sightloop/markup-bridge";

export type AgentActContext = {
  sessionId: string;
  repoPath: string;
  pageUrl: string;
  annotation: AnnotationSessionDetail | null;
  sniff: unknown;
  refineNote?: string | null;
  knowledgeStub: Array<{ title: string; body_md: string }>;
  fileWhitelist: string[];
  maxSteps: number;
  stepBudget: number;
};

export type AgentActResult = {
  summary: string;
  stepsUsed: number;
  filesTouched: string[];
  dryRun: boolean;
  runner: "mock" | "pi";
  detail?: unknown;
};

export type AgentRunner = {
  readonly name: "mock" | "pi";
  act(ctx: AgentActContext): Promise<AgentActResult>;
};
