describe('passing', () => {
  it('adds two numbers', () => {
    cy.step('Add 1 and 1', 'STEP');
    cy.wrap(1 + 1).should('equal', 2);
  });
});
