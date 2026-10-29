// Predio do hotel para escolher o quarto, em fotos renderizadas no Blender.
//
// A v1 desenhava o predio em three.js com caixas e cores chapadas. Aqui o
// predio e o real, modelado a partir das fotos e renderizado no Cycles em 24
// vistas em volta dele (blender/fachada_m.py). Cada vista vem com os quatro
// cantos de cada janela de quarto projetados na imagem, entao girar e trocar
// de foto, e clicar e testar o ponto contra o quadrilatero da janela.
//
// A API e a mesma da v1 (montarPredio devolve hotel, selecionar, verGeral,
// aplicarFiltro, toqueDoPredio, solDaFachada), para a interface de chips,
// ficha, andares e filtros continuar valendo sem reescrever.
//
// Decisoes:
// - So a primeira vista carrega com a pagina; as outras 23 vem depois da
//   primeira interacao, na resolucao que a tela pede. A home tem teto de peso.
// - Girar funde a vista atual com a vizinha pela fracao do arraste, em vez
//   de pular de foto em foto: com 15 graus entre vistas o salto aparece.
// - Canvas 2D, sem WebGL: roda em qualquer celular e nao precisa de biblioteca.
// - touch-action pan-y: arraste horizontal gira, vertical continua rolando.
import { horasDeSol } from './sol.js';

const FRASES = (() => {
  try { return JSON.parse(document.getElementById('i18n').textContent); }
  catch (e) { return {}; }
})();
const fr = (chave, reserva) => FRASES[chave] || reserva;
const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const PX_POR_VISTA = 34;     // arraste horizontal que passa uma vista
const ZOOM_QUARTO = 1.6;
const DUR = 700;

function dentro(p, q) {
  // ponto dentro do quadrilatero convexo (cantos em ordem)
  let sinal = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c !== 0) {
      if (sinal === 0) sinal = Math.sign(c);
      else if (Math.sign(c) !== sinal) return false;
    }
  }
  return true;
}

