'use client';

import { difyProcessItem } from '@components/execution-process/adapters';
import { ExecutionProcessRow } from '@components/execution-process/row';
import type { ExecutionProcessItem } from '@components/execution-process/types';
import type { WorkflowNode } from '@lib/stores/workflow-execution-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';

import { useTranslations } from 'next-intl';

interface ExecutionBarProps {
  node: WorkflowNode;
  index: number;
  item: ExecutionProcessItem;
}

export function ExecutionBar({ node, index, item }: ExecutionBarProps) {
  const tTypes = useTranslations('pages.workflow.nodeTypes');
  const tDetails = useTranslations('pages.workflow.iterationDetails');
  const iterationExpanded = useWorkflowExecutionStore(
    state => state.iterationExpandedStates[node.id]
  );
  const loopExpanded = useWorkflowExecutionStore(
    state => state.loopExpandedStates[node.id]
  );
  const toggleIterationExpanded = useWorkflowExecutionStore(
    state => state.toggleIterationExpanded
  );
  const toggleLoopExpanded = useWorkflowExecutionStore(
    state => state.toggleLoopExpanded
  );
  const expandable = Boolean(
    node.isIterationNode || node.isLoopNode || node.isParallelNode
  );
  const expanded = Boolean(node.isLoopNode ? loopExpanded : iterationExpanded);
  const getNodeTitle = () => {
    // Return friendly Chinese name based on node type
    switch (node.type) {
      case 'start':
        return tTypes('start');
      case 'llm':
        return tTypes('llm');
      case 'knowledge-retrieval':
        return tTypes('knowledgeRetrieval');
      case 'question-classifier':
        return tTypes('questionClassifier');
      case 'if-else':
        return tTypes('ifElse');
      case 'code':
        return tTypes('code');
      case 'template-transform':
        return tTypes('templateTransform');
      case 'variable-assigner':
        return tTypes('variableAssigner');
      case 'variable-aggregator':
        return tTypes('variableAggregator');
      case 'document-extractor':
        return tTypes('documentExtractor');
      case 'parameter-extractor':
        return tTypes('parameterExtractor');
      case 'http-request':
        return tTypes('httpRequest');
      case 'list-operator':
        return tTypes('listOperator');
      case 'iteration':
      case 'loop':
        return tTypes('iteration');
      case 'parallel':
        return tTypes('parallel');
      case 'end':
        return tTypes('end');
      default:
        return node.title || tDetails('nodeNumber', { number: index + 1 });
    }
  };
  const children = node.isIterationNode
    ? node.iterations?.map(iteration =>
        difyProcessItem(
          {
            ...iteration,
            title: tDetails('roundIteration', { round: iteration.index + 1 }),
          },
          item.key
        )
      )
    : node.isLoopNode
      ? node.loops?.map(loop =>
          difyProcessItem(
            {
              ...loop,
              title: tDetails('roundLoop', { round: loop.index + 1 }),
            },
            item.key
          )
        )
      : node.isParallelNode
        ? node.parallelBranches?.map(branch =>
            difyProcessItem({ ...branch, title: branch.name }, item.key)
          )
        : undefined;
  const badge =
    node.isIterationNode && node.totalIterations
      ? `${(node.currentIteration || 0) + 1}/${node.totalIterations}`
      : node.isLoopNode && node.maxLoops
        ? `${(node.currentLoop || 0) + 1}/${node.maxLoops}`
        : node.isParallelNode && node.totalBranches
          ? `${node.completedBranches || 0}/${node.totalBranches}`
          : null;
  return (
    <ExecutionProcessRow
      item={{ ...item, title: getNodeTitle(), children }}
      className={
        node.isInIteration || node.isInLoop ? 'ml-4 w-auto' : undefined
      }
      badge={badge}
      expanded={expanded}
      onToggle={
        expandable
          ? () => {
              if (node.isLoopNode) toggleLoopExpanded(node.id);
              else toggleIterationExpanded(node.id);
            }
          : undefined
      }
    />
  );
}
