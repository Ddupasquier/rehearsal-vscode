/** Owned public-CLI test double. Never unpack, edit or execute the recorded Core tar. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEngineShutdownPreview } from "../src/engine_lifecycle_contract.js";
import type { parseNativeEngineFixture } from "./engine-lifecycle-fixture.js";
import { nativeConsumerFingerprint } from "./native-insights-consumer.js";

export async function prepareNativeEngineConsumer(
  workspace: string,
  temporary: string,
  fixture: ReturnType<typeof parseNativeEngineFixture>,
) {
  const root = join(workspace, "node_modules/@rehearsal-db/core");
  await mkdir(root, { recursive: true });
  const configurationSource =
    "export default { schemaVersion: 1 }; // synthetic file-only UI fixture\n";
  await writeFile(
    join(workspace, "rehearsal.config.mjs"),
    configurationSource,
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    join(temporary, "engine-configuration-metadata.json"),
    JSON.stringify({
      schemaVersion: 1,
      path: "rehearsal.config.mjs",
      sourceSha256: createHash("sha256")
        .update(configurationSource)
        .digest("hex"),
      fields: [],
      profiles: [],
      pathResolution: "Synthetic workspace-local UI fixture",
      manualFields: "Synthetic UI fixture; no Core validation claim",
      patchContract: {
        schemaVersion: 1,
        input: "project-local-json-file",
        maximumBytes: 65536,
        writesConfiguration: false,
        executesProposedCommands: false,
        concurrentChanges: "refuse",
      },
    }),
    { flag: "wx", mode: 0o600 },
  );
  const preview = parseEngineShutdownPreview({
    schemaVersion: 1,
    action: "engine-stop",
    state: "review-required",
    reason: "ready",
    consentDigest: "b".repeat(64),
    engine: {
      backend: "colima",
      profile: "default",
      context: "colima",
      endpointIdentity: "a".repeat(64),
      daemonId: "synthetic-daemon",
      bootId: "a".repeat(32),
      vmIdentity: "c".repeat(64),
    },
    impact: {
      containers: [
        {
          id: "d".repeat(64),
          name: "synthetic-other-project",
          state: "running",
          restartCount: 0,
          startedAt: "2026-10-25T00:00:00Z",
          finishedAt: "0001-01-01T00:00:00Z",
        },
      ],
      runningCount: 1,
    },
    safety: fixture.status.safety,
  });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@rehearsal-db/core",
      version: fixture.coreVersion,
      type: "module",
      bin: { rehearsal: "cli.mjs" },
      rehearsalContracts: { containerEngineLifecycle: 1 },
      description:
        "Synthetic native UI public CLI test double; not the recorded Core artifact.",
    }),
    { flag: "wx", mode: 0o600 },
  );
  const script = `import fs from 'node:fs';
const args=process.argv.slice(2), version=${JSON.stringify(fixture.coreVersion)}, status=${JSON.stringify(fixture.status)}, preview=${JSON.stringify(preview)};
const scenarioPath=${JSON.stringify(join(temporary, "engine-scenario.json"))}, logPath=${JSON.stringify(join(temporary, "engine-dispatch.jsonl"))};
const scenario=JSON.parse(fs.readFileSync(scenarioPath,'utf8')).scenario;
const envelope=(command,data,status='success')=>({schemaVersion:1,rehearsalVersion:version,command,status,startedAt:'2026-10-25T00:00:00Z',durationMs:1,warnings:[],data});
let result,exit=0;
if(args[0]==='--version') result={name:'@rehearsal-db/core',version};
else if(args[0]==='activity' && !args.some(a=>a.startsWith('--config'))) result=envelope('activity',{schemaVersion:1,state:'idle',operation:null});
else if(args[0]==='doctor') {result=envelope('doctor',{state:'NOT READY',checks:[{id:'configuration',label:'Configuration',status:'fail',detail:'Synthetic project intentionally not ready.'}]},'not_ready');exit=1;}
else if(args[0]==='engine' && args[1]==='status') result=envelope('engine status',status);
else if(args[0]==='engine' && args[1]==='stop' && !args.some(a=>a.startsWith('--confirm-engine-stop='))) {fs.appendFileSync(${JSON.stringify(join(temporary, "engine-preview.jsonl"))},JSON.stringify({scenario,preview:true})+'\\n');result=envelope('engine stop',preview);}
else if(args[0]==='engine' && args[1]==='stop' && args.includes('--confirm-engine-stop='+preview.consentDigest)) {
fs.appendFileSync(logPath,JSON.stringify({scenario,applied:true})+'\\n');
const certain=scenario==='confirm-success';result=envelope('engine stop',{schemaVersion:1,status:certain?'stopped':'unknown',reason:certain?'shutdown-confirmed':'shutdown-unconfirmed',engine:preview.engine,confirmed:{profileStopped:certain,vmProcessAbsent:certain},selectionAfter:null,safety:status.safety},certain?'success':'error');exit=certain?0:1;
} else { throw Error('Synthetic CLI refuses undeclared command.'); }
process.stdout.write(JSON.stringify(result));process.exitCode=exit;
`;
  await writeFile(join(root, "cli.mjs"), script, { flag: "wx", mode: 0o600 });
  await writeFile(
    join(temporary, "engine-scenario.json"),
    JSON.stringify({ scenario: "cancel" }),
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(join(temporary, "engine-dispatch.jsonl"), "", {
    flag: "wx",
    mode: 0o600,
  });
  return nativeConsumerFingerprint(workspace);
}
