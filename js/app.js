// Galeria de fotos e reveal de rolagem. Progressivo: a pagina funciona sem este arquivo.
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Galeria: setas, pontos, teclado e arraste horizontal.
     O arraste so assume quando o gesto comeca horizontal, para nao travar o scroll. */
  function gallery() {
    var root = document.querySelector('[data-gal]');
    if (!root) { return; }
    var track = root.querySelector('[data-gal-track]');
    var dots = root.querySelector('[data-gal-dots]');
    var prev = root.querySelector('[data-gal-prev]');
    var next = root.querySelector('[data-gal-next]');
    if (!track || !dots || !prev || !next) { return; }

    var slides = [].slice.call(track.children);
    if (slides.length < 2) {
      root.querySelector('.gal__controls').hidden = true;
      return;
    }

    root.classList.add('is-live');
    var index = 0;

    var buttons = slides.map(function (slide, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gal__dot';
      var label = document.createElement('span');
      label.className = 'visually-hidden';
      label.textContent = 'Foto ' + (i + 1) + ' de ' + slides.length;
      b.appendChild(label);
      b.addEventListener('click', function () { go(i); });
      li.appendChild(b);
      dots.appendChild(li);
      return b;
    });

    function go(target) {
      index = (target + slides.length) % slides.length;
      track.style.transform = 'translateX(' + (index * -100) + '%)';
      slides.forEach(function (s, i) { s.setAttribute('aria-hidden', i === index ? 'false' : 'true'); });
      buttons.forEach(function (b, i) { b.setAttribute('aria-current', i === index ? 'true' : 'false'); });
    }

    prev.addEventListener('click', function () { go(index - 1); });
    next.addEventListener('click', function () { go(index + 1); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    });

    var sx = null, sy = null, horiz = false;
    root.addEventListener('pointerdown', function (e) {
      sx = e.clientX; sy = e.clientY; horiz = false;
    });
    root.addEventListener('pointermove', function (e) {
      if (sx === null || horiz) { return; }
      var dx = Math.abs(e.clientX - sx), dy = Math.abs(e.clientY - sy);
      if (dx > 10 && dx > dy) { horiz = true; }
      else if (dy > 10) { sx = null; }
    });
    root.addEventListener('pointerup', function (e) {
      if (sx === null || !horiz) { sx = null; return; }
      var dx = e.clientX - sx;
      if (Math.abs(dx) > 45) { go(index + (dx < 0 ? 1 : -1)); }
      sx = null;
    });

    go(0);
  }

  /* Reveal discreto. Sem script a pagina aparece inteira. */
  function reveal() {
    if (reduced || !('IntersectionObserver' in window)) { return; }
    var targets = [].slice.call(document.querySelectorAll('.section > .container, .hero__inner, .hero__media'));
    if (!targets.length) { return; }
    document.documentElement.classList.add('js-reveal');
    targets.forEach(function (t) { t.setAttribute('data-reveal', ''); });
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); obs.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    targets.forEach(function (t) { obs.observe(t); });
  }

  /* Barra de preco fixa: aparece depois que o bloco principal sai da tela. */
  function priceBar() {
    var bar = document.querySelector('.pricebar');
    var intro = document.querySelector('.room__intro');
    if (!bar || !intro || !('IntersectionObserver' in window)) { return; }
    new IntersectionObserver(function (es) {
      es.forEach(function (en) { bar.classList.toggle('is-shown', !en.isIntersecting); });
    }, { threshold: 0 }).observe(intro);
  }

  reveal();
  gallery();
  priceBar();
})();
