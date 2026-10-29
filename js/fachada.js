// Predio do hotel para escolher o quarto, em fotos renderizadas no Blender.
//
// O predio e o real, modelado a partir das fotos e renderizado no Cycles em
// 96 vistas em volta dele (blender/fachada_m.py), uma a cada 3,75 graus. Cada
// vista traz os quatro cantos de cada janela de quarto projetados na imagem:
// girar e trocar de foto, clicar e testar o ponto contra a janela.
//
// A API e a da v1 (hotel, selecionar, verGeral, aplicarFiltro, toqueDoPredio,
// solDaFachada), mais girar, para a interface continuar a mesma.
//
// Fluidez, que e o que o visitante sente:
// - Em movimento desenha a imagem leve da vista (-m no computador, -s no
//   celular) fundida com a vizinha pela fracao exata do giro; parado, troca
//   pela nitida. 96 leves pesam menos que 24 nitidas e o giro anda a 60 fps.
// - Soltar o arraste nao para seco: o predio segue com a velocidade da mao e
//   desacelera, como um objeto de verdade, e so entao encaixa na vista.
// - Escolher um quarto percorre as vistas intermediarias com aceleracao e
//   desaceleracao, como uma camera dando a volta, e aproxima no fim.
// - So a primeira vista carrega com a pagina; o resto, na primeira interacao.
import { horasDeSol } from './sol.js';

const FRASES = (() => {
  try { return JSON.parse(document.getElementById('i18n').textContent); }
  catch (e) { return {}; }
})();
const fr = (chave, reserva) => FRASES[chave] || reserva;
const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const suave = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const ZOOM_QUARTO = 1.55;
const DUR = 650;
const ATRITO = 0.92;            // por quadro de 60 Hz, na inercia do giro

function dentro(p, q) {
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
const centro = (q) => q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);

