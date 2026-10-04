// Existing functional cases deliberately open settings before their unchanged
// actions. Canvas Inspector cases separately assert collapsed/default behavior.
exports.openCanvasSettings = async (page, kind) => {
  const details = page.locator(`.canvas-${kind}-settings`);
  if (await details.count() && !(await details.evaluate(element => element.open))) await details.locator(':scope > summary').click();
};
