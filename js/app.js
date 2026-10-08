// Galeria de fotos e reveal de rolagem. Progressivo: a pagina funciona sem este arquivo.
(function () {
  'use strict';

  // Frases da pagina. Os arquivos de script sao os mesmos nas duas linguas,
  // entao o texto vem do bloco JSON que a pagina traz. Sem o bloco, vale o
  // portugues escrito aqui como reserva.
  var FRASES = (function () {
    try { return JSON.parse(document.getElementById('i18n').textContent); }
    catch (e) { return {}; }
  })();
  var fr = function (chave, reserva) { return FRASES[chave] || reserva; };

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
      label.textContent = fr('foto', 'Foto {i} de {n}')
        .replace('{i}', i + 1).replace('{n}', slides.length);
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


  /* Cabecalho sobre a cena. Duas regras, e so duas:
       1. ha cena atras dele  -> estado claro, fundo transparente;
       2. menu aberto         -> estado solido, sempre, porque a lista se abre
          por cima do predio e precisaria de fundo proprio para ser legivel.

     O estado e recalculado do zero a cada quadro de rolagem, a partir de onde
     a cena esta na tela. Antes vinha de um IntersectionObserver com sentinela,
     e isso dava dois defeitos: a primeira medicao acontecia antes do layout
     fechar e travava no estado errado ate a primeira rolagem, e descer e
     subir nao davam o mesmo resultado no mesmo ponto. Calcular do zero e
     simetrico por construcao.

     Sem script o cabecalho fica solido, que e o estado legivel. */
  function headerSobreCena() {
    var header = document.querySelector('.site-header');
    var cena = document.querySelector('.cena');
    var nav = document.getElementById('site-nav');
    if (!header || !cena) { return; }

    // Limite de rolagem a partir do qual nao ha mais cena atras do cabecalho.
    // Guardar o numero em vez de medir a cena a cada rolagem: ler a geometria
    // dentro do evento de scroll forca o navegador a refazer o layout a cada
    // quadro, que e justamente o que trava a rolagem em celular fraco.
    var altura = 0;
    var limite = 0;
    function medir() {
      // A cena sobe por tras do cabecalho fechado. Com o menu aberto ele fica
      // varias vezes mais alto, e medir nessa hora faria a cena saltar; por
      // isso a medida so e refeita com o menu fechado.
      if (nav && nav.getAttribute('data-open') === 'true') { return; }
      altura = Math.round(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--altura-header', altura + 'px');
      limite = cena.getBoundingClientRect().bottom + window.scrollY - altura;
    }

    function avaliar() {
      var aberto = nav && nav.getAttribute('data-open') === 'true';
      header.setAttribute('data-sobre',
        (!aberto && window.scrollY < limite) ? 'true' : 'false');
    }

    medir();
    avaliar();
    window.addEventListener('scroll', avaliar, { passive: true });
    window.addEventListener('resize', function () { medir(); avaliar(); });
    // A fonte de titulo muda a altura do cabecalho quando chega.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { medir(); avaliar(); });
    }
    // O menu e do js/main.js, que e gerado pelo scaffold e vale para todos os
    // sites. Em vez de edita-lo, aqui so se escuta o atributo que ele troca.
    if (nav && 'MutationObserver' in window) {
      new MutationObserver(avaliar).observe(nav, {
        attributes: true, attributeFilter: ['data-open'],
      });
    }
  }

  reveal();
  gallery();
  priceBar();
  headerSobreCena();
})();
