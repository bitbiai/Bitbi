// Independent public-offer assertions, shared separately from auth/checkout
// setup so the large auth suite need not own the pricing presentation contract.
exports.assertEnglishPricingCards = async (page, expect) => {
  await expect(page.locator('.pricing-card')).toHaveCount(4);
  await expect(page.locator('.pricing-card__title')).toHaveText(['Free Account', 'BITBI Pro', 'Starter Credits', 'Creator Credits']);
  await expect(page.locator('.pricing-card').nth(0)).toContainText('0 €');
  await expect(page.locator('.pricing-card').nth(0)).toContainText('No paid credits included');
  await expect(page.locator('.pricing-card').nth(0)).toContainText('Verified accounts are topped up to 10 free credits each day, and those daily credits do not accumulate.');
  await expect(page.locator('.pricing-card').nth(1)).toContainText('9,99 €');
  await expect(page.locator('.pricing-card').nth(1)).toContainText('/ month');
  await expect(page.locator('.pricing-card').nth(2)).toContainText('9.99 €');
  await expect(page.locator('.pricing-card').nth(3)).toContainText('19.99 €');
  await expect(page.locator('.pricing-card').nth(3)).toContainText('Best value');
};
