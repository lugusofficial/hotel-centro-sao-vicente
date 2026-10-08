// Tour 360 do quarto: panorama equirretangular projetado numa esfera, com a
// camera no centro dela. E o mesmo principio dos tours de hotel e de imovel.
//
// Decisoes:
// - Carrega sob demanda. O panorama pesa, e quem nao abrir o tour nao paga.
// - Render sob demanda: parado nao gasta GPU nem bateria.
// - Arraste proprio, com touch-action pan-y, para o gesto vertical continuar
//   rolando a pagina no celular em vez de girar a camera.
// - Botoes de olhar como alternativa ao arraste, que a WCAG 2.2 exige no
//   criterio 2.5.7, com alvo de 44 px.
// - O quarto inteiro tambem esta descrito em texto ao lado: nada mora so aqui.
//
// O three.js entra por import dinamico dentro do clique, nao no topo do
// arquivo: import estatico baixaria a biblioteca inteira no carregamento da
// pagina, e quem so quer ler a descricao do quarto nao precisa dela.

const raiz = document.querySelector('[data-tour]');
if (raiz) {
  const canvas = raiz.querySelector('[data-tour-canvas]');
  const botao = raiz.querySelector('[data-tour-start]');
  const aviso = raiz.querySelector('[data-tour-aviso]');
  const estado = raiz.querySelector('[data-tour-status]');
  const arquivo = canvas && canvas.dataset.panorama;
  const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const anunciar = (t) => { if (estado) estado.textContent = t; };
  const falhar = (texto) => {
    raiz.removeAttribute('data-pronto');
    if (aviso) aviso.hidden = false;
    if (botao) { botao.disabled = false; botao.textContent = texto; }
  };

  // Canvas descartavel: pedir o contexto no canvas de verdade faz o three
  // reaproveitar esse contexto e ignorar antialias e demais atributos.
  const temWebgl = () => {
    try {
      const t = document.createElement('canvas');
      return !!(t.getContext('webgl2') || t.getContext('webgl'));
    } catch (e) {
      return false;
    }
  };

  function montar(THREE) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      falhar('Tour indisponível neste navegador');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

    const cena = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(74, 1, 0.1, 200);

    // Esfera vista por dentro. O scale negativo em X vira a geometria do
    // avesso: sem ele olhamos o verso da superficie e o panorama aparece
    // espelhado, com a porta do lado errado do quarto.
    const geo = new THREE.SphereGeometry(50, 64, 40);
    geo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a2724 });
    cena.add(new THREE.Mesh(geo, mat));

    let precisa = true;
    const invalidar = () => { precisa = true; };

    const tex = new THREE.TextureLoader().load(
      `assets/${arquivo}`,
      () => {
        mat.map = tex;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;   // sair de sem mapa para com mapa recompila o shader
        raiz.setAttribute('data-pronto', 'true');
        if (botao) botao.hidden = true;
        anunciar('Tour aberto. Arraste para olhar em volta, ou use os botões abaixo.');
        invalidar();
      },
      undefined,
      () => falhar('Não foi possível carregar o tour'));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // Longitude e latitude em graus, que e como se descreve direcao numa
    // esfera. A latitude trava antes dos polos: olhar reto para cima e para
    // baixo so mostra a distorcao da projecao.
    //
    // A longitude inicial vem do HTML porque depende da imagem: a coluna x da
    // textura corresponde a 360 * x / largura, entao cada quarto abre virado
    // para a cama em vez de para a primeira parede que calhar.
    const INICIO = Number(canvas.dataset.inicio || 0);
    let lon = INICIO;
    let lat = 0;
    const alvo = new THREE.Vector3();
    function mirar() {
      lat = Math.max(-78, Math.min(78, lat));
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon);
      alvo.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      camera.lookAt(alvo);
      invalidar();
    }

    // ------------------------------------------------------------- arraste
    let arrastando = false;
    let ultimoX = 0;
    let ultimoY = 0;
    let inicioX = 0;
    let inicioY = 0;
    let decidido = false;

    canvas.addEventListener('pointerdown', (e) => {
      arrastando = true;
      decidido = e.pointerType !== 'touch';
      inicioX = ultimoX = e.clientX;
      inicioY = ultimoY = e.clientY;
      if (decidido) canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!arrastando) return;
      if (!decidido) {
        // No toque o gesto so vira giro depois de provar que e horizontal.
        const dx = Math.abs(e.clientX - inicioX);
        const dy = Math.abs(e.clientY - inicioY);
        if (dx < 6 && dy < 6) return;
        if (dy > dx) { arrastando = false; return; }
        decidido = true;
        canvas.setPointerCapture(e.pointerId);
      }
      lon -= (e.clientX - ultimoX) * 0.13;
      lat += (e.clientY - ultimoY) * 0.13;
      ultimoX = e.clientX;
      ultimoY = e.clientY;
      mirar();
    });
    const soltar = (e) => {
      arrastando = false;
      canvas.style.cursor = 'grab';
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener('pointerup', soltar);
    canvas.addEventListener('pointercancel', soltar);
    canvas.style.cursor = 'grab';

    // ------------------------------------------------- botoes e teclado
    const PASSO = 24;
    const nomes = {
      esq: 'Olhou para a esquerda', dir: 'Olhou para a direita',
      cima: 'Olhou para cima', baixo: 'Olhou para baixo',
      inicio: 'Voltou ao ponto de partida',
    };
    function olhar(dir) {
      if (dir === 'esq') lon -= PASSO;
      else if (dir === 'dir') lon += PASSO;
      else if (dir === 'cima') lat += PASSO * 0.7;
      else if (dir === 'baixo') lat -= PASSO * 0.7;
      else if (dir === 'inicio') { lon = INICIO; lat = 0; }
      mirar();
      anunciar(nomes[dir] || '');
    }
    raiz.querySelectorAll('[data-olhar]').forEach((b) => {
      b.addEventListener('click', () => olhar(b.dataset.olhar));
    });

    // Ampliar. Em 290 px de altura o quarto nao cabe no olho; em tela cheia
    // cabe. A API e o caminho normal e a classe e a reserva para quando o
    // navegador recusa, caso do Safari no iPhone, onde requestFullscreen nao
    // existe para elemento comum.
    const palco = raiz.querySelector('.tour__palco');
    const botaoTela = raiz.querySelector('[data-tela]');
    function ampliado() {
      return document.fullscreenElement === palco || palco.classList.contains('is-ampliado');
    }
    function rotular() {
      if (!botaoTela) return;
      botaoTela.textContent = ampliado() ? 'Reduzir' : 'Ampliar';
      anunciar(ampliado() ? 'Tour em tela cheia.' : 'Tour no tamanho normal.');
      invalidar();
    }
    const reserva = () => {
      if (palco.classList.contains('is-ampliado')) return;
      palco.classList.add('is-ampliado');
      rotular();
    };

    function alternarTela() {
      if (ampliado()) {
        // Sai dos dois estados: se a tela cheia tiver engatado depois da
        // reserva ter entrado, os dois podem estar ligados ao mesmo tempo.
        if (document.fullscreenElement === palco) document.exitFullscreen();
        palco.classList.remove('is-ampliado');
        rotular();
        return;
      }
      if (!document.fullscreenEnabled || !palco.requestFullscreen) {
        reserva();
        return;
      }
      palco.requestFullscreen().catch(reserva);
      // Rede de seguranca. A promessa pode nao resolver nem rejeitar, e ai o
      // botao ficaria sem efeito para sempre. Passados 400 ms sem tela cheia,
      // vale a reserva: o importante e o clique sempre fazer alguma coisa.
      setTimeout(() => {
        if (document.fullscreenElement !== palco) reserva();
      }, 400);
    }
    if (botaoTela) botaoTela.addEventListener('click', alternarTela);
    document.addEventListener('fullscreenchange', rotular);
    // Escape sai da tela cheia sozinho; da reserva, nao.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && palco.classList.contains('is-ampliado')) {
        palco.classList.remove('is-ampliado');
        rotular();
      }
    });
    // As setas valem quando o foco esta num dos botoes. No canvas nao daria: ele
    // e aria-hidden, e por isso fica fora da ordem de foco de proposito.
    const controles = raiz.querySelector('.tour__controles');
    if (controles) controles.addEventListener('keydown', (e) => {
      const mapa = { ArrowLeft: 'esq', ArrowRight: 'dir', ArrowUp: 'cima', ArrowDown: 'baixo', Home: 'inicio' };
      if (!mapa[e.key]) return;
      e.preventDefault();
      olhar(mapa[e.key]);
    });

    // --------------------------------------------------------- desenho
    let visivel = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        visivel = es[0].isIntersecting;
        if (visivel) invalidar();
      }, { threshold: 0 }).observe(canvas);
    }
    document.addEventListener('visibilitychange', () => {
      visivel = !document.hidden;
      if (visivel) invalidar();
    });

    function quadro() {
      requestAnimationFrame(quadro);
      if (!visivel) return;
      const l = canvas.clientWidth;
      const a = canvas.clientHeight;
      if (!l || !a) return;
      if (canvas.width !== l || canvas.height !== a) {
        renderer.setSize(l, a, false);
        camera.aspect = l / a;
        camera.updateProjectionMatrix();
        precisa = true;
      }
      if (!precisa) return;
      precisa = false;
      renderer.render(cena, camera);
    }

    mirar();
    quadro();
  }

  if (botao && arquivo) {
    if (!temWebgl()) {
      falhar('Tour indisponível neste navegador');
    } else {
      botao.addEventListener('click', () => {
        botao.disabled = true;
        botao.textContent = 'Carregando o tour';
        import('three')
          .then((THREE) => montar(THREE))
          .catch(() => falhar('Não foi possível carregar o tour'));
      }, { once: true });
      if (reduzido) {
        anunciar('Movimento reduzido ativo. O tour abre parado, no ponto de partida.');
      }
    }
  }
}
