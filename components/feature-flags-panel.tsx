"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestService } from "@/components/service-types";

type Feature = { id: string; enabled: boolean; locked: boolean; source: string };

export function FeatureFlagsPanel({ workspaceId, request }: { workspaceId: string; request: RequestService }) {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => { const result = await request("feature.list", {}, workspaceId); if (result.ok) setFeatures((result.data.features as Feature[]) ?? []); else setMessage(result.error.message); }, [request, workspaceId]);
  useEffect(() => { void load(); }, [load]);
  return <article className="panel settings-card" aria-label="V2 feature rollback controls"><p className="card-label">V2 FEATURE ROLLBACK</p><small>Disabling a bundle hides or blocks its V2 execution path. Persisted V1 and V2 data is retained; core Notes, Graph, browser, settings, and manual planning remain available.</small><div className="compact-list">{features.map((feature) => <label className="check-label" key={feature.id}><input type="checkbox" checked={feature.enabled} disabled={feature.locked} onChange={async (event) => { const enabled = event.currentTarget.checked; const result = await request("feature.set", { feature: feature.id, enabled }, workspaceId); if (result.ok) { setFeatures((result.data.features as Feature[]) ?? []); setMessage(`${feature.id} ${enabled ? "enabled" : "disabled"}; persisted data was retained.`); } else setMessage(result.error.message); }} /> <span><strong>{feature.id}</strong><small>{feature.source}{feature.locked ? " · locked by launch policy" : ""}</small></span></label>)}</div>{message && <p className="save-message" role="status">{message}</p>}</article>;
}
