import { parseSseStream } from '@lib/utils/sse-parser';

import {
  DifyChatRequestPayload,
  DifySseEvent,
  DifySseIterationCompletedEvent,
  DifySseIterationNextEvent,
  DifySseIterationStartedEvent,
  DifySseLoopCompletedEvent,
  DifySseLoopNextEvent,
  DifySseLoopStartedEvent,
  DifySseNodeFinishedEvent,
  DifySseNodeStartedEvent,
  DifySseParallelBranchFinishedEvent,
  DifySseParallelBranchStartedEvent,
  DifyStreamResponse,
  DifyUsage,
} from '../types';
import { DifyRetrieverResource } from '../types';
import { DIFY_API_BASE_URL } from './constants';
import {
  extractRetrieverResources,
  extractUsage,
  throwAppRequestError,
} from './helpers';

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

interface ThinkStructureDebugBlock {
  type: 'text' | 'think';
  start: number;
  end: number;
  contentLength: number;
  status?: 'open' | 'closed';
  preview?: string;
}

interface ThinkStructureDebugSummary {
  openThinkTagCount: number;
  closeThinkTagCount: number;
  thinkBlockCount: number;
  blockSequence: string[];
  hasHeadTailThinkPattern: boolean;
  blocks: ThinkStructureDebugBlock[];
}

type NodeEvent =
  | DifySseNodeStartedEvent
  | DifySseNodeFinishedEvent
  | DifySseIterationStartedEvent
  | DifySseIterationNextEvent
  | DifySseIterationCompletedEvent
  | DifySseParallelBranchStartedEvent
  | DifySseParallelBranchFinishedEvent
  | DifySseLoopStartedEvent
  | DifySseLoopNextEvent
  | DifySseLoopCompletedEvent;

function emitNodeEvent(
  onNodeEvent: ((event: NodeEvent) => void) | undefined,
  event: NodeEvent,
  label: string
) {
  if (!onNodeEvent) {
    return;
  }

  try {
    onNodeEvent(event);
  } catch (callbackError) {
    console.error(
      `[Dify Service] Error in onNodeEvent callback (${label}):`,
      callbackError
    );
  }
}

function emitConversationId(
  onConversationIdReceived: ((id: string) => void) | undefined,
  conversationId: string,
  callbackCalledRef: { value: boolean },
  sourceLabel: string
) {
  if (!onConversationIdReceived || callbackCalledRef.value) {
    return;
  }

  try {
    onConversationIdReceived(conversationId);
    callbackCalledRef.value = true;
  } catch (callbackError) {
    console.error(
      `[Dify Service] Error in onConversationIdReceived callback (${sourceLabel}):`,
      callbackError
    );
  }
}

function buildThinkDebugPreview(content: string): string | undefined {
  const normalized = content.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
}

function unwrapExactThinkBlock(content: string): string | null {
  const match = content.match(/^<think(?:\s[^>]*)?>([\s\S]*)<\/think>$/i);

  if (!match) {
    return null;
  }

  return match[1].trim();
}

