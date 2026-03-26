import type { ArtifactRef } from './group-types';

export interface ResearchWorkPackage {
  templateId: 'research-template-1';
  taskId: string;
  goal: string;
  sourceRunIds: string[]; // typically data fetching runs
  requestedDeliverables: string[];
  successCriteria: string[];
  referencedArtifacts: ArtifactRef[];
  methodology?: string[];
}

export interface ResearchDeliveryPacket {
  templateId: 'research-template-1';
  taskId: string;
  status: 'completed' | 'blocked';
  summary: string;
  methodologyUsed: string[];
  findings: Array<{
    title: string;
    description: string;
    confidenceLevel: 'high' | 'medium' | 'low';
  }>;
  primaryArtifactId: string;
}
