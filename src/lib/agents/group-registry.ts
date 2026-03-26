/**
 * V2.5 Multi-Agent System — Group Registry
 *
 * Static registry of agent groups.
 * V2: adds templateId, capabilities, and architecture-advisory group.
 * V2.5: adds executionMode, sourceContract, and autonomous-dev-pilot group.
 */

import type { GroupDefinition } from './group-types';
import { AssetLoader } from './asset-loader';

export function listGroups(): GroupDefinition[] {
  return AssetLoader.loadAllGroups();
}

export function getGroup(id: string): GroupDefinition | null {
  return AssetLoader.loadAllGroups().find(g => g.id === id) ?? null;
}
