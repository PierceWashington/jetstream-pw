import { logger } from '@jetstream/shared/client-logger';
import { JetstreamRepoSourceUi } from '@jetstream/types';

let repoWindowRef: Window | null = null;
let repoCallbackFn: ((repoSource: JetstreamRepoSourceUi) => void) | null = null;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;

function clearRepoWindowState() {
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  repoWindowRef = null;
  repoCallbackFn = null;
  activeSourceType = null;
  window.removeEventListener('message', handleRepoWindowEvent);
}

/** Source types that can be connected via OAuth popup. */
export type RepoSourceType = 'github' | 'bitbucket';

/** OAuth endpoint paths and display names for each source type. */
const SOURCE_CONFIG: Record<RepoSourceType, { oauthPath: string; windowTitle: string }> = {
  github: { oauthPath: '/oauth/github/auth', windowTitle: 'Add GitHub Repository' },
  bitbucket: { oauthPath: '/oauth/bitbucket/auth', windowTitle: 'Add Bitbucket Repository' },
};

/** The source type used for the currently open popup — needed to filter postMessages. */
let activeSourceType: RepoSourceType | null = null;

/**
 * Listen for a postMessage from the OAuth redirect page.
 * Each source type sends `{ type: 'github' | 'bitbucket', data: JetstreamRepoSourceUi }`.
 */
function handleRepoWindowEvent(event: MessageEvent) {
  if (typeof event.data !== 'string') {
    return;
  }
  try {
    const payload = JSON.parse(event.data);
    if (payload?.type !== activeSourceType) {
      return;
    }
    logger.log('[addRepoSource] received oauth completion message', payload);
    if (repoCallbackFn && payload.data) {
      repoCallbackFn(payload.data as JetstreamRepoSourceUi);
    }
    if (repoWindowRef) {
      repoWindowRef.close();
    }
    clearRepoWindowState();
  } catch {
    // Not a valid JSON message — ignore
  }
}

/**
 * Open a popup window to initiate OAuth for the given source type and call
 * `callback` with the new JetstreamRepoSourceUi when the flow completes.
 *
 * If the popup is closed without completing the flow, the callback is not called.
 */
export function addRepoSource(
  options: { serverUrl: string; type: RepoSourceType },
  callback: (repoSource: JetstreamRepoSourceUi) => void,
): void {
  const config = SOURCE_CONFIG[options.type];
  activeSourceType = options.type;
  repoCallbackFn = callback;
  window.removeEventListener('message', handleRepoWindowEvent);

  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  const strWindowFeatures = 'toolbar=no, menubar=no, width=1025, height=700';
  const url = new URL(`${options.serverUrl}${config.oauthPath}`);
  url.searchParams.set('clientUrl', document.location.origin);

  repoWindowRef = window.open(url.toString(), config.windowTitle, strWindowFeatures);
  window.addEventListener('message', handleRepoWindowEvent, false);

  // Poll to detect popup closure (e.g. user cancelled) and clean up state
  pollIntervalId = setInterval(() => {
    if (repoWindowRef && repoWindowRef.closed) {
      clearRepoWindowState();
    }
  }, 1000);
}
