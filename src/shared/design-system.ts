import { z } from "zod";

export const HOST_DESIGN_SYSTEM_VERSION = "2.0.0" as const;
export const ARTIFACT_FACADE_VERSION = "1" as const;

const color = z.string().regex(/^(?:#[0-9a-f]{6}|rgba?\([^)]+\))$/i);
const duration = z.string().regex(/^\d+(?:\.\d+)?ms$/);

export const designTokenSchema = z.object({
  version: z.literal(HOST_DESIGN_SYSTEM_VERSION),
  colors: z.object({ canvas: color, surface: color, surfaceRaised: color, ink: color, muted: color, line: color, lineStrong: color, accent: color, success: color, warning: color, danger: color }).strict(),
  spacing: z.object({ xs: z.number().int().positive(), sm: z.number().int().positive(), md: z.number().int().positive(), lg: z.number().int().positive(), xl: z.number().int().positive() }).strict(),
  radius: z.object({ module: z.number().int().min(0).max(4), overlay: z.number().int().min(0).max(8) }).strict(),
  motion: z.object({ fast: duration, base: duration, reveal: duration, easing: z.string().min(1) }).strict(),
}).strict();

export const HOST_DESIGN_TOKENS = designTokenSchema.parse({
  version: HOST_DESIGN_SYSTEM_VERSION,
  colors: { canvas: "#050505", surface: "#090907", surfaceRaised: "#11100d", ink: "#f1e8d6", muted: "#918b80", line: "rgba(241,232,214,.15)", lineStrong: "rgba(241,232,214,.32)", accent: "#ff6a1a", success: "#a7c875", warning: "#e8b44e", danger: "#ff5d55" },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radius: { module: 2, overlay: 4 },
  motion: { fast: "120ms", base: "180ms", reveal: "220ms", easing: "cubic-bezier(.2,.8,.2,1)" },
});

export const ARTIFACT_DESIGN_TOKENS = {
  version: ARTIFACT_FACADE_VERSION,
  colors: HOST_DESIGN_TOKENS.colors,
  spacing: HOST_DESIGN_TOKENS.spacing,
  radius: { module: HOST_DESIGN_TOKENS.radius.module },
  motion: { fast: HOST_DESIGN_TOKENS.motion.fast, base: HOST_DESIGN_TOKENS.motion.base },
} as const;

export const ARTIFACT_PRIMITIVES = ["Canvas", "Module", "Metric", "Status", "Action", "EmptyState", "ErrorState", "StaleState", "PermissionPrompt", "ReviewAction"] as const;
export const REQUIRED_ARTIFACT_STATES = ["empty", "error", "stale", "permission", "review"] as const;

export function inspectDesignTokenUsage(css: string, boundary: "host" | "artifact") {
  const findings: string[] = [];
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  for (const match of css.matchAll(/var\((--[a-z0-9-]+)/gi)) if (!defined.has(match[1]) && !match[1]!.startsWith("--cc-") && !match[1]!.startsWith("--kg-")) findings.push(`Undefined token ${match[1]}`);
  for (const legacy of ["#7ff0cf", "#899dff", "#8cc3f5", "#111722", "#0c111b", "--mint", "--blue"]) if (css.toLowerCase().includes(legacy)) findings.push(`Legacy token ${legacy}`);
  if (boundary === "artifact" && /var\(--(?:cc|kg|v2)-/i.test(css)) findings.push("Artifact facade references a host-only token");
  return [...new Set(findings)].sort();
}

export const ARTIFACT_UI_MODULE_SOURCE = `import React from "react";
const tone=(value)=>["ready","warning","danger","neutral"].includes(value)?value:"neutral";
export function Canvas({title,subtitle,children}){return React.createElement("main",{className:"va-canvas"},React.createElement("header",null,React.createElement("p",null,"VOIDRA ARTIFACT"),React.createElement("h1",null,title),subtitle&&React.createElement("small",null,subtitle)),React.createElement("section",{className:"va-grid"},children));}
export function Module({label,children}){return React.createElement("article",{className:"va-module"},React.createElement("p",{className:"va-label"},label),children);}
export function Metric({value,label}){return React.createElement("div",{className:"va-metric"},React.createElement("strong",null,value),React.createElement("span",null,label));}
export function Status({tone:statusTone="ready",children}){return React.createElement("div",{className:"va-status","data-tone":tone(statusTone)},React.createElement("i"),children);}
export function Action({className="",...props}){return React.createElement("button",{...props,className:("va-action "+className).trim()});}
export function EmptyState({title="Nothing here yet",description,action}){return React.createElement("section",{className:"va-state","data-state":"empty"},React.createElement("strong",null,title),description&&React.createElement("p",null,description),action);}
export function ErrorState({title="Something went wrong",description,action}){return React.createElement("section",{className:"va-state","data-state":"error","aria-live":"polite"},React.createElement("strong",null,title),description&&React.createElement("p",null,description),action);}
export function StaleState({title="Data may be stale",description,action}){return React.createElement("section",{className:"va-state","data-state":"stale"},React.createElement("strong",null,title),description&&React.createElement("p",null,description),action);}
export function PermissionPrompt({title="Permission required",description,children}){return React.createElement("section",{className:"va-state","data-state":"permission"},React.createElement("strong",null,title),description&&React.createElement("p",null,description),children);}
export function ReviewAction({title,description,children}){return React.createElement("section",{className:"va-review"},React.createElement("div",null,React.createElement("strong",null,title),description&&React.createElement("p",null,description)),children);}`;

export const ARTIFACT_SDK_MODULE_SOURCE = `export async function requestCapability(capabilityId,args={}){if(typeof capabilityId!=="string"||!capabilityId)throw new Error("A declared capability id is required");if(!globalThis.voidraArtifact)throw new Error("Artifact capability bridge unavailable");return globalThis.voidraArtifact.request(capabilityId,args);}`;

export const ARTIFACT_FACADE_CSS = `:root{color-scheme:dark;--va-canvas:#050505;--va-surface:#090907;--va-surface-raised:#11100d;--va-ink:#f1e8d6;--va-muted:#918b80;--va-line:rgba(241,232,214,.15);--va-accent:#ff6a1a;--va-ready:#a7c875;--va-warning:#efb45e;--va-danger:#e56b62;--va-space-1:4px;--va-space-2:8px;--va-space-3:12px;--va-space-4:16px;--va-space-6:24px;--va-radius:2px;--va-motion-fast:120ms;--va-motion-base:180ms}*{box-sizing:border-box}body{margin:0;background:var(--va-canvas);color:var(--va-ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.va-canvas{min-height:100vh;padding:22px;background:linear-gradient(rgba(241,232,214,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(241,232,214,.018) 1px,transparent 1px);background-size:44px 44px}.va-canvas>header{padding-bottom:18px;border-bottom:1px solid var(--va-line)}.va-canvas>header p,.va-label{margin:0;color:var(--va-accent);font-size:9px;letter-spacing:.16em;text-transform:uppercase}.va-canvas h1{margin:7px 0 3px;font-size:clamp(28px,7vw,64px);font-weight:500;letter-spacing:-.05em}.va-canvas small,.va-state p,.va-review p{color:var(--va-muted)}.va-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;margin-top:18px;background:var(--va-line)}.va-module{min-height:190px;padding:16px;background:var(--va-surface)}.va-metric{display:grid;margin:26px 0}.va-metric strong{font:500 58px ui-monospace,SFMono-Regular,Menlo,monospace}.va-metric span{color:var(--va-muted);font-size:10px;text-transform:uppercase}.va-status{display:flex;align-items:center;gap:7px;color:var(--va-muted);font-size:10px}.va-status i{width:6px;height:6px;border-radius:50%;background:var(--va-ready)}.va-status[data-tone=warning] i{background:var(--va-warning)}.va-status[data-tone=danger] i{background:var(--va-danger)}.va-action{margin-top:18px;padding:9px 13px;border:1px solid color-mix(in srgb,var(--va-accent) 45%,transparent);border-radius:var(--va-radius);background:color-mix(in srgb,var(--va-accent) 8%,transparent);color:var(--va-ink);cursor:pointer;transition:background var(--va-motion-fast),transform var(--va-motion-fast)}.va-action:hover{background:color-mix(in srgb,var(--va-accent) 15%,transparent)}.va-action:active{transform:translateY(1px)}.va-action:focus-visible{outline:1px solid var(--va-accent);outline-offset:2px}.va-state,.va-review{padding:16px;border:1px solid var(--va-line);background:var(--va-surface-raised)}.va-state[data-state=error]{border-color:color-mix(in srgb,var(--va-danger) 60%,transparent)}.va-state[data-state=permission],.va-review{border-color:color-mix(in srgb,var(--va-accent) 45%,transparent)}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}`;
