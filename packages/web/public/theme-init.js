// Applies the saved theme before the page paints, so a light-theme user never sees a dark flash.
try {
  var theme = localStorage.getItem('kinoshelf.theme');
  var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme =
    theme === 'light' || theme === 'dark' ? theme : dark ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'dark';
}
