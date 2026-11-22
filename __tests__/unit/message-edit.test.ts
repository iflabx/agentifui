import {
  buildMessageEditPrompt,
  replaceMessagePath,
} from '../../packages/shared/src/message-edit';

describe('implicit message correction', () => {
  it('bounds the original excerpt but retains the complete replacement', () => {
    const original = '😀'.repeat(121);
    const replacement = 'A complete new request\nwith another line';
    const prompt = buildMessageEditPrompt(original, replacement);
    expect(prompt).toContain(JSON.stringify('😀'.repeat(120)));
    expect(prompt).not.toContain(original);
    expect(prompt.endsWith(replacement)).toBe(true);
    expect(prompt).toContain('does not authorize replaying past tools');
  });

  it('returns a prefix without mutating stored history and supports another edit', () => {
    const history = ['q1', 'a1', 'q2', 'a2', 'q3', 'a3'].map(id => ({ id }));
    const first = [
      ...replaceMessagePath(history, 'q2'),
      { id: 'q2-new' },
      { id: 'a-new' },
    ];
    expect(first.map(item => item.id)).toEqual(['q1', 'a1', 'q2-new', 'a-new']);
    expect(history).toHaveLength(6);
    expect(replaceMessagePath(first, 'q2-new').map(item => item.id)).toEqual([
      'q1',
      'a1',
    ]);
    expect(replaceMessagePath(history)).toBe(history);
    expect(replaceMessagePath(history, 'missing')).toBe(history);
  });

  it('distinguishes identical earlier questions by their original turn position', () => {
    const first = buildMessageEditPrompt('Continue', 'Explain further', 1);
    const later = buildMessageEditPrompt('Continue', 'Explain further', 4);
    expect(first).toContain('user request number 1');
    expect(later).toContain('user request number 4');
    expect(first).not.toEqual(later);
  });
});
