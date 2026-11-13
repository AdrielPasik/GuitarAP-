import { expect, test } from '@playwright/test';

test('declares PWA metadata and registers a service worker', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest/);
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.getRegistrations().then((items) => items.length)),
    )
    .toBeGreaterThan(0);
});

test('loads the cached shell while offline after a valid visit', async ({ context, page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('banner')).toContainText('GuitarAP');
  await context.setOffline(false);
});
