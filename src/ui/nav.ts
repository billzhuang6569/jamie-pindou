import { useEffect, useRef } from 'react';

export type Route = { screen: 'home' } | { screen: 'setup'; id: string } | { screen: 'result'; id: string };

const toHash = (r: Route) => (r.screen === 'home' ? '#/' : r.screen === 'setup' ? `#/p/${r.id}/setup` : `#/p/${r.id}`);

export function readRoute(): Route {
  const m = location.hash.match(/^#\/p\/([^/]+)(\/setup)?$/);
  if (!m) return { screen: 'home' };
  return m[2] ? { screen: 'setup', id: m[1] } : { screen: 'result', id: m[1] };
}

type EntryState = { depth: number };
const currentDepth = () => (history.state as EntryState | null)?.depth ?? 0;

export const pushRoute = (r: Route) => history.pushState({ depth: currentDepth() + 1 } satisfies EntryState, '', toHash(r));
export const replaceRoute = (r: Route) => history.replaceState({ depth: currentDepth() } satisfies EntryState, '', toHash(r));
/** Makes this entry the root: a reload keeps the old depth, which no longer means anything. */
export const resetToRoot = (r: Route) => history.replaceState({ depth: 0 } satisfies EntryState, '', toHash(r));
/** Whether a real history entry within the app sits behind this one. */
export const canGoBack = () => currentDepth() > 0;

/**
 * Open sheets and edit modes get the first say on the system back button: back should close
 * what's on top rather than leave the page. Each guard returns true if it handled the press.
 */
const guards: (() => boolean)[] = [];

export function runBackGuards(): boolean {
  for (let i = guards.length - 1; i >= 0; i--) {
    if (guards[i]()) return true;
  }
  return false;
}

export function useBackGuard(handler: () => boolean) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const guard = () => latest.current();
    guards.push(guard);
    return () => {
      guards.splice(guards.indexOf(guard), 1);
    };
  }, []);
}
