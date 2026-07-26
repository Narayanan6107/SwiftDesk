const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');

test('Ticket validationSource enum test', async (t) => {
  // We don't need a real MongoDB connection to test synchronous mongoose schema validation.
  
  await t.test('accepts "Gemini" as validationSource', () => {
    const ticket = new Ticket({
      ticketId: 'SD-TEST1',
      subject: 'Test Subject',
      description: 'Test Description',
      priority: 'Low',
      validationSource: 'Gemini'
    });
    
    // We only validate validationSource path.
    const err = ticket.validateSync(['validationSource']);
    assert.strictEqual(err, undefined);
  });

  await t.test('accepts legacy values "ML" and "LLM"', () => {
    const ticketML = new Ticket({
      ticketId: 'SD-TEST2',
      subject: 'Test Subject',
      description: 'Test Description',
      priority: 'Low',
      validationSource: 'ML'
    });
    const errML = ticketML.validateSync(['validationSource']);
    assert.strictEqual(errML, undefined);

    const ticketLLM = new Ticket({
      ticketId: 'SD-TEST3',
      subject: 'Test Subject',
      description: 'Test Description',
      priority: 'Low',
      validationSource: 'LLM'
    });
    const errLLM = ticketLLM.validateSync(['validationSource']);
    assert.strictEqual(errLLM, undefined);
  });

  await t.test('rejects invalid validationSource values', () => {
    const ticketInvalid = new Ticket({
      ticketId: 'SD-TEST4',
      subject: 'Test Subject',
      description: 'Test Description',
      priority: 'Low',
      validationSource: 'ChatGPT'
    });
    
    const err = ticketInvalid.validateSync(['validationSource']);
    assert.ok(err, 'Expected validation error for invalid validationSource');
    assert.ok(err.errors['validationSource'], 'Expected error on validationSource path');
    assert.match(err.errors['validationSource'].message, /is not a valid enum value/);
  });
});
