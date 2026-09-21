import { ArtifactSecurityReviewAgent } from "../domain/artifact-security";

const MAX_INPUT_BYTES = 6_000_000;
let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES) {
    process.stderr.write("Artifact review input exceeded 6 MB.\n");
    process.exit(2);
  }
});

process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input) as { manifest: unknown; files: Record<string, string>; sourceDigest: string; bundleDigest: string | null };
    const review = new ArtifactSecurityReviewAgent().review(payload);
    process.stdout.write(JSON.stringify({ ...review, reviewer: "voidra-isolated-security-agent/v1" }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Artifact review failed."}\n`);
    process.exitCode = 1;
  }
});
