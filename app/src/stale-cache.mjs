// The engine serves the plugin's client.js from a URL that does not change between builds.
// Chromium keeps that file in the window's HTTP cache, so after an app update the window
// would open on the previous interface — the Session map entry missing, for one. The files
// are local and fetch again in milliseconds, so the cache is dropped before the first load.
// Only the caches are dropped: cookies, local storage and the user's data stay.
export async function dropStaleCache(session) {
  await session.clearCache()
  // A future engine could serve the window through a service worker; its cache is separate.
  await session.clearStorageData({ storages: ['cachestorage'] }).catch(() => {})
}
