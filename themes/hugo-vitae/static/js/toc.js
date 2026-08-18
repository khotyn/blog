(function () {
  const toc = document.querySelector('.post-toc');
  const content = document.querySelector('.markdown');

  if (!toc || !content) return;

  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const entries = links.map((link) => {
    const id = decodeURIComponent(link.hash.slice(1));
    return { link, heading: document.getElementById(id) };
  }).filter((entry) => entry.heading);

  if (!entries.length) return;

  let ticking = false;

  function setActive(id) {
    entries.forEach(({ link, heading }) => {
      const active = heading.id === id;
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function updateActiveHeading() {
    const marker = Math.min(180, window.innerHeight * 0.25);
    let current = entries[0].heading.id;

    for (const { heading } of entries) {
      if (heading.getBoundingClientRect().top <= marker) {
        current = heading.id;
      } else {
        break;
      }
    }

    setActive(current);
    ticking = false;
  }

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      const id = decodeURIComponent(link.hash.slice(1));
      const heading = document.getElementById(id);
      if (!heading) return;

      event.preventDefault();
      setActive(id);
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.pushState(null, '', `#${encodeURIComponent(id)}`);
    });
  });

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(updateActiveHeading);
    }
  }, { passive: true });

  window.addEventListener('resize', updateActiveHeading);
  updateActiveHeading();
}());