function summarizeThinkStructure(content: string): ThinkStructureDebugSummary {
  const blocks: ThinkStructureDebugBlock[] = [];
  const tagRegex = /<\/?think(?:\s[^>]*)?>/gi;
  let lastIndex = 0;
  let depth = 0;
  let thinkStartIndex = 0;
  let thinkContentStartIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[0];
    const matchIndex = match.index;
    const isCloseTag = tag.startsWith('</');

    if (depth === 0) {
      if (isCloseTag) {
        continue;
      }

      if (matchIndex > lastIndex) {
        const textContent = content.slice(lastIndex, matchIndex);
        if (textContent.length > 0) {
          blocks.push({
            type: 'text',
            start: lastIndex,
            end: matchIndex,
            contentLength: textContent.length,
            preview: buildThinkDebugPreview(textContent),
          });
        }
      }

      thinkStartIndex = matchIndex;
      thinkContentStartIndex = tagRegex.lastIndex;
      depth = 1;
      continue;
    }

    if (isCloseTag) {
      depth -= 1;

      if (depth === 0) {
        const thinkContent = content.slice(thinkContentStartIndex, matchIndex);
        blocks.push({
          type: 'think',
          start: thinkStartIndex,
          end: tagRegex.lastIndex,
          contentLength: thinkContent.length,
          status: 'closed',
          preview: buildThinkDebugPreview(thinkContent),
        });
        lastIndex = tagRegex.lastIndex;
      }
    } else {
      depth += 1;
    }
  }

  if (depth > 0) {
    const thinkContent = content.slice(thinkContentStartIndex);
    blocks.push({
      type: 'think',
      start: thinkStartIndex,
      end: content.length,
      contentLength: thinkContent.length,
      status: 'open',
      preview: buildThinkDebugPreview(thinkContent),
    });
  } else if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex);
    if (textContent.length > 0) {
      blocks.push({
        type: 'text',
        start: lastIndex,
        end: content.length,
        contentLength: textContent.length,
        preview: buildThinkDebugPreview(textContent),
      });
    }
  }

  const openThinkTagCount = (content.match(/<think(?:\s[^>]*)?>/gi) || [])
    .length;
  const closeThinkTagCount = (content.match(/<\/think>/gi) || []).length;
  const thinkBlockCount = blocks.filter(block => block.type === 'think').length;
  const hasHeadTailThinkPattern =
    blocks.length >= 3 &&
    blocks[0]?.type === 'think' &&
    blocks[blocks.length - 1]?.type === 'think' &&
    blocks
      .slice(1, -1)
      .some(block => block.type === 'text' && Boolean(block.preview));

  return {
    openThinkTagCount,
    closeThinkTagCount,
    thinkBlockCount,
    blockSequence: blocks.map(block => block.type),
    hasHeadTailThinkPattern,
    blocks,
  };
}

function logSuspiciousThinkStructure(params: {
  appId: string;
  conversationId: string | null;
  taskId: string | null;
  content: string;
}) {
  const summary = summarizeThinkStructure(params.content);
  const hasUnbalancedThinkTags =
    summary.openThinkTagCount !== summary.closeThinkTagCount;

  if (!summary.hasHeadTailThinkPattern && !hasUnbalancedThinkTags) {
    return;
  }

  console.warn('[Dify Service] Suspicious think structure detected', {
    appId: params.appId,
    conversationId: params.conversationId,
    taskId: params.taskId,
    contentLength: params.content.length,
    openThinkTagCount: summary.openThinkTagCount,
    closeThinkTagCount: summary.closeThinkTagCount,
    thinkBlockCount: summary.thinkBlockCount,
    hasHeadTailThinkPattern: summary.hasHeadTailThinkPattern,
    blockSequence: summary.blockSequence,
    blocks: summary.blocks,
  });
}

interface NormalizedStreamSegment {
  type: 'reasoning' | 'answer';
  content: string;
}

interface ThinkMarkupState {
  thinkDepth: number;
  pendingThinkTagFragment: string;
}

function isPotentialThinkTagFragment(fragment: string): boolean {
  if (!fragment.startsWith('<')) {
    return false;
  }

  const lower = fragment.toLowerCase();

  return (
    THINK_OPEN_TAG.startsWith(lower) ||
    THINK_CLOSE_TAG.startsWith(lower) ||
    lower.startsWith('<think') ||
    lower.startsWith('</think')
  );
}

function splitTrailingThinkTagFragment(input: string): {
  processable: string;
  trailingFragment: string;
} {
  const lastOpenBracketIndex = input.lastIndexOf('<');

  if (lastOpenBracketIndex < 0) {
    return { processable: input, trailingFragment: '' };
  }

  const trailingFragment = input.slice(lastOpenBracketIndex);
  if (
    trailingFragment.includes('>') ||
    !isPotentialThinkTagFragment(trailingFragment)
  ) {
    return { processable: input, trailingFragment: '' };
  }

  return {
    processable: input.slice(0, lastOpenBracketIndex),
    trailingFragment,
  };
}

