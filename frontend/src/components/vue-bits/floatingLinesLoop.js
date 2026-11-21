// Keep decorative WebGL at 30 fps and freeze elapsed time while paused.
export function floatingLinesLoop(render) {
  const interval = 1000 / 30;
  let frame, previous = null, nextDraw = 0, running = false;
  function tick(now) {
    if (!running) return;
    if (previous === null || now >= nextDraw - .5) {
      render(previous === null ? 0 : Math.min((now - previous) / 1000, .1));
      // Keep the cadence across fractional display ticks without catching up after a stall.
      nextDraw = previous === null || now - nextDraw >= interval ? now + interval : nextDraw + interval;
      previous = now;
    }
    if (running) frame = requestAnimationFrame(tick);
  }
  return {
    start() {
      if (running) return;
      running = true;
      previous = null;
      frame = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}
