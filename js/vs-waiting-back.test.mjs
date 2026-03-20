import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function testBackLinksPresent() {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const vsHtmlPath = path.resolve(__dirname, '../vs.html');
  const html = fs.readFileSync(vsHtmlPath, 'utf8');

  // 1v1 waiting lobby
  assert.ok(
    html.includes('id="vs-lobby-back-btn"'),
    'Expected 1v1 lobby back link (id="vs-lobby-back-btn") to exist in vs.html'
  );
  assert.ok(
    html.includes('href="/vs-rooms.html"') && html.includes('vs-lobby-back-btn'),
    'Expected 1v1 lobby back link to point to /vs-rooms.html'
  );

  // Team waiting lobby
  assert.ok(
    html.includes('id="vs-team-lobby-back-btn"'),
    'Expected team lobby back link (id="vs-team-lobby-back-btn") to exist in vs.html'
  );
  assert.ok(
    html.includes('href="/vs-rooms.html"') && html.includes('vs-team-lobby-back-btn'),
    'Expected team lobby back link to point to /vs-rooms.html'
  );

  // Shared styling hook
  assert.ok(
    html.includes('class="vs-lobby-back-link"'),
    'Expected back links to use class="vs-lobby-back-link" for consistent styling'
  );
}

testBackLinksPresent();
console.log('vs-waiting-back: all tests passed');

