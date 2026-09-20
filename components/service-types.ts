import type { ServiceRequest, ServiceResponse } from "@/src/shared/contracts";

export type RequestService = (
  operation: ServiceRequest["operation"],
  payload: Record<string, unknown>,
  workspaceId?: string,
) => Promise<ServiceResponse>;
