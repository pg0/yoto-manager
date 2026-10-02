import { beforeEach, describe, expect, it, vi } from 'vitest';

// Green Button wire format, per yoto.dev: shortcuts live at device.shortcuts on
// GET /device-v2/{id}/config and are written back whole via PUT .../shortcuts.

const yotoFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('../src/lib/auth', () => ({ yotoFetch: (p: string, i?: RequestInit) => yotoFetch(p, i) }));

const { fetchDeviceStatus, saveShortcuts } = await import('../src/lib/devices');

const item = (card: string) => ({ cmd: 'track-play', params: { card, chapter: '01', track: '01' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => yotoFetch.mockReset());

describe('Green Button', () => {
  it('reads day and night playlists from the device config', async () => {
    yotoFetch.mockResolvedValue(
      json({
        device: {
          deviceId: 'd1',
          shortcuts: { modes: { day: { content: [item('a'), item('b')] }, night: { content: [] } }, versionId: 'v' },
        },
      }),
    );
    const s = await fetchDeviceStatus('d1');
    expect(s?.shortcuts).toEqual({ day: [item('a'), item('b')], night: [] });
  });

  it('reports no Green Button on boxes without shortcuts', async () => {
    yotoFetch.mockResolvedValue(json({ device: { deviceId: 'd1' } }));
    expect((await fetchDeviceStatus('d1'))?.shortcuts).toBeNull();
  });

  it('writes both modes back in the shape Yoto expects', async () => {
    yotoFetch.mockResolvedValue(json({}));
    await saveShortcuts('d1', { day: [item('a')], night: [item('b')] });
    const [path, init] = yotoFetch.mock.calls[0];
    expect(path).toBe('device-v2/d1/shortcuts');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({
      shortcuts: { modes: { day: { content: [item('a')] }, night: { content: [item('b')] } } },
    });
  });

  it('explains a 403 as the missing sign-in permission', async () => {
    yotoFetch.mockResolvedValue(json({}, 403));
    await expect(saveShortcuts('d1', { day: [], night: [] })).rejects.toThrow(/sign in again/);
  });
});
