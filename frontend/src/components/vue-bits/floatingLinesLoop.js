// Keep decorative WebGL at 30 fps and freeze elapsed time while paused.
export function floatingLinesLoop(render) {
  let frame, previous = null, running = false;
  function tick(now) {
    if (!running) return;
    if (previous === null || now - previous >= 1000 / 30) {
      render(previous === null ? 0 : Math.min((now - previous) / 1000, .1));
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
