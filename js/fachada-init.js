// Liga o predio renderizado (js/fachada.js) a interface HTML: chips de tipo,
// ficha do quarto com troca de andar, filtros e anuncios para leitor de tela.
// E a interface da v1, sobre o motor novo. Progressivo: sem este modulo os
// chips sao links para a pagina de cada tipo e os cartoes abaixo listam tudo.
import { montarPredio } from './fachada.js';

const FRASES = (() => {
  try { return JSON.parse(document.getElementById('i18n').textContent); }
  catch (e) { return {}; }
})();
const fr = (chave, reserva) => FRASES[chave] || reserva;
const nomeTipo = (chave, tipo) => (FRASES.tipos && FRASES.tipos[chave]) || tipo.nome;

const root = document.querySelector('[data-predio]');
if (root) {
  const canvas = root.querySelector('[data-predio-canvas]');
  const tooltip = root.querySelector('[data-predio-tooltip]');
  const ficha = root.querySelector('[data-predio-ficha]');
  const aviso = root.querySelector('[data-predio-aviso]');
  const status = root.querySelector('[data-predio-status]');
  const dica = root.querySelector('[data-predio-dica]');
  let api = null;
  let quartoAtual = null;
  let abriu = null;      // elemento que abriu a ficha, para o foco voltar a ele

  const anunciar = (texto) => { if (status) status.textContent = texto; };

  // Fileira de andares da ficha: mesma posicao, outro andar. Andar em que essa
  // posicao nao existe (o 10o tem menos quartos) fica desabilitado.
  const linhaAndares = (numero) => {
    if (!api) return '';
    const atual = Math.floor(numero / 100);
    const pos = numero % 100;
    const livres = new Set(api.hotel.andares.flatMap((a) => a.quartos)
      .filter((q) => q.status === 'disponivel').map((q) => q.numero));
    const botoes = api.hotel.andares.map((a) => {
      const aqui = a.numero === atual;
      const tem = aqui || livres.has(a.numero * 100 + pos);
      return `<button type="button" data-andar="${a.numero}"${aqui ? ' aria-current="true"' : ''}${tem ? '' : ' disabled'}>`
        + `<span class="visually-hidden">${fr('andar', 'Andar')} </span>${a.numero}</button>`;
    }).join('');
    return `<div class="ficha__andares"><span class="ficha__rotulo" id="ficha-andares">${fr('trocarAndar', 'Trocar de andar')}</span>`
      + `<div role="group" aria-labelledby="ficha-andares">${botoes}</div></div>`;
  };

  // Vista da janela na ficha: desligada a pedido do cliente (29/10, "fica
  // estranho no celular por enquanto"). As imagens continuam em assets/janela.
  const VISTA_NA_FICHA = false;
  // Vista da janela por fachada e faixa de andar (blender/fachada_m.py).
  const vistaDaJanela = (q) => {
    const andar = Math.floor(q.numero / 100);
    const faixa = andar <= 3 ? 'baixo' : andar <= 7 ? 'meio' : 'alto';
    return new URL(`../assets/janela/${q.fachada}-${faixa}.jpg`, import.meta.url).href;
  };

  // De onde vem a diaria: base do tipo, andar e vista. Mostrar o atributo com
  // preco e o que faz o hospede pagar por andar alto e vista mar.
  const composicao = (q, tipo) => {
    const p = api.hotel.precos || { porAndar: 0, vistaMar: 0 };
    const andar = Math.floor(q.numero / 100);
    const linhas = [[fr('baseTipo', 'Base do {tipo}').replace('{tipo}', nomeTipo(q.tipo, tipo)), tipo.base]];
    if (andar > 1 && p.porAndar) linhas.push([fr('andarAlto', 'Andar {a}').replace('{a}', andar), p.porAndar * (andar - 1)]);
    if (q.vista === 'mar' && p.vistaMar) linhas.push([fr('vistaMarMais', 'Vista mar'), p.vistaMar]);
    if (linhas.length < 2) return '';
    return `<details class="ficha__preco"><summary>${fr('comoPreco', 'Como chegamos nesta diária')}</summary><dl>`
      + linhas.map(([n, v], i) => `<div><dt>${n}</dt><dd>${i ? '+ ' : ''}R$ ${v}</dd></div>`).join('')
      + '</dl></details>';
  };

  const whatsapp = (q, tipo) => {
    const base = root.dataset.whatsapp || 'https://wa.me/';
    const msg = fr('msgReserva', 'Olá! Quero reservar o quarto {n} ({tipo}), andar {a}, vista {v}, diária de R$ {p}.')
      .replace('{n}', q.numero).replace('{tipo}', nomeTipo(q.tipo, tipo)).replace('{a}', Math.floor(q.numero / 100))
      .replace('{v}', fr(q.vista === 'mar' ? 'vistaMar' : 'vistaCidade', q.vista)).replace('{p}', q.precoBase);
    return `${base}?text=${encodeURIComponent(msg)}`;
  };

  // Regua de andares ao lado do predio: livres e menor diaria de cada andar.
  // Passar o mouse acende o andar no predio; clicar gira ate ele e filtra.
  function ligarRegua() {
    const regua = root.querySelector('[data-regua]');
    if (!regua) return;
    const itens = api.hotel.andares.slice().reverse().map((a) => {
      const r = api.resumoAndar(a.numero);
      return `<li><button type="button" class="regua__andar" data-andar-regua="${a.numero}" aria-pressed="false">`
        + `<span class="regua__num">${a.numero}</span>`
        + `<span class="regua__info"><span class="regua__livres">${r.livres}/${r.total}</span>`
        + `<span class="regua__preco">${r.min ? `R$ ${r.min}` : '—'}</span></span></button></li>`;
    }).join('');
    regua.innerHTML = itens;
    regua.hidden = false;
    const andarSel = root.querySelector('#f-andar');
    regua.addEventListener('pointerover', (ev) => {
      const b = ev.target.closest('[data-andar-regua]');
      if (b) api.realcarAndar(Number(b.dataset.andarRegua));
    });
    regua.addEventListener('pointerleave', () => api.realcarAndar(null));
    regua.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-andar-regua]');
      if (!b) return;
      const n = b.dataset.andarRegua;
      const ativo = andarSel.value === n;
      andarSel.value = ativo ? '' : n;
      andarSel.dispatchEvent(new Event('input'));
      if (!ativo) api.verAndar(Number(n));
      esconderDica();
      anunciar(fr('andarFiltrado', 'Andar {a} em destaque').replace('{a}', n));
    });
    const marcar = () => regua.querySelectorAll('[data-andar-regua]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.andarRegua === andarSel.value));
    });
    andarSel.addEventListener('input', marcar);
    api.aoRealcarAndar((andar) => regua.querySelectorAll('[data-andar-regua]').forEach((b) => {
      b.classList.toggle('is-hover', Number(b.dataset.andarRegua) === andar);
    }));
  }

  const faixaDeSol = (q) => {
    const f = api && api.solDaFachada(q.fachada);
    if (!f) return fr('semSol', 'Pouco sol direto');
    return fr('faixaSol', 'das {de}h às {ate}h').replace('{de}', f.de).replace('{ate}', f.ate);
  };

  if (ficha) {
    ficha.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-acao], button[data-andar]');
      if (!b || !api || b.disabled) return;
      if (b.dataset.acao === 'geral') { api.verGeral(); return; }
      if (b.dataset.andar && quartoAtual) {
        api.selecionar(Number(b.dataset.andar) * 100 + (quartoAtual % 100));
        // a ficha foi redesenhada: o foco volta ao botao do andar novo
        const novo = ficha.querySelector('button[data-andar][aria-current="true"]');
        if (novo) novo.focus({ preventScroll: true });
      }
    });
  }

  // Giro por botao: alternativa ao arraste (WCAG 2.2, criterio 2.5.7).
  root.querySelectorAll('[data-girar]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!api) return;
      api.girar(Number(b.dataset.girar));
      anunciar(fr(Number(b.dataset.girar) < 0 ? 'girouEsq' : 'girouDir', 'Prédio girado'));
      esconderDica();
    });
  });

  function esconderDica() { if (dica) dica.hidden = true; }

  function ligarBusca() {
    const painel = root.querySelector('[data-busca]');
    if (!painel) return;
    const abrir = painel.querySelector('[data-busca-abrir]');
    const campos = painel.querySelector('#busca-campos');
    const conta = painel.querySelector('[data-busca-conta]');
    const vista = painel.querySelector('#f-vista');
    const andar = painel.querySelector('#f-andar');
    const preco = painel.querySelector('#f-preco');
    const saidaPreco = painel.querySelector('[data-f-preco]');
    const livre = painel.querySelector('#f-livre');
    // Filtros fechados por padrao atras de um unico botao discreto. Fechar o
    // painel devolve tudo ao estado neutro, sem filtro aplicado no predio.
    const botao = abrir || document.createElement('button');
    if (!abrir) {
      botao.type = 'button';
      botao.className = 'busca__abrir';
      botao.setAttribute('data-busca-abrir', '');
      painel.insertBefore(botao, campos);
    }
    botao.textContent = fr('filtrar', 'Filtrar quartos');
    botao.setAttribute('aria-controls', campos.id);
    botao.setAttribute('aria-expanded', 'false');
    campos.hidden = true;
    painel.hidden = false;
    function neutro() {
      vista.value = '';
      preco.value = preco.max;
      saidaPreco.textContent = `R$ ${preco.value}`;
      livre.checked = false;
      andar.value = '';
      andar.dispatchEvent(new Event('input'));
    }
    botao.addEventListener('click', () => {
      const aberto = botao.getAttribute('aria-expanded') === 'true';
      botao.setAttribute('aria-expanded', String(!aberto));
      campos.hidden = aberto;
      if (aberto) neutro();
    });
    const todos = api.hotel.andares.reduce((lista, a) => lista.concat(a.quartos), []);
    function aplicar() {
      const v = vista.value;
      const an = andar.value;
      const teto = Number(preco.value);
      const soLivre = livre.checked;
      const nenhum = !v && !an && teto >= Number(preco.max) && !soLivre;
      const bate = (q) => (!v || q.vista === v)
        && (!an || String(Math.floor(q.numero / 100)) === an)
        && q.precoBase <= teto
        && (!soLivre || q.status === 'disponivel');
      api.aplicarFiltro(nenhum ? null : bate);
      const n = nenhum ? todos.length : todos.filter(bate).length;
      const livres = todos.filter((q) => q.status === 'disponivel' && (nenhum || bate(q))).length;
      conta.textContent = (nenhum ? fr('contaTodos', '{l} de {n} quartos livres hoje')
        : fr('contaFiltro', '{n} quartos atendem, {l} livres')).replace('{n}', n).replace('{l}', livres);
    }
    preco.addEventListener('input', () => { saidaPreco.textContent = `R$ ${preco.value}`; });
    [vista, andar, preco, livre].forEach((el) => el.addEventListener('input', aplicar));
    aplicar();
  }

  function subir() {
    root.setAttribute('data-carregando', 'true');
    return montarPredio({
      canvas,
      tooltip,
      onSelecionar(q, tipo) {
        quartoAtual = q.numero;
        if (ficha && !ficha.contains(document.activeElement) && document.activeElement !== document.body) {
          abriu = document.activeElement;
        }
        esconderDica();
        root.querySelectorAll('[data-room-link]').forEach((el) => {
          const seu = el.dataset.pagina === tipo.pagina;
          el.classList.toggle('is-active', seu);
          if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(seu));
        });
        if (!ficha) return;
        ficha.hidden = false;
        root.setAttribute('data-ficha', 'true');
        // O palco precisa estar inteiro abaixo do cabecalho fixo: e nele que
        // ficam a janela escolhida e a ficha (cartao no computador, gaveta no
        // celular). O scroll-margin do CSS desconta a altura do cabecalho.
        const palco = root.querySelector('.fachada__palco');
        const r = palco.getBoundingClientRect();
        const cab = document.querySelector('.site-header');
        const topoLivre = cab ? cab.getBoundingClientRect().bottom : 0;
        if (r.top < topoLivre || r.top > innerHeight * 0.3) {
          // rolagem explicita: o scrollIntoView com scroll-margin nao rolava
          // neste layout e deixava o "x" da ficha sob o cabecalho
          window.scrollTo({ top: window.scrollY + r.top - topoLivre - 12, behavior: 'smooth' });
        }
        // no celular a gaveta cobre o painel: o foco entra nela, para nada
        // focado ficar escondido embaixo
        if (celular()) ficha.focus({ preventScroll: true });
        const disp = q.status === 'disponivel';
        ficha.innerHTML = `
          <button type="button" class="ficha__fechar" data-acao="geral"><span aria-hidden="true">×</span><span class="visually-hidden">${fr('predioInteiro', 'Ver o prédio inteiro')}</span></button>
          <p class="ficha__num">${fr('quarto', 'Quarto')} ${q.numero}</p>
          <p class="ficha__tipo">${nomeTipo(q.tipo, tipo)}</p>
          ${VISTA_NA_FICHA ? `<figure class="ficha__vista">
            <img src="${vistaDaJanela(q)}" alt="${fr('vistaAlt', 'Vista simulada da janela do quarto {n}').replace('{n}', q.numero)}" width="640" height="360">
            <figcaption>${fr('vistaLegenda', 'Vista da janela, simulada')}</figcaption>
          </figure>` : ''}
          <dl class="ficha__dados">
            <div><dt>${fr('diaria', 'Diária')}</dt><dd>R$ ${q.precoBase}</dd></div>
            <div><dt>${fr('andar', 'Andar')}</dt><dd>${Math.floor(q.numero / 100)}</dd></div>
            <div><dt>${fr('vista', 'Vista')}</dt><dd>${fr(q.vista === 'mar' ? 'vistaMar' : 'vistaCidade', q.vista)}</dd></div>
            <div><dt>${fr('hospedes', 'Hóspedes')}</dt><dd>${tipo.hosp}</dd></div>
            <div><dt>${fr('sol', 'Sol direto')}</dt><dd>${faixaDeSol(q)}</dd></div>
          </dl>
          <p class="ficha__estado" data-disp="${disp}">${disp ? fr('disponivel', 'Disponível') : fr('indisponivel', 'Indisponível nas datas')}</p>
          ${disp ? `<p><a class="btn btn--primary" href="${whatsapp(q, tipo)}" target="_blank" rel="noopener">${fr('reservarEste', 'Reservar o quarto {n} pelo WhatsApp').replace('{n}', q.numero)}</a></p>` : ''}
          ${composicao(q, tipo)}
          ${linhaAndares(q.numero)}
          <p><a class="btn btn--link" href="${tipo.pagina}">${fr('ver', 'Ver o {tipo}').replace('{tipo}', nomeTipo(q.tipo, tipo))}</a></p>`;
        // link proprio do quarto: da para mandar por mensagem e abrir direto nele
        history.replaceState(null, '', `#quarto=${q.numero}`);
      },
      onOcupado(q) {
        anunciar(fr('ocupadoAviso', 'Quarto {n} ocupado. Escolha outro.').replace('{n}', q.numero));
      },
      onModo(modo, q) {
        root.setAttribute('data-modo', modo);
        if (modo === 'geral') {
          root.querySelectorAll('[data-room-link].is-active').forEach((a) => a.classList.remove('is-active'));
          // o foco estava na ficha: volta para quem a abriu, nao para o body
          const focoNaFicha = ficha && ficha.contains(document.activeElement);
          if (ficha) ficha.hidden = true;
          if (focoNaFicha && abriu && abriu.isConnected) abriu.focus({ preventScroll: true });
          root.removeAttribute('data-ficha');
          if (location.hash.startsWith('#quarto=')) history.replaceState(null, '', location.pathname + location.search);
          anunciar(fr('semSelecao', 'Prédio inteiro. Nenhum quarto selecionado.'));
          return;
        }
        if (q) {
          anunciar(fr('emFoco', 'Quarto {numero} em foco, andar {andar}.')
            .replace('{numero}', q.numero).replace('{andar}', Math.floor(q.numero / 100)));
        }
      },
      // A ficha mora no painel ao lado do palco; no celular o painel fica
      // embaixo, entao ao escolher a pagina desliza ate a ficha.
      onQuadro() {},
    }).then((pronto) => {
      api = pronto;
      root.removeAttribute('data-carregando');
      root.setAttribute('data-pronto', 'true');
      ligarBusca();
      ligarRegua();
      const m = location.hash.match(/^#quarto=(\d+)$/);
      if (m) api.selecionar(Number(m[1]));
      canvas.addEventListener('fachada:girou', esconderDica, { once: true });
      canvas.addEventListener('fachada:tocou', esconderDica, { once: true });
      // Os chips viram botoes com o predio de pe: escolhem o quarto que
      // representa o tipo na fachada em vez de sair da pagina.
      root.querySelectorAll('a[data-room-link]').forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = a.className;
        b.textContent = a.textContent;
        b.dataset.roomLink = '';
        b.dataset.pagina = a.dataset.pagina;
        b.dataset.quarto = a.dataset.quarto;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => api.selecionar(Number(b.dataset.quarto)));
        a.replaceWith(b);
      });
    }).catch(() => {
      root.removeAttribute('data-carregando');
      if (aviso) aviso.hidden = false;
    });
  }

  const celular = () => matchMedia('(max-width: 55.99em)').matches;
  // Celular: o foco indo para os chips ou filtros, que ficam sob a gaveta,
  // fecha a gaveta. Em qualquer tela, Esc fecha a ficha.
  // Celular: a gaveta cobre o pe da tela. Qualquer foco que saia dela (giro,
  // regua, chips, filtros) fecha a gaveta, para nada focado ficar embaixo.
  document.addEventListener('focusin', (ev) => {
    if (!celular() || !api || api.modo() !== 'quarto' || !ficha) return;
    if (!ficha.contains(ev.target)) api.verGeral();
  });
  // no documento: depois de um toque o foco pode ir para o body
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && api && api.modo() === 'quarto') api.verGeral();
  });

  // Gaveta da ficha fixa no celular: se a secao sai da tela, ela fecha,
  // para nao ficar boiando sobre o resto da pagina.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (!e.isIntersecting && api && api.modo() === 'quarto') api.verGeral();
      });
    }, { threshold: 0.15 }).observe(root);
  }

  // Monta quando a secao chega perto da tela: quem nao rola ate ela nao baixa nada.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); subir(); }
    }, { rootMargin: '300px 0px' });
    io.observe(root);
  } else {
    subir();
  }
}
