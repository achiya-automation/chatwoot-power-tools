import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsCompression,
  needsTranscode,
  targetHeight,
  planCompression,
  nextBitrate,
  VIDEO_TARGET_BYTES,
  MAX_HEIGHT,
  MIN_VIDEO_KBPS,
  MAX_VIDEO_KBPS,
} from '../src/lib/videoCompress.js';

const MB = 1024 * 1024;

// ── needsCompression ────────────────────────────────────────────────────────
test('needsCompression: video over target → true', () => {
  assert.equal(needsCompression({ format: 'VIDEO', mime: 'video/mp4', byteSize: 20 * MB }), true);
});

test('needsCompression: video under target → false', () => {
  assert.equal(needsCompression({ format: 'VIDEO', mime: 'video/mp4', byteSize: 10 * MB }), false);
});

test('needsCompression: image over size → false (only video is compressed)', () => {
  assert.equal(needsCompression({ format: 'IMAGE', mime: 'image/jpeg', byteSize: 20 * MB }), false);
});

test('needsCompression: VIDEO format but non-video mime → false', () => {
  assert.equal(needsCompression({ format: 'VIDEO', mime: 'application/pdf', byteSize: 20 * MB }), false);
});

test('needsCompression: exactly at target → false (not strictly over)', () => {
  assert.equal(needsCompression({ format: 'VIDEO', mime: 'video/mp4', byteSize: VIDEO_TARGET_BYTES }), false);
});

// ── needsTranscode (single component decision: route through ffmpeg before upload) ──
test('needsTranscode: oversized mp4 → true', () => {
  assert.equal(needsTranscode({ format: 'VIDEO', mime: 'video/mp4', byteSize: 20 * MB }), true);
});

test('needsTranscode: small valid mp4 → false (passes straight through)', () => {
  assert.equal(needsTranscode({ format: 'VIDEO', mime: 'video/mp4', byteSize: 10 * MB }), false);
});

test('needsTranscode: small .mov (wrong container) → true (convert to mp4)', () => {
  assert.equal(needsTranscode({ format: 'VIDEO', mime: 'video/quicktime', byteSize: 10 * MB }), true);
});

test('needsTranscode: oversized .mov → true', () => {
  assert.equal(needsTranscode({ format: 'VIDEO', mime: 'video/quicktime', byteSize: 20 * MB }), true);
});

test('needsTranscode: small valid 3gp → false', () => {
  assert.equal(needsTranscode({ format: 'VIDEO', mime: 'video/3gpp', byteSize: 5 * MB }), false);
});

test('needsTranscode: image header → false (not a video)', () => {
  assert.equal(needsTranscode({ format: 'IMAGE', mime: 'image/jpeg', byteSize: 20 * MB }), false);
});

test('needsTranscode: VIDEO header but non-video file → false (validation rejects it instead)', () => {
  assert.equal(needsTranscode({ format: 'VIDEO', mime: 'application/pdf', byteSize: 5 * MB }), false);
});

// ── targetHeight (downscale only, even dimensions for H.264) ─────────────────
test('targetHeight: 1080 → caps to 720', () => {
  assert.equal(targetHeight(1080), MAX_HEIGHT);
});

test('targetHeight: 480 stays 480 (never upscales)', () => {
  assert.equal(targetHeight(480), 480);
});

test('targetHeight: odd 481 → floored to even 480', () => {
  assert.equal(targetHeight(481), 480);
});

test('targetHeight: missing height → defaults to max', () => {
  assert.equal(targetHeight(undefined), MAX_HEIGHT);
});

// ── planCompression ─────────────────────────────────────────────────────────
test('planCompression: 60s/1080p → feasible, downscaled to 720, sane bitrate', () => {
  const p = planCompression({ durationSec: 60, height: 1080 });
  assert.equal(p.feasible, true);
  assert.equal(p.scaleHeight, 720);
  assert.equal(p.audioKbps, 96);
  // budget = TARGET*8*0.95/60/1000 - 96 audio ≈ 1936 kbps
  assert.equal(p.videoKbps, 1936);
});

test('planCompression: very long 600s video → not feasible (cannot fit at min quality)', () => {
  const p = planCompression({ durationSec: 600, height: 1080 });
  assert.equal(p.feasible, false);
  assert.equal(p.videoKbps, MIN_VIDEO_KBPS); // clamped to floor
});

test('planCompression: very short 10s video → bitrate capped at MAX', () => {
  const p = planCompression({ durationSec: 10, height: 1080 });
  assert.equal(p.feasible, true);
  assert.equal(p.videoKbps, MAX_VIDEO_KBPS);
});

test('planCompression: low-res source is not upscaled', () => {
  const p = planCompression({ durationSec: 60, height: 360 });
  assert.equal(p.scaleHeight, 360);
});

test('planCompression: unknown duration → optimistic default plan (relies on size-check + retry)', () => {
  const p = planCompression({ durationSec: 0, height: 1080 });
  assert.equal(p.feasible, true);
  assert.equal(p.videoKbps, 800);
});

// ── nextBitrate (retry loop when first pass overshoots) ──────────────────────
test('nextBitrate: overshoot 18MB vs 15.3MB target → scales bitrate down proportionally', () => {
  const next = nextBitrate({ prevVideoKbps: 2000, achievedBytes: 18 * MB, targetBytes: VIDEO_TARGET_BYTES });
  assert.equal(next, 1614);
});

test('nextBitrate: never drops below the minimum floor', () => {
  const next = nextBitrate({ prevVideoKbps: 200, achievedBytes: 100 * MB, targetBytes: VIDEO_TARGET_BYTES });
  assert.equal(next, MIN_VIDEO_KBPS);
});
