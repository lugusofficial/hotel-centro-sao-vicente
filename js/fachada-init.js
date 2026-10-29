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

  const anunciar = (texto) => { if (status) status.textContent = texto; };

  // Fileira de andares da ficha: mesma posicao, outro andar. Andar em que essa
  // posicao nao existe (o 10o tem menos quartos) fica desabilitado.
  const linhaAndares = (numero) => {
    if (!api) return '';
    const atual = Math.floor(numero / 100);
    const pos = numero % 100;
    const existe = new Set(api.hotel.andares.flatMap((a) => a.quartos.map((q) => q.numero)));
    const botoes = api.hotel.andares.map((a) => {
      const aqui = a.numero === atual;
      const tem = existe.has(a.numero * 100 + pos);
      return `<button type="button" data-andar="${a.numero}"${aqui ? ' aria-current="true"' : ''}${tem ? '' : ' disabled'}>`
        + `<span class="visually-hidden">${fr('andar', 'Andar')} </span>${a.numero}</button>`;
    }).join('');
    return `<div class="ficha__andares"><span class="ficha__rotulo" id="ficha-andares">${fr('trocarAndar', 'Trocar de andar')}</span>`
      + `<div role="group" aria-labelledby="ficha-andares">${botoes}</div></div>`;
  };

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
    painel.hidden = false;
    abrir.addEventListener('click', () => {
      const aberto = abrir.getAttribute('aria-expanded') === 'true';
      abrir.setAttribute('aria-expanded', String(!aberto));
      campos.hidden = aberto;
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
      conta.textContent = (nenhum ? fr('contaTodos', '{n} quartos no prédio')
        : fr('contaFiltro', '{n} quartos atendem')).replace('{n}', n);
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
        esconderDica();
        root.querySelectorAll('[data-room-link]').forEach((el) => {
          const seu = el.dataset.pagina === tipo.pagina;
          el.classList.toggle('is-active', seu);
          if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(seu));
        });
        if (!ficha) return;
        ficha.hidden = false;
        const disp = q.status === 'disponivel';
        ficha.innerHTML = `
          <button type="button" class="ficha__fechar" data-acao="geral"><span aria-hidden="true">×</span><span class="visually-hidden">${fr('predioInteiro', 'Ver o prédio inteiro')}</span></button>
          <p class="ficha__num">${fr('quarto', 'Quarto')} ${q.numero}</p>
          <p class="ficha__tipo">${nomeTipo(q.tipo, tipo)}</p>
          <dl class="ficha__dados">
            <div><dt>${fr('diaria', 'Diária')}</dt><dd>R$ ${q.precoBase}</dd></div>
            <div><dt>${fr('andar', 'Andar')}</dt><dd>${Math.floor(q.numero / 100)}</dd></div>
            <div><dt>${fr('vista', 'Vista')}</dt><dd>${fr(q.vista === 'mar' ? 'vistaMar' : 'vistaCidade', q.vista)}</dd></div>
            <div><dt>${fr('hospedes', 'Hóspedes')}</dt><dd>${tipo.hosp}</dd></div>
            <div><dt>${fr('sol', 'Sol direto')}</dt><dd>${faixaDeSol(q)}</dd></div>
          </dl>
          <p class="ficha__estado" data-disp="${disp}">${disp ? fr('disponivel', 'Disponível') : fr('indisponivel', 'Indisponível nas datas')}</p>
          ${linhaAndares(q.numero)}
          <p><a class="btn btn--primary" href="${tipo.pagina}">${fr('ver', 'Ver o {tipo}').replace('{tipo}', nomeTipo(q.tipo, tipo))}</a></p>`;
      },
      onModo(modo, q) {
        root.setAttribute('data-modo', modo);
        if (modo === 'geral') {
          root.querySelectorAll('[data-room-link].is-active').forEach((a) => a.classList.remove('is-active'));
          if (ficha) {
            ficha.hidden = true;
            ficha.style.left = ficha.style.top = '';
          }
          anunciar(fr('semSelecao', 'Prédio inteiro. Nenhum quarto selecionado.'));
          return;
        }
        if (q) {
          anunciar(fr('emFoco', 'Quarto {numero} em foco, andar {andar}.')
            .replace('{numero}', q.numero).replace('{andar}', Math.floor(q.numero / 100)));
        }
      },
      // A ficha sai de perto da janela no computador; no celular o CSS a
      // prende na base da cena, como uma gaveta.
      onQuadro(p) {
        if (!ficha || ficha.hidden || !p || matchMedia('(max-width: 55.99em)').matches) {
          if (ficha) ficha.style.left = ficha.style.top = '';
          return;
        }
        const margem = 28;
        const meia = ficha.offsetWidth / 2 || 160;
        const altura = ficha.offsetHeight / 2 || 140;
        const x = p.x + meia + margem;
        ficha.style.left = `${Math.min(Math.max(x, meia + 8), p.largura - meia - 8)}px`;
        ficha.style.top = `${Math.min(Math.max(p.y, altura + 8), p.altura - altura - 8)}px`;
      },
    }).then((pronto) => {
      api = pronto;
      root.removeAttribute('data-carregando');
      root.setAttribute('data-pronto', 'true');
      ligarBusca();
      canvas.addEventListener('fachada:girou', esconderDica, { once: true });
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
