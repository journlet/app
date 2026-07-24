// Global test setup. The journal store creates an IndexeddbPersistence at
// import time, which needs an IndexedDB implementation; fake-indexeddb/auto
// installs one on globalThis for the node test environment.
import "fake-indexeddb/auto";
