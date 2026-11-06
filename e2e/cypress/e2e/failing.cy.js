describe('failing', () => {
  it('expects the wrong total', () => {
    cy.step('Expect 1 and 1 to make 3', 'CHECK');
    cy.wrap(1 + 1, { timeout: 500 }).should('equal', 3);
  });
});
