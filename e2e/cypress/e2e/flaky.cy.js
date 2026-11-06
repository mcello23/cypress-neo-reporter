describe('flaky', () => {
  it('passes on the retry', { retries: 1 }, () => {
    cy.step('Fail the first attempt only', 'CHECK');
    cy.wrap(Cypress.currentRetry, { timeout: 500 }).should('equal', 1);
  });
});
