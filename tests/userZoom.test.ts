import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, USER_ZOOM_MAX, USER_ZOOM_MIN, clampUserZoom } from '../src/render/CameraRig';
import { normalizeScale } from '../src/render/Renderer';
import { pinchDelta, shortcutForKey, wheelDelta } from '../src/input/Input';

const key = (key: string, code = '', extra: Record<string, boolean> = {}) => ({ key, code, ...extra });

describe('clampUserZoom', () => {
  it('clamps to the range and rejects non-finite', () => {
    expect(clampUserZoom(0.1)).toBe(USER_ZOOM_MIN);
    expect(clampUserZoom(5)).toBe(USER_ZOOM_MAX);
    expect(clampUserZoom(1.1)).toBe(1.1);
    expect(clampUserZoom(NaN)).toBe(1);
  });
});

describe('CameraRig user zoom', () => {
  const frustumH = (cam: THREE.OrthographicCamera) => cam.top - cam.bottom;
  it('eases toward the target, reads back the target, and multiplies phase zoom', () => {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1);
    const rig = new CameraRig(cam);
    rig.resize(1280, 720);
    const h0 = frustumH(cam);
    rig.setUserZoom(2);
    expect(rig.userZoom).toBe(USER_ZOOM_MAX);
    expect(frustumH(cam)).toBeCloseTo(h0, 6); // not applied immediately
    rig.update(0.016);
    expect(rig.userZoomShown).toBeGreaterThan(1);
    expect(rig.userZoomShown).toBeLessThan(USER_ZOOM_MAX);
    for (let i = 0; i < 20; i++) rig.update(0.016);
    expect(rig.userZoomShown).toBe(USER_ZOOM_MAX);
    expect(frustumH(cam)).toBeCloseTo(h0 / USER_ZOOM_MAX, 5);
    // phase zoom still multiplies
    rig.setZoom(0.5, 0);
    expect(frustumH(cam)).toBeCloseTo(h0 / USER_ZOOM_MAX / 0.5, 5);
    // accumulation through the getter while the ease runs
    rig.setUserZoom(1);
    rig.setUserZoom(rig.userZoom + 0.1);
    rig.setUserZoom(rig.userZoom + 0.1);
    expect(rig.userZoom).toBeCloseTo(1.2, 9);
    // resize keeps the eased zoom
    rig.resize(640, 360);
    rig.snapToTarget();
    expect(frustumH(cam)).toBeGreaterThan(0);
  });
});

describe('Renderer scale normalisation', () => {
  it('clamps 0.5..1, rounds to 0.05, bad → 1', () => {
    expect(normalizeScale(0.2)).toBe(0.5);
    expect(normalizeScale(3)).toBe(1);
    expect(normalizeScale(0.73)).toBe(0.75);
    expect(normalizeScale(0.62)).toBe(0.6);
    expect(normalizeScale(NaN)).toBe(1);
  });
});

describe('Input helpers', () => {
  it('maps keys to shortcuts', () => {
    expect(shortcutForKey(key('Escape', 'Escape'))).toBe('escape');
    expect(shortcutForKey(key('m', 'KeyM'))).toBe('mute');
    expect(shortcutForKey(key('M', 'KeyM'))).toBe('mute');
    expect(shortcutForKey(key('f', 'KeyF'))).toBe('fullscreen');
    expect(shortcutForKey(key('F11', 'F11'))).toBe('fullscreen');
    expect(shortcutForKey(key('Enter', 'Enter', { altKey: true }))).toBe('fullscreen');
    expect(shortcutForKey(key('Enter', 'Enter'))).toBeNull();
    expect(shortcutForKey(key('+', 'Equal'))).toBe('zoomIn');
    expect(shortcutForKey(key('=', 'Equal'))).toBe('zoomIn');
    expect(shortcutForKey(key('+', 'NumpadAdd'))).toBe('zoomIn');
    expect(shortcutForKey(key('-', 'Minus'))).toBe('zoomOut');
    expect(shortcutForKey(key('-', 'NumpadSubtract'))).toBe('zoomOut');
    expect(shortcutForKey(key('w', 'KeyW'))).toBeNull();
    expect(shortcutForKey(key('-', 'Minus', { ctrlKey: true }))).toBeNull();
  });
  it('does not report F11 / Alt+Enter in the desktop shell, but F still works', () => {
    expect(shortcutForKey(key('F11', 'F11'), true)).toBeNull();
    expect(shortcutForKey(key('Enter', 'Enter', { altKey: true }), true)).toBeNull();
    expect(shortcutForKey(key('f', 'KeyF'), true)).toBe('fullscreen');
  });
  it('scales wheel and pinch deltas', () => {
    expect(wheelDelta(-120)).toBeCloseTo(0.1);
    expect(wheelDelta(53)).toBeCloseTo(-0.1);
    // pinch doubling from 100px, in steps, sums to +0.3
    let last = 100;
    let sum = 0;
    for (const d of [120, 150, 200]) {
      sum += pinchDelta(d, last, 100);
      last = d;
    }
    expect(sum).toBeCloseTo(0.3, 9);
    expect(pinchDelta(50, 100, 100)).toBeCloseTo(-0.15);
  });
});
