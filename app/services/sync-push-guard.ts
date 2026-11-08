// Push preflight guards — implemented in kiokuflow-sync-core (shared protocol).

export {
  indexUniqueRemotePaths,
  findAmbiguousPushPaths,
  remoteChangedSincePushSnapshot,
  findPendingDeletionsChangedOnRemote,
  type PushSnapshotEntry,
} from "kiokuflow-sync-core/protocol";
