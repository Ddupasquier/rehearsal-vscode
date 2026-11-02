/** The Marketplace identity is distinct from the immutable pre-0.1.19 VSIX identity. */
export const EXTENSION_PUBLISHER = "rehearsal-db";
export const EXTENSION_NAME = "rehearsal-db";
export const EXTENSION_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`;
export const LEGACY_EXTENSION_ID = "rehearsal-db.rehearsal";

/** Callers validate the published version before constructing any path or URL. */
export const extensionArtifactFilename = (version: string): string =>
  `${EXTENSION_NAME}-${version}.vsix`;
