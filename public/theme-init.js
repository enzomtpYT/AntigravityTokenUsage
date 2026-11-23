(function () {
  try {
    var stored = localStorage.getItem('agy-theme');
    var root = document.documentElement;
    if (stored === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
