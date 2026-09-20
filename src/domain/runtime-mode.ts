export function isTestRuntime(environment: NodeJS.ProcessEnv = process.env) {
  return environment.VOIDRA_RUNTIME_MODE === "test";
}

export function allowsLoopbackRemoteFixture(environment: NodeJS.ProcessEnv = process.env) {
  return isTestRuntime(environment) && environment.VOIDRA_REMOTE_GATEWAY_TEST === "1";
}
