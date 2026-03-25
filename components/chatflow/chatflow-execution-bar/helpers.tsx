import type { ChatflowNode } from '@lib/stores/chatflow-execution-store';
import { cn } from '@lib/utils';

export function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getNodeTitle(
  node: ChatflowNode,
  index: number,
  t: (key: string) => string
) {
  switch (node.type) {
    case 'start':
      return t('nodeTypes.start');
    case 'llm':
      return t('nodeTypes.llm');
    case 'knowledge-retrieval':
      return t('nodeTypes.knowledgeRetrieval');
    case 'question-classifier':
      return t('nodeTypes.questionClassifier');
    case 'if-else':
      return t('nodeTypes.ifElse');
    case 'code':
      return t('nodeTypes.code');
    case 'template-transform':
      return t('nodeTypes.templateTransform');
    case 'variable-assigner':
      return t('nodeTypes.variableAssigner');
    case 'variable-aggregator':
      return t('nodeTypes.variableAggregator');
    case 'document-extractor':
      return t('nodeTypes.documentExtractor');
    case 'parameter-extractor':
      return t('nodeTypes.parameterExtractor');
    case 'http-request':
      return t('nodeTypes.httpRequest');
    case 'list-operator':
      return t('nodeTypes.listOperator');
    case 'iteration':
    case 'loop':
      return t('nodeTypes.iteration');
    case 'end':
      return t('nodeTypes.end');
    default:
      return node.title || `${t('nodeTypes.node')} ${index + 1}`;
  }
}

export function getStatusText(node: ChatflowNode, t: (key: string) => string) {
  if (node.isIterationNode) {
    switch (node.status) {
      case 'running':
        return t('status.iterating');
      case 'completed':
        return t('status.iterationCompleted');
      case 'failed':
        return t('status.iterationFailed');
      default:
        return t('status.waitingIteration');
    }
  }

  if (node.isLoopNode) {
    switch (node.status) {
      case 'running':
        return t('status.looping');
      case 'completed':
        return t('status.loopCompleted');
      case 'failed':
        return t('status.loopFailed');
      default:
        return t('status.waitingLoop');
    }
  }

  switch (node.status) {
    case 'running':
      return t('status.executing');
    case 'completed':
      return t('status.completed');
    case 'failed':
      return t('status.failed');
    case 'pending':
      return t('status.waiting');
    default:
      return t('status.unknown');
  }
}

export function getCounterBadgeText(node: ChatflowNode) {
  if (node.isIterationNode && node.totalIterations) {
    return `${(node.currentIteration || 0) + 1}/${node.totalIterations}`;
  }

  if (node.isParallelNode && node.totalBranches) {
    return `${node.completedBranches || 0}/${node.totalBranches}`;
  }

  if (node.isLoopNode) {
    return node.maxLoops
      ? `${(node.currentLoop || 0) + 1}/${node.maxLoops}`
      : `${(node.currentLoop || 0) + 1}`;
  }

  return null;
}

export function isExpandableNode(node: ChatflowNode) {
  return Boolean(
    node.isIterationNode || node.isParallelNode || node.isLoopNode
  );
}

export function getBarStyles(node: ChatflowNode, isVisible: boolean) {
  const baseStyles = cn(
    'flex items-center gap-3 rounded-md border px-3 py-2 transition-all duration-300',
    'transform font-serif',
    isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
  );

  const nestedStyles =
    node.isInIteration || node.isInLoop
      ? cn(
          'relative ml-6 pl-4',
          node.isInIteration ? 'iteration-node' : 'loop-node',
          'bg-stone-50/40 dark:bg-stone-800/20'
        )
      : '';

  const combinedBaseStyles = cn(baseStyles, nestedStyles);

  switch (node.status) {
    case 'running':
      return cn(
        combinedBaseStyles,
        'border-stone-300 bg-stone-200/50 shadow-lg shadow-stone-200/50 dark:border-stone-600 dark:bg-stone-700/50 dark:shadow-lg dark:shadow-stone-900/30'
      );
    case 'completed':
      return cn(
        combinedBaseStyles,
        'border-stone-300 bg-stone-100 dark:border-stone-500 dark:bg-stone-600/30'
      );
    case 'failed':
      return cn(
        combinedBaseStyles,
        'border-red-200 bg-red-50 dark:border-red-700/50 dark:bg-red-900/20'
      );
    case 'pending':
    default:
      return cn(
        combinedBaseStyles,
        'border-stone-200 bg-stone-50 dark:border-stone-700/50 dark:bg-stone-800/50'
      );
  }
}

export function shouldShowExpandedParallelBranches(
  node: ChatflowNode,
  isExpanded: boolean
) {
  return Boolean(
    isExpanded &&
      node.isParallelNode &&
      node.parallelBranches &&
      node.parallelBranches.length > 0
  );
}

export function getParallelBranchLabel(index: number) {
  return String.fromCharCode(65 + index);
}
