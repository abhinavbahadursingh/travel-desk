// Playwright global setup. Shares the same provisioner as Vitest so the
// isolated `prisma/test.db` is built with the same schema + seed users.

import { setup } from "../setup/global-setup";

export default async function playwrightGlobalSetup(): Promise<void> {
  await setup();
}
