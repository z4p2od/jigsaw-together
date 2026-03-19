import assert from 'node:assert/strict';
import { getWhatHappenedCopy } from './feedback-copy.js';

function testBugCopy() {
  const c = getWhatHappenedCopy('bug');
  assert.equal(c.label, 'What happened?');
  assert.ok(c.placeholder.toLowerCase().includes('bug'));
}

function testIdeaCopyDifferentFromBug() {
  const c = getWhatHappenedCopy('idea');
  assert.equal(c.label, "What's your idea?");
  assert.ok(!c.placeholder.toLowerCase().includes('bug'));
}

function testFeedbackCopy() {
  const c = getWhatHappenedCopy('feedback');
  assert.equal(c.label, 'What feedback would you like to share?');
  assert.ok(c.placeholder.toLowerCase().includes('improve'));
}

function testFallbackToBug() {
  const c = getWhatHappenedCopy('unknown-type');
  assert.equal(c.label, 'What happened?');
}

testBugCopy();
testIdeaCopyDifferentFromBug();
testFeedbackCopy();
testFallbackToBug();

console.log('feedback-copy: all tests passed');