function splitThinkAwareSegments(
  rawContent: string,
  state: ThinkMarkupState,
  flushTrailingFragmentAsText = false
): {
  segments: NormalizedStreamSegment[];
  hasMalformedThink: boolean;
} {
  const combinedContent = `${state.pendingThinkTagFragment}${rawContent}`;
  const { processable, trailingFragment } =
    splitTrailingThinkTagFragment(combinedContent);
  state.pendingThinkTagFragment = flushTrailingFragmentAsText
    ? ''
    : trailingFragment;

  const segments: NormalizedStreamSegment[] = [];
  let hasMalformedThink = false;
  const thinkTagPattern = /<\/?think(?:\s[^>]*)?>/gi;
  let cursor = 0;

  for (const match of processable.matchAll(thinkTagPattern)) {
    const tag = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > cursor) {
      segments.push({
        type: state.thinkDepth > 0 ? 'reasoning' : 'answer',
        content: processable.slice(cursor, matchIndex),
      });
    }

    if (/^<think(?:\s[^>]*)?>$/i.test(tag)) {
      state.thinkDepth += 1;
    } else if (/^<\/think>$/i.test(tag)) {
      if (state.thinkDepth > 0) {
        state.thinkDepth -= 1;
      } else {
        hasMalformedThink = true;
      }
    }

    cursor = matchIndex + tag.length;
  }

  if (cursor < processable.length) {
    segments.push({
      type: state.thinkDepth > 0 ? 'reasoning' : 'answer',
      content: processable.slice(cursor),
    });
  }

  if (flushTrailingFragmentAsText && trailingFragment) {
    segments.push({
      type: state.thinkDepth > 0 ? 'reasoning' : 'answer',
      content: trailingFragment,
    });
    hasMalformedThink = true;
  }

  return {
    segments: segments.filter(segment => segment.content.length > 0),
    hasMalformedThink,
  };
}

function splitStaticThinkAwarePayload(rawContent: string): {
  reasoningText: string;
  answerText: string;
  hasMalformedThink: boolean;
  hasThinkMarkup: boolean;
} {
  const trimmedContent = rawContent.trim();
  if (!trimmedContent) {
    return {
      reasoningText: '',
      answerText: '',
      hasMalformedThink: false,
      hasThinkMarkup: false,
    };
  }

  const exactThinkBlock = unwrapExactThinkBlock(trimmedContent);
  if (exactThinkBlock !== null) {
    return {
      reasoningText: exactThinkBlock,
      answerText: '',
      hasMalformedThink: false,
      hasThinkMarkup: true,
    };
  }

  const hasThinkMarkup =
    trimmedContent.includes(THINK_OPEN_TAG) ||
    trimmedContent.includes(THINK_CLOSE_TAG);

  if (!hasThinkMarkup) {
    return {
      reasoningText: trimmedContent,
      answerText: '',
      hasMalformedThink: false,
      hasThinkMarkup: false,
    };
  }

  const state: ThinkMarkupState = {
    thinkDepth: 0,
    pendingThinkTagFragment: '',
  };
  const { segments, hasMalformedThink } = splitThinkAwareSegments(
    trimmedContent,
    state,
    true
  );

  return {
    reasoningText: segments
      .filter(segment => segment.type === 'reasoning')
      .map(segment => segment.content)
      .join('')
      .trim(),
    answerText: segments
      .filter(segment => segment.type === 'answer')
      .map(segment => segment.content)
      .join('')
      .trim(),
    hasMalformedThink: hasMalformedThink || state.thinkDepth > 0,
    hasThinkMarkup,
  };
}

function buildNovelTail(existingContent: string, nextContent: string): string {
  if (!nextContent) {
    return '';
  }

  if (!existingContent) {
    return nextContent;
  }

  if (
    nextContent === existingContent ||
    existingContent.includes(nextContent)
  ) {
    return '';
  }

  const containedIndex = nextContent.indexOf(existingContent);
  if (containedIndex >= 0) {
    return nextContent.slice(containedIndex + existingContent.length);
  }

  if (nextContent.startsWith(existingContent)) {
    return nextContent.slice(existingContent.length);
  }

  const maxOverlap = Math.min(existingContent.length, nextContent.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existingContent.endsWith(nextContent.slice(0, overlap))) {
      return nextContent.slice(overlap);
    }
  }

  return '';
}

