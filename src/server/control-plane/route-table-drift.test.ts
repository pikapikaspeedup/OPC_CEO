import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Drift guard for the split-process route tables.
 *
 * In the web+api topology, every Next.js API route with a proxy branch
 * (shouldProxyControlPlaneRequest / shouldProxyRuntimeRequest) is forwarded to
 * the standalone api/control-plane/runtime server, which serves it via a
 * hand-written regex route table. If a proxy-branch route is added without a
 * matching regex entry, web->api requests for it silently 404.
 *
 * This test fails the moment such drift is introduced, so the implicit
 * filesystem route table and the explicit regex table cannot fall out of sync
 * unnoticed.
 */

const API_DIR = path.join(process.cwd(), 'src', 'app', 'api');
const REGEX_TABLE_FILES = [
  'src/server/control-plane/server.ts',
  'src/server/control-plane/company-routes.ts',
  'src/server/runtime/server.ts',
];

function collectProxyRouteApiPaths(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectProxyRouteApiPaths(full));
    } else if (entry.name === 'route.ts') {
      const src = readFileSync(full, 'utf8');
      if (/shouldProxy(ControlPlane|Runtime)Request/.test(src)) {
        const marker = `${path.sep}app${path.sep}`;
        const apiPath = full
          .slice(full.indexOf(marker) + marker.length - 1)
          .replace(new RegExp(`\\${path.sep}route\\.ts$`), '')
          .split(path.sep)
          .join('/');
        out.push(apiPath);
      }
    }
  }
  return out;
}

function collectRegexPatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  for (const file of REGEX_TABLE_FILES) {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8');
    for (const match of src.matchAll(/pattern:\s*(\/\^[^\n]+?\/)[,\s]/g)) {
      try {
        patterns.push(new RegExp(match[1].slice(1, -1)));
      } catch {
        // ignore unparseable pattern fragments
      }
    }
  }
  return patterns;
}

describe('split route-table drift guard', () => {
  it('every proxy-branch Next API route is covered by the regex route table', () => {
    const proxyRoutes = collectProxyRouteApiPaths(API_DIR);
    const patterns = collectRegexPatterns();

    expect(proxyRoutes.length).toBeGreaterThan(0);
    expect(patterns.length).toBeGreaterThan(0);

    // Replace dynamic segments ([id], [...slug]) with a concrete token so the
    // path can be matched against the regex patterns.
    const missing = proxyRoutes.filter((route) => {
      const concrete = route.replace(/\[[^\]]+\]/g, 'x');
      return !patterns.some((re) => re.test(concrete));
    });

    expect(
      missing,
      'These proxy-branch routes are not served by the api/control-plane/runtime regex ' +
        `table (web->api would 404). Add a matching entry in one of: ${REGEX_TABLE_FILES.join(', ')}.`,
    ).toEqual([]);
  });
});
