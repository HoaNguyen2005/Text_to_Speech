import { onBeforeUnmount, onMounted, ref } from 'vue';

export function useSceneMotion(element) {
  const paused = ref(true);
  let observer;
  let visible = true;
  const update = () => { paused.value = document.hidden || !visible; };
  onMounted(() => {
    if (typeof IntersectionObserver !== 'undefined' && element.value) {
      observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
      observer.observe(element.value);
    }
    document.addEventListener('visibilitychange', update);
    update();
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
  });
  return paused;
}
