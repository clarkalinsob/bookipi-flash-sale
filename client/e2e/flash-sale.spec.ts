import { test, expect } from '@playwright/test';
import { seedSale } from './helpers/seed';

const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3000/api';

test.describe('flash sale purchase flow', () => {
  test('shows the upcoming state and rejects a purchase attempt', async ({
    page,
  }) => {
    seedSale('upcoming', 5);
    await page.goto('/');

    await expect(page.getByText('Upcoming')).toBeVisible();

    await page.getByLabel('User ID').fill('playwright-upcoming');
    await page.getByRole('button', { name: 'Buy Now' }).click();

    await expect(page.getByRole('status')).toHaveText(
      'The sale is not active right now.',
    );
    await page.screenshot({ path: 'e2e/screenshots/upcoming.png' });
  });

  test('completes a successful purchase while the sale is active', async ({
    page,
  }) => {
    seedSale('active', 5);
    await page.goto('/');

    await expect(page.getByText('Active')).toBeVisible();

    await page.getByLabel('User ID').fill('playwright-success');
    await page.getByRole('button', { name: 'Buy Now' }).click();

    await expect(page.getByRole('status')).toHaveText(
      'Purchase successful — you got one!',
    );
    await expect(page.getByText('4 in stock')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/success.png' });
  });

  test('rejects a second purchase by the same user', async ({
    page,
    request,
  }) => {
    seedSale('active', 5);
    await request.post(`${API_BASE_URL}/purchase`, {
      data: { userId: 'playwright-repeat' },
    });

    await page.goto('/');
    await page.getByLabel('User ID').fill('playwright-repeat');
    await page.getByRole('button', { name: 'Buy Now' }).click();

    await expect(page.getByRole('status')).toHaveText(
      'You have already purchased this item.',
    );
    await page.screenshot({ path: 'e2e/screenshots/already-purchased.png' });
  });

  test('shows sold out once stock is exhausted', async ({ page }) => {
    seedSale('active', 0);
    await page.goto('/');

    await expect(page.getByText('0 in stock')).toBeVisible();

    await page.getByLabel('User ID').fill('playwright-sold-out');
    await page.getByRole('button', { name: 'Buy Now' }).click();

    await expect(page.getByRole('status')).toHaveText(
      'Sold out. Better luck next time.',
    );
    await page.screenshot({ path: 'e2e/screenshots/sold-out.png' });
  });
});
