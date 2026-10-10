import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { Asset } from '../model';
import { skillHubApiRef } from '../api';
import { InstallPanel } from './InstallPanel';

const api = { getAssetBody: jest.fn(), recordCopy: jest.fn() };

describe('an asset with no install command', () => {
  it('does not blame the pack, because the hub may be the one behind', async () => {
    const asset = {
      entityRef: 'system:default/x',
      name: 'x',
      harnesses: [],
      install: {},
      blockedBy: [],
    } as unknown as Asset;
    await renderInTestApp(<InstallPanel asset={asset} />, {
      apis: [[skillHubApiRef, api]],
    });

    const text = (await screen.findByText(/publishes no install command/))
      .textContent;
    expect(text).not.toMatch(/pack declares no target that APM recognises/);
    expect(text).toMatch(/not a mistake in the pack/);
    expect(text).toMatch(/APM 0\.33\.0/);
  });
});