export async function montarPredio({ canvas, tooltip, onSelecionar, onQuadro, onModo }) {
  const base = new URL('../', import.meta.url);
  const [hotel, giro] = await Promise.all([
    fetch(new URL('data/hotel.json', base)).then((r) => r.json()),
    fetch(new URL('data/fachada.json', base)).then((r) => r.json()),
  ]);
  const N = giro.vistas.length;
  const porNumero = new Map();
  hotel.andares.forEach((a) => a.quartos.forEach((q) => porNumero.set(q.numero, q)));

  // melhor vista de cada janela: a que a ve mais de frente
  const melhor = new Map();
  giro.vistas.forEach((v, k) => {
    Object.entries(v.janelas).forEach(([num, j]) => {
      const atual = melhor.get(+num);
      if (!atual || j.f > atual.f) melhor.set(+num, { k, f: j.f });
    });
  });

  const ctx = canvas.getContext('2d');
  const imgs = new Array(N).fill(null);
  let todasPedidas = false;
  const versao = () => ((canvas.clientWidth * (devicePixelRatio || 1)) > 1100 ? '' : '-m');

  function carregar(k) {
    if (imgs[k]) return imgs[k].pronta;
    const im = new Image();
    im.decoding = 'async';
    const pronta = new Promise((ok, falha) => {
      im.onload = () => { invalidar(); ok(im); };
      im.onerror = falha;
    });
    im.src = new URL(giro.vistas[k].img.replace('.jpg', `${versao()}.jpg`), base).href;
    imgs[k] = { im, pronta };
    return pronta;
  }
  function pedirTodas() {
    if (todasPedidas) return;
    todasPedidas = true;
    // a partir da vista atual, alternando para os dois lados: o que o
    // visitante vai ver primeiro chega primeiro
    for (let d = 1; d <= N / 2; d += 1) {
      carregar((vista + d) % N);
      carregar((vista - d + N) % N);
    }
  }
  const pronta = (k) => imgs[k] && imgs[k].im.complete && imgs[k].im.naturalWidth > 0;

  // ---------------------------------------------------------------- estado
  let vista = 0;            // posicao continua do giro, em vistas
  let zoom = 1;
  let foco = null;          // centro do zoom, em coordenadas da imagem (0..1)
  let selecionado = null;
  let sobre = null;
  let filtro = null;
  let modo = 'geral';
  let precisa = true;
  const anims = new Map();

  function invalidar() { precisa = true; }

  function animar(chave, de, para, dur, aplicar, fim) {
    if (semMovimento()) { aplicar(para); if (fim) fim(); invalidar(); return; }
    anims.set(chave, { de, para, dur, t0: performance.now(), aplicar, fim });
    invalidar();
  }

  // ------------------------------------------------------------- geometria
  function medida() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  }

  // imagem (0..1) -> tela (px css), com cover e zoom no foco
  function transformacao(w, h) {
    const iw = giro.largura;
    const ih = giro.altura;
    const s = Math.max(w / iw, h / ih) * zoom;
    const fx = foco ? foco[0] : 0.5;
    const fy = foco ? foco[1] : 0.5;
    // no zoom o foco vai para 40% da largura, deixando lugar para a ficha
    // no computador a ficha fica a direita da janela; no celular ela e uma
    // gaveta no pe da tela, entao a janela sobe para o terco de cima
    const celular = w < 896;
    const perto = foco && zoom > 1.05;
    const alvoX = perto && !celular ? w * 0.4 : w / 2;
    const alvoY = perto && celular ? h * 0.26 : h / 2;
    const tx = alvoX - fx * iw * s;
    const ty = alvoY - fy * ih * s;
    return { s, tx, ty, iw, ih };
  }
  const paraTela = (T, p) => [p[0] * T.iw * T.s + T.tx, p[1] * T.ih * T.s + T.ty];

  function vistaInteira() { return ((Math.round(vista) % N) + N) % N; }

  // -------------------------------------------------------------- desenho
  function desenhar() {
    const { w, h, dpr } = medida();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#12131a';
    ctx.fillRect(0, 0, w, h);
    const T = transformacao(w, h);
    const k0 = ((Math.floor(vista) % N) + N) % N;
    const k1 = (k0 + 1) % N;
    const t = vista - Math.floor(vista);
    const dw = T.iw * T.s;
    const dh = T.ih * T.s;
    if (pronta(k0)) ctx.drawImage(imgs[k0].im, T.tx, T.ty, dw, dh);
    else if (pronta(k1)) ctx.drawImage(imgs[k1].im, T.tx, T.ty, dw, dh);
    if (t > 0.001 && pronta(k1) && pronta(k0)) {
      ctx.globalAlpha = t;
      ctx.drawImage(imgs[k1].im, T.tx, T.ty, dw, dh);
      ctx.globalAlpha = 1;
    }
    // janelas so com o giro parado: no meio da fusao elas nao estao em lugar nenhum
    if (Math.abs(vista - Math.round(vista)) > 0.02) return;
    const jan = giro.vistas[vistaInteira()].janelas;
    const caminho = (q) => {
      ctx.beginPath();
      q.forEach((p, i) => {
        const [x, y] = paraTela(T, p);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    };
    if (filtro || selecionado) {
      Object.entries(jan).forEach(([num, j]) => {
        const q = porNumero.get(+num);
        const bate = selecionado ? +num === selecionado : filtro(q);
        if (bate) return;
        caminho(j.q);
        ctx.fillStyle = 'rgba(10, 11, 16, 0.62)';
        ctx.fill();
      });
    }
    Object.entries(jan).forEach(([num, j]) => {
      const n = +num;
      const q = porNumero.get(n);
      let cor = null;
      let largura = 2;
      if (n === selecionado) { cor = '#f0c489'; largura = 3; }
      else if (n === sobre) cor = '#fff3dc';
      else if (filtro && filtro(q)) { cor = 'rgba(240, 196, 137, 0.85)'; largura = 1.5; }
      if (!cor) return;
      caminho(j.q);
      ctx.lineWidth = largura;
      ctx.strokeStyle = cor;
      ctx.shadowColor = cor;
      ctx.shadowBlur = n === selecionado ? 16 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }

  function avisarQuadro() {
    if (!onQuadro) return;
    if (!selecionado || modo !== 'quarto') { onQuadro(null); return; }
    const j = giro.vistas[vistaInteira()].janelas[selecionado];
    if (!j) { onQuadro(null); return; }
    const { w, h } = medida();
    const T = transformacao(w, h);
    const c = j.q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const [x, y] = paraTela(T, c);
    onQuadro({ x, y, largura: w, altura: h, frente: true, modo: 'quarto' });
  }

  function tick(agora) {
    anims.forEach((a, chave) => {
      const u = Math.min(1, (agora - a.t0) / a.dur);
      a.aplicar(a.de + (a.para - a.de) * suave(u));
      if (u >= 1) { anims.delete(chave); if (a.fim) a.fim(); }
      precisa = true;
    });
    if (precisa) {
      precisa = false;
      desenhar();
      avisarQuadro();
    }
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------- acoes
  function irPara(k, depois) {
    // menor caminho: de 23 para 0 e um passo, nao 23
    let alvo = k;
    while (alvo - vista > N / 2) alvo -= N;
    while (vista - alvo > N / 2) alvo += N;
    const dur = Math.min(1400, 160 + Math.abs(alvo - vista) * 90);
    animar('vista', vista, alvo, dur, (v) => { vista = v; }, () => {
      vista = ((Math.round(vista) % N) + N) % N;
      if (depois) depois();
    });
  }

  function selecionar(numero, opcoes = {}) {
    const q = porNumero.get(numero);
    if (!q) return;
    pedirTodas();
    selecionado = numero;
    modo = 'quarto';
    const tipo = hotel.tipos[q.tipo];
    if (onSelecionar) onSelecionar(q, tipo);
    if (onModo) onModo('quarto', q);
    const m = melhor.get(numero);
    const k = m ? m.k : vistaInteira();
    const aproximar = () => {
      const j = giro.vistas[vistaInteira()].janelas[numero];
      if (!j) { invalidar(); return; }
      const c = j.q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
      const de = foco || c;
      animar('foco', 0, 1, DUR, (u) => {
        foco = [de[0] + (c[0] - de[0]) * u, de[1] + (c[1] - de[1]) * u];
      });
      animar('zoom', zoom, ZOOM_QUARTO, DUR, (z) => { zoom = z; });
    };
    if (Math.round(vista) % N === k && Math.abs(vista - Math.round(vista)) < 0.02) aproximar();
    else {
      // afasta, gira e aproxima: girar com zoom tira a janela da tela
      animar('zoom', zoom, 1, DUR * 0.6, (z) => { zoom = z; });
      carregar(k).then(() => irPara(k, aproximar));
    }
    if (!opcoes.silencioso) invalidar();
  }

  function verGeral() {
    selecionado = null;
    modo = 'geral';
    animar('zoom', zoom, 1, DUR, (z) => { zoom = z; }, () => { foco = null; });
    if (onModo) onModo('geral');
    invalidar();
  }

  function aplicarFiltro(fn) {
    filtro = fn;
    // so filtro de verdade: a interface chama com null ao montar, e isso nao
    // pode baixar as 24 vistas de quem nem tocou no predio
    if (fn) {
      pedirTodas();
      // Se nenhum quarto que atende aparece nesta vista, o predio gira sozinho
      // para a vista que mostra mais deles: "18 quartos atendem" com nenhuma
      // janela marcada deixava o visitante sem saber para onde olhar.
      const conta = (k) => Object.keys(giro.vistas[k].janelas).filter((n) => fn(porNumero.get(+n))).length;
      if (conta(vistaInteira()) === 0) {
        let alvo = -1;
        let max = 0;
        for (let k = 0; k < N; k += 1) {
          const c = conta(k);
          if (c > max) { max = c; alvo = k; }
        }
        if (alvo >= 0) {
          if (modo === 'quarto') verGeral();
          carregar(alvo).then(() => irPara(alvo));
        }
      }
    }
    invalidar();
  }

  function girar(passos) {
    pedirTodas();
    if (modo === 'quarto') verGeral();
    irPara(Math.round(vista) + passos);
  }

  function toqueDoPredio(ligado) {
    canvas.style.touchAction = ligado ? 'none' : 'pan-y';
  }

  // -------------------------------------------------------- ponteiro
  function janelaEm(ev, tolerancia) {
    if (Math.abs(vista - Math.round(vista)) > 0.02) return null;
    const r = canvas.getBoundingClientRect();
    const { w, h } = medida();
    const T = transformacao(w, h);
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const ip = [(px - T.tx) / (T.iw * T.s), (py - T.ty) / (T.ih * T.s)];
    const jan = giro.vistas[vistaInteira()].janelas;
    let perto = null;
    let menor = tolerancia;
    for (const [num, j] of Object.entries(jan)) {
      if (dentro(ip, j.q)) return +num;
      const c = j.q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
      const [cx, cy] = paraTela(T, c);
      const d = Math.hypot(cx - px, cy - py);
      if (d < menor) { menor = d; perto = +num; }
    }
    return perto;
  }

  let arrasto = null;
  canvas.addEventListener('pointerdown', (ev) => {
    pedirTodas();
    arrasto = { x: ev.clientX, y: ev.clientY, v: vista, girando: false, id: ev.pointerId };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (arrasto && arrasto.id === ev.pointerId) {
      const dx = ev.clientX - arrasto.x;
      const dy = ev.clientY - arrasto.y;
      if (!arrasto.girando && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        arrasto.girando = true;
        canvas.setPointerCapture(ev.pointerId);
        anims.delete('vista');
        if (modo === 'quarto') verGeral();
        canvas.dispatchEvent(new CustomEvent('fachada:girou'));
      }
      if (arrasto.girando) {
        vista = arrasto.v - dx / PX_POR_VISTA;
        invalidar();
      }
      return;
    }
    if (ev.pointerType !== 'mouse') return;
    const n = janelaEm(ev, 0);
    if (n !== sobre) {
      sobre = n;
      canvas.style.cursor = n ? 'pointer' : 'grab';
      invalidar();
    }
    if (tooltip) {
      if (!n) { tooltip.hidden = true; return; }
      const q = porNumero.get(n);
      const tipo = hotel.tipos[q.tipo];
      const nomeTipo = (FRASES.tipos && FRASES.tipos[q.tipo]) || tipo.nome;
      const disp = q.status === 'disponivel';
      tooltip.innerHTML = `<strong>${fr('quarto', 'Quarto')} ${n}</strong><span>${nomeTipo} · R$ ${q.precoBase}</span>`
        + `<span>${disp ? fr('disponivel', 'Disponível') : fr('indisponivel', 'Indisponível nas datas')}</span>`;
      const r = canvas.getBoundingClientRect();
      tooltip.style.left = `${ev.clientX - r.left}px`;
      tooltip.style.top = `${ev.clientY - r.top}px`;
      tooltip.hidden = false;
    }
  });
  const soltar = (ev) => {
    if (!arrasto || arrasto.id !== ev.pointerId) return;
    const girou = arrasto.girando;
    arrasto = null;
    if (girou) {
      irPara(Math.round(vista));
      return;
    }
    const n = janelaEm(ev, ev.pointerType === 'mouse' ? 0 : 26);
    if (n) selecionar(n);
    else if (modo === 'quarto') verGeral();
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', () => { arrasto = null; irPara(Math.round(vista)); });
  canvas.addEventListener('pointerleave', () => {
    if (tooltip) tooltip.hidden = true;
    if (sobre) { sobre = null; invalidar(); }
  });
  new ResizeObserver(invalidar).observe(canvas);
  toqueDoPredio(false);
  canvas.style.cursor = 'grab';

  await carregar(0);
  requestAnimationFrame(tick);

  // sol direto por fachada: frente (F) olha para a rua, laterais E e D
  const giroRad = (hotel.rotacaoGraus * Math.PI) / 180;
  const DATA = new Date();
  const normal = {
    F: { x: Math.sin(giroRad), z: Math.cos(giroRad) },
    E: { x: -Math.cos(giroRad), z: Math.sin(giroRad) },
    D: { x: Math.cos(giroRad), z: -Math.sin(giroRad) },
  };
  const SOL = {};
  Object.keys(normal).forEach((f) => { SOL[f] = horasDeSol(hotel.lat, hotel.lng, DATA, -3, normal[f]); });

  return {
    hotel, selecionar, verGeral, aplicarFiltro, toqueDoPredio, girar, invalidar,
    solDaFachada: (f) => SOL[f], modo: () => modo,
  };
}
