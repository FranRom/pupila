import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  DiscoverResult,
  SourceHealthResponse,
  SourcesResponse,
  VerifyResponse,
} from '../lib/api/index.ts';
import { SourcesPanel } from './SourcesPanel.tsx';

afterEach(() => vi.restoreAllMocks());

const sources: SourcesResponse = {
  ats: [
    {
      key: 'ashby',
      label: 'Ashby',
      note: 'Public Ashby boards.',
      verifySupported: true,
      shipped: ['linear', 'ramp'],
      add: ['stripe'],
      remove: [],
      effective: ['linear', 'ramp', 'stripe'],
    },
  ],
};

const noopVerify = async (): Promise<VerifyResponse | null> => ({
  supported: true,
  state: 'ok',
  found: 3,
});
const noopHealth = async (): Promise<SourceHealthResponse | null> => ({ results: [] });
const noopDiscover = async (): Promise<DiscoverResult> => ({
  suggestions: [],
  proposed: 0,
  verified: 0,
  errors: [],
});

function renderPanel(overrides: Partial<Parameters<typeof SourcesPanel>[0]> = {}) {
  return render(
    <SourcesPanel
      sources={sources}
      onSave={vi.fn()}
      onVerify={noopVerify}
      onCheckHealth={noopHealth}
      onDiscover={noopDiscover}
      {...overrides}
    />,
  );
}

it('renders the effective company list', () => {
  renderPanel();
  expect(screen.getByText('linear')).toBeInTheDocument();
  expect(screen.getByText('stripe')).toBeInTheDocument();
});

it('shows an explanatory tooltip on the group', () => {
  renderPanel();
  expect(screen.getByText('Public Ashby boards.')).toBeInTheDocument();
});

it('removing a shipped slug saves it into the remove list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderPanel({ onSave });
  fireEvent.click(screen.getByTitle('Remove linear'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', ['stripe'], ['linear']));
});

it('removing an added slug drops it from the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderPanel({ onSave });
  fireEvent.click(screen.getByTitle('Remove stripe'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', [], []));
});

it('adding a new slug appends it to the add list', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderPanel({ onSave });
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'Mercury' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', ['stripe', 'mercury'], []));
});

it('re-adding a removed shipped slug clears the removal instead of marking it added', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  // A view where the shipped slug "linear" has been removed (sits in `remove`).
  const removed: SourcesResponse = {
    ats: [
      {
        key: 'ashby',
        label: 'Ashby',
        note: 'Public Ashby boards.',
        verifySupported: true,
        shipped: ['linear', 'ramp'],
        add: [],
        remove: ['linear'],
        effective: ['ramp'],
      },
    ],
  };
  render(
    <SourcesPanel
      sources={removed}
      onSave={onSave}
      onVerify={noopVerify}
      onCheckHealth={noopHealth}
      onDiscover={noopDiscover}
    />,
  );
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'linear' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  // add stays empty (not a personal addition); remove is cleared.
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', [], []));
});

it('shows disabled shipped companies and re-enables them with one click', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const removed: SourcesResponse = {
    ats: [
      {
        key: 'ashby',
        label: 'Ashby',
        note: 'Public Ashby boards.',
        verifySupported: true,
        shipped: ['linear', 'ramp'],
        add: [],
        remove: ['linear'],
        effective: ['ramp'],
      },
    ],
  };
  render(
    <SourcesPanel
      sources={removed}
      onSave={onSave}
      onVerify={noopVerify}
      onCheckHealth={noopHealth}
      onDiscover={noopDiscover}
    />,
  );
  // The disabled company stays visible under a "Disabled" row.
  expect(screen.getByText('Disabled')).toBeInTheDocument();
  expect(screen.getByText('linear')).toBeInTheDocument();
  // One click re-enables it (clears the removal).
  fireEvent.click(screen.getByTitle('Re-enable linear'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith('ashby', [], []));
});

it('rejects an invalid slug without saving', async () => {
  const onSave = vi.fn();
  renderPanel({ onSave });
  const input = screen.getByPlaceholderText('Add Ashby company slug…');
  fireEvent.change(input, { target: { value: 'bad/slug' } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
  expect(await screen.findByText(/invalid slug/i)).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

it('flags only broken boards and summarizes health per group after a check', async () => {
  const onCheckHealth = vi.fn().mockResolvedValue({
    results: [
      { key: 'ashby', slug: 'linear', state: 'not_found', found: 0 },
      { key: 'ashby', slug: 'ramp', state: 'ok', found: 8 },
      { key: 'ashby', slug: 'stripe', state: 'ok', found: 2 },
    ],
  } satisfies SourceHealthResponse);
  renderPanel({ onCheckHealth });

  fireEvent.click(screen.getByRole('button', { name: /check board health/i }));

  // The one broken board gets a marker; the healthy ones do not.
  await waitFor(() => expect(screen.getByTitle(/linear: board not found/i)).toBeInTheDocument());
  expect(screen.queryByTitle(/ramp: /i)).not.toBeInTheDocument();
  // Group header summarizes: 2 healthy, 1 broken, with an explanatory tooltip.
  expect(screen.getByText('2 OK')).toBeInTheDocument();
  // The full phrase is unique to the InfoTooltip bubble.
  expect(screen.getByText(/2 reachable, 1 unreachable/i)).toBeInTheDocument();
});

it('shows an all-clear summary when every board is reachable', async () => {
  const onCheckHealth = vi.fn().mockResolvedValue({
    results: [
      { key: 'ashby', slug: 'linear', state: 'ok', found: 5 },
      { key: 'ashby', slug: 'ramp', state: 'ok', found: 8 },
      { key: 'ashby', slug: 'stripe', state: 'ok', found: 2 },
    ],
  } satisfies SourceHealthResponse);
  renderPanel({ onCheckHealth });

  fireEvent.click(screen.getByRole('button', { name: /check board health/i }));

  await waitFor(() => expect(screen.getByText('✓ 3 reachable')).toBeInTheDocument());
  // No ⚠ marker anywhere (visible summary or chips) when all boards are reachable.
  expect(screen.queryByText('⚠')).not.toBeInTheDocument();
});
