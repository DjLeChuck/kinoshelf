import mediumZoom from 'medium-zoom';
import DefaultTheme from 'vitepress/theme';
import { useRoute } from 'vitepress';
import { nextTick, onMounted, watch } from 'vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();
    // A click on a screenshot opens it at full size in a popin (Escape or a click closes it).
    const zoom = () =>
      mediumZoom('.vp-doc img', { background: 'rgba(8, 8, 10, 0.86)', margin: 24 });
    onMounted(zoom);
    watch(
      () => route.path,
      () => void nextTick(zoom),
    );
  },
};
