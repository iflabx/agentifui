import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { UserAvatar } from './user-avatar';

describe('UserAvatar storage reads', () => {
  const avatarUrl =
    'https://objects.example.com/bucket/avatars/user-owner/avatar.png';
  const downloadUrl =
    'https://objects.example.com/bucket/avatars/user-owner/avatar.png?signed=test';

  beforeEach(() => {
    jest.mocked(fetch).mockReset();
  });

  it('keeps non-storage provider images unchanged', () => {
    render(
      <UserAvatar
        avatarUrl="https://provider.example.com/profile.png"
        userName="Test User"
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://provider.example.com/profile.png'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the authenticated signing endpoint before displaying a storage avatar', async () => {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, downloadUrl }),
    } as Response);
    render(<UserAvatar avatarUrl={avatarUrl} userName="Test User" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(await screen.findByRole('img')).toHaveAttribute('src', downloadUrl);
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/storage/avatar/presign?path=user-owner%2Favatar.png',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('does not bypass a denied private-avatar read with the unsigned URL', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValue({ ok: false, status: 403 } as Response);
    render(<UserAvatar avatarUrl={avatarUrl} userName="Test User" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('TU')).toBeInTheDocument();
  });

  it('ignores a pending signing response after the avatar changes', async () => {
    let resolveResponse!: (response: Response) => void;
    jest.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveResponse = resolve;
        })
    );
    const { rerender } = render(
      <UserAvatar avatarUrl={avatarUrl} userName="Test User" />
    );
    const signal = jest.mocked(fetch).mock.calls[0][1]?.signal;
    rerender(
      <UserAvatar
        avatarUrl="https://provider.example.com/new.png"
        userName="Test User"
      />
    );
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      resolveResponse({
        ok: true,
        json: async () => ({ success: true, downloadUrl }),
      } as Response)
    );
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://provider.example.com/new.png'
    );
  });

  it('keeps initials when signing fails', async () => {
    jest.mocked(fetch).mockRejectedValue(new Error('Network unavailable'));
    render(<UserAvatar avatarUrl={avatarUrl} userName="Test User" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to initials when the signed image cannot load', async () => {
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, downloadUrl }),
    } as Response);
    render(<UserAvatar avatarUrl={avatarUrl} userName="Test User" />);
    fireEvent.error(await screen.findByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
