# Browser recording backup

When browser backup is available, recording chunks are saved to IndexedDB on the recording device without encryption. Anyone with access to the browser profile or its stored site data may be able to read them. Do not use a shared device unless that access is acceptable. The existing optional passphrase-protected recovery is separate.

Backup storage is best-effort. Clearing site data, private browsing, switching devices or profiles, browser eviction, storage limits, and device failure can remove it. A request for persistent storage does not guarantee persistence. A warning is shown when the application detects a storage failure; it cannot guarantee recovery after a crash.

Backups are retained until an authenticated recording-specific backend confirmation matches the recording, host, meeting, occurrence, selected destination, verified Drive file, History link, length and SHA-256. The application retries this check when the host opens Recover Recordings. If an intent or confirmation is unavailable or inconsistent, the backup stays on the device. The confirmation service is currently restricted to disposable test environments, so production cleanup is not available.

Completed browser backups can be opened in the existing manual upload review after account and meeting authorization and a browser playability check. Interrupted chunks may not form playable media, even when their sequence and size are intact. Interrupted recordings can be downloaded for best-effort recovery but cannot be uploaded through this path.
