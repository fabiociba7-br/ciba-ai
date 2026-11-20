import type { ResearchEnv, VisualMode } from "./types";
export interface VisualSession {
  sessionId: string; topic: string; mode: VisualMode; currentIteration: number;
  latestImageR2Key: string | null; promptHistory: Array<Record<string, unknown>>;
}
export interface VisualAsset {
  id: string; sessionId: string; iteration: number; r2Key: string; imageUrl: string;
  promptUsed: string; visionAnalysis: string; userFeedback: string | null;
  sourceKind: string; mimeType: string; createdAt: string;
}
interface SessionRow { session_id: string; topic: string; mode: VisualMode; current_iteration: number; latest_image_r2_key: string | null; prompt_history: string; }
function mapSession(row: SessionRow): VisualSession {
  let history: Array<Record<string, unknown>> = [];
  try { const parsed: unknown = JSON.parse(row.prompt_history); if (Array.isArray(parsed)) history = parsed as Array<Record<string, unknown>>; } catch { /* corrupted history is not executable */ }
  return { sessionId: row.session_id, topic: row.topic, mode: row.mode, currentIteration: row.current_iteration,
    latestImageR2Key: row.latest_image_r2_key, promptHistory: history };
}
export class VisualSessionManager {
  constructor(private readonly env: ResearchEnv) {}
  async startSession(topic: string, mode: VisualMode): Promise<VisualSession> {
    const sessionId = crypto.randomUUID(), now = new Date().toISOString();
    await this.env.DB.prepare("INSERT INTO visual_sessions (session_id, owner_id, app_id, device_id, topic, mode, current_iteration, latest_image_r2_key, prompt_history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, '[]', ?, ?)")
      .bind(sessionId, this.env.ownerId, this.env.appId, this.env.deviceId, topic, mode, now, now).run();
    return { sessionId, topic, mode, currentIteration: 0, latestImageR2Key: null, promptHistory: [] };
  }
  async getSession(sessionId: string): Promise<VisualSession> {
    const row = await this.env.DB.prepare("SELECT session_id, topic, mode, current_iteration, latest_image_r2_key, prompt_history FROM visual_sessions WHERE session_id = ? AND owner_id = ? AND app_id = ? AND device_id = ?")
      .bind(sessionId, this.env.ownerId, this.env.appId, this.env.deviceId).first<SessionRow>();
    if (!row) throw new Error("visual_session_not_found");
    return mapSession(row);
  }
  async iterate(sessionId: string, feedback: string): Promise<VisualSession> {
    const session = await this.getSession(sessionId);
    if (!feedback.trim() || feedback.length > 1200) throw new Error("invalid_visual_feedback");
    const nextIteration = session.currentIteration + 1;
    const history = [...session.promptHistory, { iteration: nextIteration, feedback: feedback.trim(), at: new Date().toISOString() }].slice(-20);
    const result = await this.env.DB.prepare("UPDATE visual_sessions SET current_iteration = ?, prompt_history = ?, updated_at = ? WHERE session_id = ? AND owner_id = ? AND app_id = ? AND device_id = ? AND current_iteration = ?")
      .bind(nextIteration, JSON.stringify(history), new Date().toISOString(), sessionId, this.env.ownerId, this.env.appId, this.env.deviceId, session.currentIteration).run();
    if (result.meta.changes !== 1) throw new Error("visual_session_iteration_conflict");
    return { ...session, currentIteration: nextIteration, promptHistory: history };
  }
  async saveAsset(session: VisualSession, asset: Omit<VisualAsset, "id" | "sessionId" | "createdAt">): Promise<VisualAsset> {
    const id = crypto.randomUUID(), createdAt = new Date().toISOString();
    await this.env.DB.batch([
      this.env.DB.prepare("INSERT INTO visual_assets (id, session_id, iteration, r2_key, image_url, prompt_used, vision_analysis, user_feedback, source_kind, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, session.sessionId, session.currentIteration, asset.r2Key, asset.imageUrl, asset.promptUsed, asset.visionAnalysis, asset.userFeedback, asset.sourceKind, asset.mimeType, createdAt),
      this.env.DB.prepare("UPDATE visual_sessions SET latest_image_r2_key = ?, updated_at = ? WHERE session_id = ? AND owner_id = ? AND app_id = ? AND device_id = ?")
        .bind(asset.r2Key, createdAt, session.sessionId, this.env.ownerId, this.env.appId, this.env.deviceId),
    ]);
    return { ...asset, id, sessionId: session.sessionId, createdAt };
  }
  async getLatestAsset(sessionId: string): Promise<VisualAsset | null> {
    await this.getSession(sessionId);
    const row = await this.env.DB.prepare("SELECT id, session_id, iteration, r2_key, image_url, prompt_used, vision_analysis, user_feedback, source_kind, mime_type, created_at FROM visual_assets WHERE session_id = ? ORDER BY iteration DESC LIMIT 1")
      .bind(sessionId).first<{ id: string; session_id: string; iteration: number; r2_key: string; image_url: string; prompt_used: string; vision_analysis: string; user_feedback: string | null; source_kind: string; mime_type: string; created_at: string }>();
    return row ? { id: row.id, sessionId: row.session_id, iteration: row.iteration, r2Key: row.r2_key, imageUrl: row.image_url,
      promptUsed: row.prompt_used, visionAnalysis: row.vision_analysis, userFeedback: row.user_feedback,
      sourceKind: row.source_kind, mimeType: row.mime_type, createdAt: row.created_at } : null;
  }
}
