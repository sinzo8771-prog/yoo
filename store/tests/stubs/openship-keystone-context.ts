// Test-only stand-in for OpenShip's Keystone context
// (openship: @/features/keystone/context). The real context boots a full
// Keystone instance; ingestion tests drive the REAL pinned route/adapter code
// while injecting in-memory Keystone resolvers through `state.query`.
export const state: { query: Record<string, any> } = { query: {} };
export const keystoneContext = {
  sudo: () => ({ query: state.query }),
};