export async function streamDifyChat(
  payload: DifyChatRequestPayload,
  appId: string,
  onConversationIdReceived?: (id: string) => void,
  onNodeEvent?: (event: NodeEvent) => void
): Promise<DifyStreamResponse> {
  console.log('[Dify Service] Sending request to proxy:', payload);

  const apiUrl = `${DIFY_API_BASE_URL}/${appId}/chat-messages`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log('[Dify Service] Received response status:', response.status);

    if (!response.ok) {
      await throwAppRequestError(
        response,
        rawBody => `Dify API request failed (${response.status}): ${rawBody}`,
        () =>
          `Dify API request failed (${response.status}): ${response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error('Dify API response body is null.');
    }

    const stream = response.body;
    let conversationId: string | null = null;
    let taskId: string | null = null;
    const callbackCalledRef = { value: false };

    let completionResolve: (value: {
      messageId?: string;
      userMessageFileIds?: string[];
      usage?: DifyUsage;
      metadata?: Record<string, unknown>;
      retrieverResources?: DifyRetrieverResource[];
    }) => void;
    let completionReject: (reason?: unknown) => void;
    let completionResolved = false;

    const completionPromise = new Promise<{
      messageId?: string;
      userMessageFileIds?: string[];
      usage?: DifyUsage;
      metadata?: Record<string, unknown>;
      retrieverResources?: DifyRetrieverResource[];
    }>((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });

    async function* processStream(): AsyncGenerator<string, void, undefined> {
      let syntheticThinkBlockOpen = false;
      let normalizedContent = '';
      let answerContent = '';
      const previousAgentThoughtByPosition = new Map<string, string>();
      const userMessageFileIds: string[] = [];
      const answerStreamThinkState: ThinkMarkupState = {
        thinkDepth: 0,
        pendingThinkTagFragment: '',
      };
      const outputThinkState = {
        currentOpenThinkContent: '',
      };
      const rawEventSummary = {
        answerPayloadThinkMarkupCount: 0,
        mixedThoughtPayloadCount: 0,
        malformedPayloadCount: 0,
      };

      const yieldChunk = async function* (chunk: string) {
        if (!chunk) {
          return;
        }

        normalizedContent += chunk;
        yield chunk;
      };

      const emitReasoningChunk = async function* (chunk: string) {
        if (!chunk) {
          return;
        }

        if (!syntheticThinkBlockOpen) {
          syntheticThinkBlockOpen = true;
          outputThinkState.currentOpenThinkContent = '';
          yield* yieldChunk(THINK_OPEN_TAG);
        }

        outputThinkState.currentOpenThinkContent += chunk;
        yield* yieldChunk(chunk);
      };

      const closeSyntheticThinkBlock = async function* () {
        if (!syntheticThinkBlockOpen) {
          return;
        }

        syntheticThinkBlockOpen = false;
        outputThinkState.currentOpenThinkContent = '';
        yield* yieldChunk(THINK_CLOSE_TAG);
      };

      const emitAnswerChunk = async function* (chunk: string) {
        if (!chunk) {
          return;
        }

        yield* closeSyntheticThinkBlock();
        answerContent += chunk;
        yield* yieldChunk(chunk);
      };

      const emitSegments = async function* (
        segments: NormalizedStreamSegment[]
      ) {
        for (const segment of segments) {
          if (segment.type === 'reasoning') {
            yield* emitReasoningChunk(segment.content);
          } else {
            yield* emitAnswerChunk(segment.content);
          }
        }
      };

      try {
        for await (const result of parseSseStream(stream)) {
          if (result.type === 'error') {
            console.error('[Dify Service] SSE Parser Error:', result.error);
            completionReject(new Error('Error parsing SSE stream.'));
            throw new Error('Error parsing SSE stream.');
          }

          const event = result.event as DifySseEvent;

          if (event.event !== 'message') {
            console.log(
              `[Dify Service] 🎯 Received key SSE event: ${event.event}${event.event === 'message_end' ? ' (key event!)' : ''}`
            );
          }

          if (event.conversation_id) {
            if (!conversationId) {
              conversationId = event.conversation_id;
              emitConversationId(
                onConversationIdReceived,
                conversationId,
                callbackCalledRef,
                'stream'
              );
            } else if (conversationId !== event.conversation_id) {
              console.warn(
                '[Dify Service] Warning: conversationId in event differs from saved one!',
                {
                  saved: conversationId,
                  fromEvent: event.conversation_id,
                }
              );
            }
          }
          if ('task_id' in event && event.task_id && !taskId) {
            taskId = event.task_id;
            console.log('[Dify Service] Extracted taskId:', taskId);
          }

          switch (event.event) {
            case 'agent_thought': {
              const {
                reasoningText,
                answerText,
                hasMalformedThink,
                hasThinkMarkup,
              } = splitStaticThinkAwarePayload(event.thought || '');
              const thoughtKey = `${event.message_id}:${event.position}`;
              const previousThought =
                previousAgentThoughtByPosition.get(thoughtKey);
              const reasoningBaseline =
                previousThought || outputThinkState.currentOpenThinkContent;
              const reasoningDelta = buildNovelTail(
                reasoningBaseline,
                reasoningText
              );
              const answerDelta = buildNovelTail(answerContent, answerText);
              const shouldSuppressMixedThoughtReplay =
                hasThinkMarkup &&
                Boolean(answerText) &&
                Boolean(answerContent) &&
                !answerDelta;

              if (hasThinkMarkup && answerText) {
                rawEventSummary.mixedThoughtPayloadCount += 1;
              }

              if (hasMalformedThink) {
                rawEventSummary.malformedPayloadCount += 1;
              }

              console.log('[Dify Service] Agent thought event received', {
                messageId: event.message_id,
                position: event.position,
                reasoningLength: reasoningText.length,
                reasoningDeltaLength: reasoningDelta.length,
                answerLength: answerText.length,
                answerDeltaLength: answerDelta.length,
                hasThinkMarkup,
                hasMalformedThink,
              });

              if (reasoningText) {
                previousAgentThoughtByPosition.set(thoughtKey, reasoningText);
              }

              if (shouldSuppressMixedThoughtReplay) {
                console.warn(
                  '[Dify Service] Suppressed mixed agent_thought payload after answer already emitted',
                  {
                    messageId: event.message_id,
                    position: event.position,
                    answerLength: answerText.length,
                    existingAnswerLength: answerContent.length,
                  }
                );
                break;
              }

              if (reasoningDelta) {
                yield* emitReasoningChunk(reasoningDelta);
              }

              if (answerDelta) {
                if (hasThinkMarkup) {
                  answerStreamThinkState.thinkDepth = 0;
                  answerStreamThinkState.pendingThinkTagFragment = '';
                }
                yield* emitAnswerChunk(answerDelta);
              }
              break;
            }
            case 'agent_message':
            case 'message':
              if (event.answer) {
                const hasThinkMarkup =
                  event.answer.includes(THINK_OPEN_TAG) ||
                  event.answer.includes(THINK_CLOSE_TAG);
                if (hasThinkMarkup) {
                  rawEventSummary.answerPayloadThinkMarkupCount += 1;
                }

                const { segments, hasMalformedThink } = splitThinkAwareSegments(
                  event.answer,
                  answerStreamThinkState
                );

                if (hasMalformedThink) {
                  rawEventSummary.malformedPayloadCount += 1;
                }

                yield* emitSegments(segments);
              }
              break;
            case 'node_started':
              console.log('[Dify Service] Node started:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseNodeStartedEvent,
                'node_started'
              );
              break;
            case 'node_finished':
              console.log('[Dify Service] Node finished:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseNodeFinishedEvent,
                'node_finished'
              );
              break;
            case 'iteration_started':
              console.log('[Dify Service] Iteration started:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseIterationStartedEvent,
                'iteration_started'
              );
              break;
            case 'iteration_next':
              console.log('[Dify Service] Iteration next:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseIterationNextEvent,
                'iteration_next'
              );
              break;
            case 'iteration_completed':
              console.log('[Dify Service] Iteration completed:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseIterationCompletedEvent,
                'iteration_completed'
              );
              break;
            case 'parallel_branch_started':
              console.log(
                '[Dify Service] Parallel branch started:',
                event.data
              );
              emitNodeEvent(
                onNodeEvent,
                event as DifySseParallelBranchStartedEvent,
                'parallel_branch_started'
              );
              break;
            case 'parallel_branch_finished':
              console.log(
                '[Dify Service] Parallel branch finished:',
                event.data
              );
              emitNodeEvent(
                onNodeEvent,
                event as DifySseParallelBranchFinishedEvent,
                'parallel_branch_finished'
              );
              break;
            case 'loop_started':
              console.log('[Dify Service] Loop started:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseLoopStartedEvent,
                'loop_started'
              );
              break;
            case 'loop_next':
              console.log('[Dify Service] Loop next:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseLoopNextEvent,
                'loop_next'
              );
              break;
            case 'loop_completed':
              console.log('[Dify Service] Loop completed:', event.data);
              emitNodeEvent(
                onNodeEvent,
                event as DifySseLoopCompletedEvent,
                'loop_completed'
              );
              break;
            case 'message_file':
              if (
                event.belongs_to === 'user' &&
                event.id &&
                !userMessageFileIds.includes(event.id)
              ) {
                userMessageFileIds.push(event.id);
              }
              break;
            case 'message_end':
              if (answerStreamThinkState.pendingThinkTagFragment) {
                rawEventSummary.malformedPayloadCount += 1;
                answerStreamThinkState.pendingThinkTagFragment = '';
              }
              answerStreamThinkState.thinkDepth = 0;
              yield* closeSyntheticThinkBlock();
              console.log(
                '[Dify Service] Received message_end event with metadata:',
                {
                  metadata: event.metadata,
                  usage: event.metadata?.usage || event.usage,
                  retrieverResources: event.metadata?.retriever_resources,
                }
              );

              if (event.conversation_id && !conversationId) {
                conversationId = event.conversation_id;
                console.log(
                  '[Dify Service] Extracted conversationId from message_end:',
                  conversationId
                );
                emitConversationId(
                  onConversationIdReceived,
                  conversationId,
                  callbackCalledRef,
                  'message_end'
                );
              }
              if (event.task_id && !taskId) {
                taskId = event.task_id;
                console.log(
                  '[Dify Service] Extracted taskId from message_end:',
                  taskId
                );
              }

              const completionData = {
                messageId: event.id,
                userMessageFileIds: [...userMessageFileIds],
                usage: extractUsage(event.metadata?.usage || event.usage),
                metadata: event.metadata || {},
                retrieverResources: extractRetrieverResources(
                  event.metadata?.retriever_resources,
                  event.retriever_resources
                ),
              };

              console.log(
                '[Dify Service] Resolving completionPromise with data:',
                completionData
              );
              if (!completionResolved) {
                completionResolve(completionData);
                completionResolved = true;
              }

              console.log('[Dify Service] Message stream ended.');
              break;
            case 'error':
              console.error('[Dify Service] Dify API Error Event:', event);
              const errorInfo = new Error(
                `Dify API error: ${event.code} - ${event.message}`
              );
              completionReject(errorInfo);
              throw errorInfo;
            default:
              break;
          }
        }
        console.log('[Dify Service] Finished processing stream.');

        if (answerStreamThinkState.pendingThinkTagFragment) {
          rawEventSummary.malformedPayloadCount += 1;
        }

        answerStreamThinkState.pendingThinkTagFragment = '';
        answerStreamThinkState.thinkDepth = 0;
        yield* closeSyntheticThinkBlock();
        logSuspiciousThinkStructure({
          appId,
          conversationId,
          taskId,
          content: normalizedContent,
        });

        if (
          rawEventSummary.answerPayloadThinkMarkupCount > 0 ||
          rawEventSummary.mixedThoughtPayloadCount > 0 ||
          rawEventSummary.malformedPayloadCount > 0
        ) {
          console.warn('[Dify Service] Normalized mixed think/answer stream', {
            appId,
            conversationId,
            taskId,
            answerPayloadThinkMarkupCount:
              rawEventSummary.answerPayloadThinkMarkupCount,
            mixedThoughtPayloadCount: rawEventSummary.mixedThoughtPayloadCount,
            malformedPayloadCount: rawEventSummary.malformedPayloadCount,
            normalizedContentLength: normalizedContent.length,
            answerContentLength: answerContent.length,
          });
        }

        if (completionResolve && !completionResolved) {
          console.log(
            '[Dify Service] Stream ended without message_end, resolving with empty data'
          );
          completionResolve({
            usage: undefined,
            metadata: {},
            retrieverResources: [],
          });
          completionResolved = true;
        }
      } catch (error) {
        console.error('[Dify Service] Error in processStream:', error);
        if (completionReject) {
          completionReject(
            error instanceof Error ? error : new Error(String(error))
          );
        }
        throw error;
      }
    }

    return {
      answerStream: processStream(),
      getConversationId: () => conversationId,
      getTaskId: () => taskId,
      completionPromise,
    };
  } catch (error) {
    console.error('[Dify Service] Error in streamDifyChat:', error);
    throw error;
  }
}
