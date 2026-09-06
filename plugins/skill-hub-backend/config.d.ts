import { HumanDuration } from '@backstage/types';

export interface Config {
  /**
   * Configuration for the skill-hub agent asset catalogue.
   */
  skillHub?: {
    /**
     * GitHub organisations or user accounts scanned for the
     * `.agent-assets.yaml` manifest. A repository joins the catalogue by
     * adding that file and leaves by removing it; nothing else opts a
     * repository in.
     */
    owners: string[];

    /**
     * How often the estate is rescanned. Defaults to every 10 minutes.
     */
    schedule?: {
      frequency?: HumanDuration | { cron: string };
      timeout?: HumanDuration;
      initialDelay?: HumanDuration;
    };

    /**
     * Where install receipts are posted. Receipts are fire and forget: an
     * unreachable Mission Control queues the receipt and never blocks or
     * fails a copy. Omit the whole block to disable receipts.
     */
    missionControl?: {
      /** Base URL of the Mission Control API. */
      baseUrl: string;
      /**
       * Agent token with only the receipts scope.
       * @visibility secret
       */
      token: string;
    };
  };
}
