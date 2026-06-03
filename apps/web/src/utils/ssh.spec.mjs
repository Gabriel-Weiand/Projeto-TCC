import assert from "node:assert/strict";
import { buildSshCommand, buildSftpCommand, effectiveSshPort } from "./ssh.ts";

assert.equal(effectiveSshPort(null), 22);
assert.equal(effectiveSshPort(undefined), 22);
assert.equal(effectiveSshPort(2222), 2222);

assert.equal(buildSshCommand("10.0.0.1", "lab.user"), "ssh lab.user@10.0.0.1");
assert.equal(buildSshCommand("10.0.0.1", "lab.user", null), "ssh lab.user@10.0.0.1");
assert.equal(
  buildSshCommand("10.0.0.1", "lab.user", 2222),
  "ssh -p 2222 lab.user@10.0.0.1",
);

assert.equal(buildSftpCommand("10.0.0.1", "lab.user"), "sftp lab.user@10.0.0.1");
assert.equal(
  buildSftpCommand("10.0.0.1", "lab.user", 2222),
  "sftp -P 2222 lab.user@10.0.0.1",
);

console.log("ssh.spec.mjs: ok");
