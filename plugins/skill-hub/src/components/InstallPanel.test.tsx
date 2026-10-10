import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { InstallUnavailable } from '@internal/plugin-skill-hub-common';
import { Asset } from '../model';
import { skillHubApiRef } from '../api';
import { InstallPanel } from './InstallPanel';

const api = { getAssetBody: jest.fn(), recordCopy: jest.fn() };

const render = async (installUnavailable?: InstallUnavailable) => {
  const asset = {
    entityRef: 'system:default/x',
    name: 'x',
    harnesses: [],
    install: {},
    blockedBy: [],
    installUnavailable,
    // Only an asset that passed its gate is told why it has no command; for
    // the rest the score is the reason.
    score: { verdict: 'PASS' },
  } as unknown as Asset;
  await renderInTestApp(<InstallPanel asset={asset} />, {
    apis: [[skillHubApiRef, api]],
  });
  return (await screen.findByText(/publishes no install command/)).textContent!;
};

describe('an asset with no install command says which cause applies', () => {
  it('blames the pack declaration only when APM would refuse it', async () => {
    const text = await render('refused');
    expect(text).toMatch(/pack declares something APM would refuse/);
    expect(text).not.toMatch(/hub's gap/);
  });

  it('blames the repository list when that is what left the targets out', async () => {
    const text = await render('narrowed');
    expect(text).toMatch(/harnesses list leaves out every target/);
    expect(text).not.toMatch(/pack declares something APM would refuse/);
  });

  it('blames the hub when the target is one it has not been taught', async () => {
    const text = await render('unknown-target');
    expect(text).toMatch(/does not accept/);
    expect(text).toMatch(/APM 0\.33\.0/);
    expect(text).not.toMatch(/pack declares something APM would refuse/);
  });

  it('blames the path when that is why', async () => {
    expect(await render('path')).toMatch(/would not survive being pasted/);
  });
});
