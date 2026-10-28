<script lang="ts">
  import dark from '../assets/kinoshelf-logo.svg';
  import light from '../assets/kinoshelf-logo-light.svg';

  let { height = 28 }: { height?: number } = $props();
</script>

<!-- The logo has its own colors for each background; the theme shows the right one. -->
<span class="logo">
  <img class="on-dark" src={dark} alt="Kinoshelf" {height} />
  <img class="on-light" src={light} alt="" aria-hidden="true" {height} />
</span>

<style>
  .logo {
    display: inline-flex;
  }

  img {
    width: auto;
  }

  .on-dark {
    display: var(--logo-dark);
  }

  .on-light {
    display: var(--logo-light);
  }
</style>
