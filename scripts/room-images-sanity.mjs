import assert from 'node:assert/strict';
import { filterResourcesByFolder } from './cloudinary-folder-utils.mjs';

// This sanity check ensures our post-filtering is strict enough to
// avoid returning assets from similarly named folders.
const resources = [
  {
    folder: 'puzzle-library',
    public_id: 'puzzle-library/img1',
    secure_url: 'https://example.com/puzzle-library/img1.jpg',
    width: 100,
    height: 200,
  },
  {
    folder: 'potd-pool',
    public_id: 'potd-pool/img2',
    secure_url: 'https://example.com/potd-pool/img2.jpg',
    width: 300,
    height: 400,
  },
  {
    folder: 'puzzle-library/sub',
    public_id: 'puzzle-library/sub/img3',
    secure_url: 'https://example.com/puzzle-library/sub/img3.jpg',
    width: 10,
    height: 11,
  },
  {
    // Similar prefix should NOT match.
    folder: undefined,
    public_id: 'puzzle-library-foo/img4',
    secure_url: 'https://example.com/puzzle-library-foo/img4.jpg',
    width: 1,
    height: 1,
  },
  {
    folder: undefined,
    public_id: 'puzzle-library/img5',
    secure_url: 'https://example.com/puzzle-library/img5.jpg',
    width: 5,
    height: 6,
  },
];

const filtered = filterResourcesByFolder(resources, 'puzzle-library');
assert.equal(filtered.length, 3, 'Expected 3 resources in puzzle-library (including subfolder)');

const publicIds = filtered.map(r => r.public_id).sort();
assert.deepEqual(
  publicIds,
  ['puzzle-library/img1', 'puzzle-library/img5', 'puzzle-library/sub/img3'].sort()
);

console.log('room-images-sanity: OK');