export async function montarPredio({ canvas, tooltip, onSelecionar, onQuadro, onModo }) {
  const base = new URL('../', import.meta.url);
  const [hotel, giro] = await Promise.all([
    fetch(new URL('data/hotel.json', base)).then((r) => r.json()),
    fetch(new URL('data/fachada.json', base)).then((r) => r.json()),
  ]);
  const N = giro.vistas.length;
  const PX_POR_VISTA = Math.max(6, 900 / N);   // uma volta inteira em ~900 px de arraste
  const porNumero = new Map();
  hotel.andares.forEach((a) => a.quartos.forEach((q) => porNumero.set(q.numero, q)));

  const melhor = new Map();
  giro.vistas.forEach((v, k) => {
    Object.entries(v.janelas).forEach(([num, j]) => {
      const atual = melhor.get(+num);
      if (!atual || j.f > atual.f) melhor.set(+num, { k, f: j.f });
    });
  });

  const ctx = canvas.getContext('2d');
  const celular = () => canvas.clientWidth < 720;
  // duas camadas de imagem por vista: leve (movimento) e nitida (parado)
  const leve = new Array(N).fill(null);
  const nitida = new Array(N).fill(null);
  const sufixo = (camada) => {
    if (camada === 'leve') return celular() ? '-s' : '-m';
    const px = canvas.clientWidth * Math.min(devicePixelRatio || 1, 2);
    return px > 1100 ? '' : '-m';
  };
  function carregar(camada, k) {
    const lista = camada === 'leve' ? leve : nitida;
    if (lista[k]) return lista[k].pronta;
    const im = new Image();
    im.decoding = 'async';
    const pronta = new Promise((ok) => {
      im.onload = () => { invalidar(); ok(im); };
      im.onerror = () => ok(null);
    });
    im.src = new URL(giro.vistas[k].img.replace('.jpg', `${sufixo(camada)}.jpg`), base).href;
    lista[k] = { im, pronta };
    return pronta;
  }
  const ok = (lista, k) => lista[k] && lista[k].im.complete && lista[k].im.naturalWidth > 0;
  let todasPedidas = false;
  function pedirTodas() {
    if (todasPedidas) return;
    todasPedidas = true;
    const k0 = idx(vista);
    for (let d = 1; d <= N / 2; d += 1) {
      carregar('leve', (k0 + d) % N);
      carregar('leve', (k0 - d + N) % N);
    }
  }

  // ---------------------------------------------------------------- estado
  let vista = 0;
  let velocidade = 0;       // vistas por quadro, na inercia
  let zoom = 1;
  let foco = null;
  let selecionado = null;
  let sobre = null;
  let andarRealce = null;   // andar aceso pelo hover da janela ou pela regua
  let onAndar = null;
  let filtro = null;
  let modo = 'geral';
  let precisa = true;
  let movendo = false;
  let arrasto = null;
  const anims = new Map();
  const idx = (v) => ((Math.round(v) % N) + N) % N;
  function invalidar() { precisa = true; }

  function animar(chave, de, para, dur, aplicar, fim) {
    if (semMovimento()) { aplicar(para); if (fim) fim(); invalidar(); return; }
    anims.set(chave, { de, para, dur, t0: performance.now(), aplicar, fim });
    invalidar();
  }

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

  function transformacao(w, h) {
    const iw = giro.largura;
    const ih = giro.altura;
    const s = Math.max(w / iw, h / ih) * zoom;
    const f = foco || [0.5, 0.5];
    // o foco vai para o centro do palco conforme o zoom cresce
    const u = Math.min(1, Math.max(0, (zoom - 1) / (ZOOM_QUARTO - 1)));
    const fx = 0.5 + (f[0] - 0.5) * u;
    const fy = 0.5 + (f[1] - 0.5) * u;
    // no celular a ficha e uma gaveta no pe da tela: a janela sobe para o
    // terco de cima do palco, para as duas aparecerem juntas
    const alvoY = celular() ? h / 2 + (h * 0.28 - h / 2) * u : h / 2;
    // no computador a ficha e um cartao a esquerda do palco: a janela vai
    // para a direita dele
    const alvoX = celular() ? w / 2 : w / 2 + (w * 0.66 - w / 2) * u;
    return { s, tx: alvoX - fx * iw * s, ty: alvoY - fy * ih * s, iw, ih };
  }
  const paraTela = (T, p) => [p[0] * T.iw * T.s + T.tx, p[1] * T.ih * T.s + T.ty];

  // imagem para a vista k: nitida se estiver parado e ela existir, senao leve
  function imagem(k, parado) {
    if (parado && ok(nitida, k)) return nitida[k].im;
    if (ok(leve, k)) return leve[k].im;
    if (ok(nitida, k)) return nitida[k].im;
    // rede lenta: enquanto a vista nao chega, a mais proxima ja carregada,
    // em vez do palco vazio
    for (let d = 1; d <= N / 2; d += 1) {
      for (const j of [(k + d) % N, (k - d + N) % N]) {
        if (ok(leve, j)) return leve[j].im;
        if (ok(nitida, j)) return nitida[j].im;
      }
    }
    return null;
  }

  // -------------------------------------------------------------- desenho
  function desenhar() {
    const { w, h, dpr } = medida();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = transformacao(w, h);
    const dw = T.iw * T.s;
    const dh = T.ih * T.s;
    const k0 = ((Math.floor(vista) % N) + N) % N;
    const k1 = (k0 + 1) % N;
    const t = vista - Math.floor(vista);
    const parado = !movendo && t < 0.001;
    const a = imagem(k0, parado);
    const b = t > 0.001 ? imagem(k1, false) : null;
    if (a) ctx.drawImage(a, T.tx, T.ty, dw, dh);
    else if (b) ctx.drawImage(b, T.tx, T.ty, dw, dh);
    else { ctx.fillStyle = '#080c1a'; ctx.fillRect(0, 0, w, h); }
    if (a && b) {
      ctx.globalAlpha = t;
      ctx.drawImage(b, T.tx, T.ty, dw, dh);
      ctx.globalAlpha = 1;
    }
    if (!parado) return;
    if (!ok(nitida, k0)) carregar('nitida', k0);
    const jan = giro.vistas[k0].janelas;
    const caminho = (q) => {
      ctx.beginPath();
      q.forEach((p, i) => {
        const [x, y] = paraTela(T, p);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    };
    // andar em realce: as janelas do andar ganham contorno e o resto do
    // predio escurece um pouco, como nos seletores de unidade das construtoras
    if (andarRealce && !selecionado) {
      Object.entries(jan).forEach(([num, j]) => {
        if (Math.floor(+num / 100) === andarRealce) return;
        caminho(j.q);
        ctx.fillStyle = 'rgba(8, 12, 26, 0.45)';
        ctx.fill();
      });
      Object.entries(jan).forEach(([num, j]) => {
        if (Math.floor(+num / 100) !== andarRealce) return;
        caminho(j.q);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(240, 196, 137, 0.95)';
        ctx.stroke();
      });
    }
    if (filtro || selecionado) {
      Object.entries(jan).forEach(([num, j]) => {
        const bate = selecionado ? +num === selecionado : filtro(porNumero.get(+num));
        if (bate) return;
        caminho(j.q);
        ctx.fillStyle = 'rgba(8, 12, 26, 0.6)';
        ctx.fill();
      });
    }
    Object.entries(jan).forEach(([num, j]) => {
      const n = +num;
      let cor = null;
      let largura = 2;
      if (n === selecionado) { cor = '#f0c489'; largura = 3; }
      else if (n === sobre) cor = '#fff3dc';
      else if (filtro && filtro(porNumero.get(n))) { cor = 'rgba(240, 196, 137, 0.9)'; largura = 1.5; }
      if (!cor) return;
      caminho(j.q);
      ctx.lineWidth = largura;
      ctx.strokeStyle = cor;
      ctx.shadowColor = cor;
      ctx.shadowBlur = n === selecionado ? 18 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }

  function tick(agora) {
    anims.forEach((an, chave) => {
      const u = Math.min(1, (agora - an.t0) / an.dur);
      an.aplicar(an.de + (an.para - an.de) * suave(u));
      if (u >= 1) { anims.delete(chave); if (an.fim) an.fim(); }
      precisa = true;
    });
    // inercia do giro depois de soltar o arraste
    if (velocidade !== 0 && !arrasto) {
      vista += velocidade;
      velocidade *= ATRITO;
      if (Math.abs(velocidade) < 0.012) {
        velocidade = 0;
        encaixar();
      }
      precisa = true;
    }
    // dedo encostado sem girar ainda e um toque, nao movimento
    movendo = (!!arrasto && arrasto.girando) || velocidade !== 0 || anims.has('vista');
    if (precisa) {
      precisa = false;
      desenhar();
      if (onQuadro) onQuadro(null);
    }
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------- acoes
  function irPara(k, depois, durMax = 1500) {
    let alvo = k;
    while (alvo - vista > N / 2) alvo -= N;
    while (vista - alvo > N / 2) alvo += N;
    const passos = Math.abs(alvo - vista);
    const dur = Math.min(durMax, 220 + passos * 22);
    animar('vista', vista, alvo, dur, (v) => { vista = v; }, () => {
      vista = idx(vista);
      if (depois) depois();
    });
  }
  function encaixar() { irPara(Math.round(vista), null, 400); }

  function selecionar(numero) {
    const q = porNumero.get(numero);
    if (!q) return;
    pedirTodas();
    selecionado = numero;
    modo = 'quarto';
    if (onSelecionar) onSelecionar(q, hotel.tipos[q.tipo]);
    if (onModo) onModo('quarto', q);
    const m = melhor.get(numero);
    const k = m ? m.k : idx(vista);
    carregar('nitida', k);
    const aproximar = () => {
      const j = giro.vistas[idx(vista)].janelas[numero];
      if (!j) { invalidar(); return; }
      foco = centro(j.q);
      animar('zoom', zoom, ZOOM_QUARTO, DUR, (z) => { zoom = z; });
    };
    if (idx(vista) === k && Math.abs(vista - Math.round(vista)) < 0.01) {
      aproximar();
    } else {
      // afasta, da a volta ate a vista do quarto e aproxima
      animar('zoom', zoom, 1, DUR * 0.5, (z) => { zoom = z; });
      carregar('leve', k).then(() => irPara(k, aproximar));
    }
    invalidar();
  }

  function verGeral() {
    selecionado = null;
    modo = 'geral';
    animar('zoom', zoom, 1, DUR, (z) => { zoom = z; });
    if (onModo) onModo('geral');
    invalidar();
  }

  function aplicarFiltro(fn) {
    filtro = fn;
    if (fn) {
      pedirTodas();
      // quarto que atende do outro lado do predio: gira ate a vista com mais deles
      const conta = (k) => Object.keys(giro.vistas[k].janelas).filter((n) => fn(porNumero.get(+n))).length;
      if (conta(idx(vista)) === 0) {
        let alvo = -1;
        let max = 0;
        for (let k = 0; k < N; k += 1) {
          const c = conta(k);
          if (c > max) { max = c; alvo = k; }
        }
        if (alvo >= 0) {
          if (modo === 'quarto') verGeral();
          irPara(alvo);
        }
      }
    }
    invalidar();
  }

  function girar(sentido) {
    pedirTodas();
    if (modo === 'quarto') verGeral();
    // um toque no botao gira 30 graus, com o mesmo movimento da camera
    irPara(Math.round(vista) + sentido * Math.round(N / 12), null, 700);
  }

  function resumoAndar(andar) {
    const qs = hotel.andares.find((a) => a.numero === andar).quartos;
    const livres = qs.filter((q) => q.status === 'disponivel');
    const min = livres.length ? Math.min(...livres.map((q) => q.precoBase)) : null;
    return { andar, livres: livres.length, total: qs.length, min };
  }

  function realcarAndar(andar) {
    if (andar === andarRealce) return;
    andarRealce = andar;
    if (onAndar) onAndar(andar);
    invalidar();
  }

  // gira ate a vista que mostra mais janelas do andar e o realca
  function verAndar(andar) {
    pedirTodas();
    if (modo === 'quarto') verGeral();
    const conta = (k) => Object.keys(giro.vistas[k].janelas).filter((n) => Math.floor(+n / 100) === andar).length;
    if (conta(idx(vista)) < 3) {
      let alvo = idx(vista);
      let max = conta(alvo);
      for (let k = 0; k < N; k += 1) { const c = conta(k); if (c > max) { max = c; alvo = k; } }
      irPara(alvo);
    }
    realcarAndar(andar);
  }

  function toqueDoPredio(ligado) {
    canvas.style.touchAction = ligado ? 'none' : 'pan-y';
  }

  // -------------------------------------------------------- ponteiro
  function janelaEm(ev, tolerancia) {
    if (movendo || Math.abs(vista - Math.round(vista)) > 0.01) return null;
    const r = canvas.getBoundingClientRect();
    const { w, h } = medida();
    const T = transformacao(w, h);
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const ip = [(px - T.tx) / (T.iw * T.s), (py - T.ty) / (T.ih * T.s)];
    const jan = giro.vistas[idx(vista)].janelas;
    let perto = null;
    let menor = tolerancia;
    for (const [num, j] of Object.entries(jan)) {
      if (dentro(ip, j.q)) return +num;
      const [cx, cy] = paraTela(T, centro(j.q));
      const d = Math.hypot(cx - px, cy - py);
      if (d < menor) { menor = d; perto = +num; }
    }
    return perto;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    pedirTodas();
    velocidade = 0;
    anims.delete('vista');
    arrasto = { x: ev.clientX, y: ev.clientY, v: vista, girando: false, id: ev.pointerId,
                ultX: ev.clientX, ultT: performance.now(), vel: 0 };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (arrasto && arrasto.id === ev.pointerId) {
      const dx = ev.clientX - arrasto.x;
      const dy = ev.clientY - arrasto.y;
      if (!arrasto.girando && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        arrasto.girando = true;
        canvas.setPointerCapture(ev.pointerId);
        if (modo === 'quarto') verGeral();
        if (tooltip) tooltip.hidden = true;
        canvas.dispatchEvent(new CustomEvent('fachada:girou'));
      }
      if (arrasto.girando) {
        const agora = performance.now();
        const dt = Math.max(1, agora - arrasto.ultT);
        // velocidade em vistas por quadro de 16 ms, suavizada
        const inst = (-(ev.clientX - arrasto.ultX) / PX_POR_VISTA) * (16 / dt);
        arrasto.vel = arrasto.vel * 0.7 + inst * 0.3;
        arrasto.ultX = ev.clientX;
        arrasto.ultT = agora;
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
      realcarAndar(n ? Math.floor(n / 100) : null);
    }
    if (!tooltip) return;
    if (!n) { tooltip.hidden = true; return; }
    const q = porNumero.get(n);
    const tipo = hotel.tipos[q.tipo];
    const nomeTipo = (FRASES.tipos && FRASES.tipos[q.tipo]) || tipo.nome;
    const disp = q.status === 'disponivel';
    const res = resumoAndar(Math.floor(n / 100));
    tooltip.innerHTML = `<strong>${fr('quarto', 'Quarto')} ${n}</strong><span>${nomeTipo} · R$ ${q.precoBase}</span>`
      + `<span>${disp ? fr('disponivel', 'Disponível') : fr('indisponivel', 'Indisponível nas datas')}</span>`
      + `<span class="tip__andar">${fr('resumoAndar', 'Andar {a}: {n} livres, a partir de R$ {p}')
        .replace('{a}', res.andar).replace('{n}', res.livres).replace('{p}', res.min)}</span>`;
    const r = canvas.getBoundingClientRect();
    tooltip.style.left = `${ev.clientX - r.left}px`;
    tooltip.style.top = `${ev.clientY - r.top}px`;
    tooltip.hidden = false;
  });
  const soltar = (ev) => {
    if (!arrasto || arrasto.id !== ev.pointerId) return;
    const { girando } = arrasto;
    const vel = arrasto.vel;
    arrasto = null;
    if (girando) {
      // a mao solta o predio com a velocidade que tinha; o atrito para
      if (Math.abs(vel) > 0.05 && !semMovimento()) velocidade = Math.max(-1.2, Math.min(1.2, vel));
      else encaixar();
      return;
    }
    const n = janelaEm(ev, ev.pointerType === 'mouse' ? 0 : 26);
    if (n) selecionar(n);
    else if (modo === 'quarto') verGeral();
  };
  canvas.addEventListener('pointerup', soltar);
  canvas.addEventListener('pointercancel', () => { arrasto = null; encaixar(); });
  canvas.addEventListener('pointerleave', () => {
    if (tooltip) tooltip.hidden = true;
    if (sobre) { sobre = null; realcarAndar(null); invalidar(); }
  });
  new ResizeObserver(invalidar).observe(canvas);
  toqueDoPredio(false);
  canvas.style.cursor = 'grab';

  await carregar('nitida', 0);
  requestAnimationFrame(tick);

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
    resumoAndar, realcarAndar, verAndar, aoRealcarAndar: (fn) => { onAndar = fn; },
    solDaFachada: (f) => SOL[f], modo: () => modo,
  };
}
