/**
 * Pipeline subsystem — DAG compilation, graph pipeline, and runtime query engine.
 *
 * This module re-exports the public API of the pipeline subsystem.
 */

// Types
export type { TemplateDefinition, PipelineStage } from './pipeline-types';
export type { DagIR, DagNode, DagEdge, DagNodeKind, DagNodeActivation } from './dag-ir-types';
export type { GraphPipeline, GraphPipelineNode, GraphPipelineEdge } from './graph-pipeline-types';

// Compilation
export { getOrCompileIR, compileTemplateToIR, invalidateIRCache, clearIRCache } from './dag-compiler';
export { compileGraphPipelineToIR, validateGraphPipeline } from './graph-compiler';

// Runtime queries
export { canActivateNode, getDownstreamNodes, getActivatableNodes, filterSourcesByNode } from './dag-runtime';

// Utilities
export { resolveStageId, getStageIndex, validateTemplatePipeline } from './pipeline-graph';
export { pipelineToGraphPipeline, graphPipelineToPipeline } from './graph-pipeline-converter';

// Registry (thin wrapper — consider importing dag-compiler + dag-runtime directly)
export { listPipelines, getPipeline, getDownstreamStages, canActivateStage, filterSourcesByContract, reloadPipelines } from './pipeline-registry';
