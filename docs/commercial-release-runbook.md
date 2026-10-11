# Commercial preview release runbook

1. Freeze one reviewed core artifact and one extension commit candidate.
2. Run `npm run check` and `npm run commercial:verify`.
3. Run `npm run test:lab -- /absolute/path/to/core.tgz`.
4. Complete the real-consumer check without changing that consumer's tracked files.
5. Package once with `npm run package:vsix -- --out /absolute/path/to/rehearsal-VERSION.vsix`.
6. Verify that exact file with `npm run verify:vsix -- /absolute/path/to/rehearsal-VERSION.vsix`.
   To verify an upgrade too, append the previous reviewed VSIX as the second path.
7. Record extension/core versions, SHA-256 values, supported platforms, known limitations,
   and the acceptance report paths.
8. Have the owner review the diff, legal terms, price, refund policy, support contact, and
   checkout copy.
9. Only after separate approval, commit and distribute or publish the exact tested file.
10. Keep the previous customer artifact and rollback instructions available.

Never rebuild after approval and present the new bytes under the old checksum. Never place
signing keys, payment secrets, customer details, or license records in Git.
