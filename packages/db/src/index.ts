export { openDatabase, type Database } from "./client.js";
export { migrate } from "./migrate.js";
export {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from "./projects.js";
export {
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  updateSession,
  countActiveSessionsForProject,
  type SessionPatch,
} from "./sessions.js";
export { insertAgentStep, listAgentSteps } from "./steps.js";
export { insertReview, listReviews } from "./reviews.js";
export {
  insertKnowledge,
  createKnowledgeFromInput,
  getKnowledge,
  listKnowledge,
  queryKnowledge,
  matchKnowledgeForRetrieve,
  updateKnowledge,
  deleteKnowledge,
  listKnowledgeByIds,
} from "./knowledge.js";
export { insertAudit, listAudit, getMetrics } from "./audit.js";
export {
  loadSqliteVec,
  ensureVectorSchema,
  upsertKnowledgeEmbedding,
  deleteKnowledgeEmbedding,
  searchKnowledgeVec,
  reindexAllKnowledge,
  isVecReady,
} from "./vectors.js";
export { embedText, embedKnowledgeCard, EMBED_DIM, EMBED_MODEL_ID } from "./embed.js";
export {
  listLocationHints,
  findLocationHint,
  upsertLocationHint,
  bumpLocationHintHit,
  getLocationHint,
} from "./location-hints.js";
export {
  createAcceptanceRun,
  getAcceptanceRun,
  listAcceptanceRuns,
  getLatestAcceptanceRun,
  updateAcceptanceRun,
  setSessionAcceptanceCache,
  getBaseline,
  upsertBaseline,
  type BaselineRow,
} from "./acceptance-runs.js";
export {
  setSessionPlan,
  setSessionAgentReview,
  getSessionPlan,
  getSessionAgentReview,
} from "./dual-loop.js";
