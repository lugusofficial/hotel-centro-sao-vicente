// Liga o predio 3D a interface HTML. Progressivo: a lista de quartos e os links
// existem no HTML e funcionam sem WebGL, sem este modulo e por teclado.
import { montarPredio } from './predio.js';

// Frases da pagina: o arquivo e o mesmo nas duas linguas, entao o texto vem do
// bloco JSON que a pagina traz. Sem o bloco, vale o portugues de reserva.
const FRASES = (() => {
  try { return JSON.parse(document.getElementById('i18n').textContent); }
  catch (e) { return {}; }
})();
const fr = (chave, reserva) => FRASES[chave] || reserva;
// O nome do tipo vem do hotel.json, que e unico para as duas linguas.
const nomeTipo = (chave, tipo) => (FRASES.tipos && FRASES.tipos[chave]) || tipo.nome;

const root = document.querySelector('[data-predio]');
if (root) {
  const canvas = root.querySelector('[data-predio-canvas]');
  const tooltip = root.querySelector('[data-predio-tooltip]');
  const ficha = root.querySelector('[data-predio-ficha]');
  const aviso = root.querySelector('[data-predio-aviso]');
  const status = root.querySelector('[data-predio-status]');

  let api = null;

  // Fileira de andares da ficha. Em branco ate o 3D subir, porque e dele que
  // vem a lista de andares do hotel.
  const linhaAndares = (numero) => {
    if (!api) return '';
    const atual = Math.floor(numero / 100);
    const botoes = api.hotel.andares.map((a) => {
      const aqui = a.numero === atual;
      return `<button type="button" data-andar="${a.numero}"`
        + `${aqui ? ' aria-current="true"' : ''}>`
        + `<span class="visually-hidden">${fr('andar', 'Andar')} </span>${a.numero}</button>`;
    }).join('');
    return `<div class="ficha__andares"><span class="ficha__rotulo" id="ficha-andares">${fr('trocarAndar', 'Trocar de andar')}</span>`
      + `<div role="group" aria-labelledby="ficha-andares">${botoes}</div></div>`;
  };

  const semWebgl = () => {
    root.removeAttribute('data-pronto');
    root.removeAttribute('data-modo');
    if (aviso) aviso.hidden = false;
  };

  const anunciar = (texto) => { if (status) status.textContent = texto; };

  // De que horas a que horas a fachada daquele quarto pega sol hoje. Vem do
  // calculo de posicao solar, nao de texto fixo: muda com a data e com a
  // rotacao do predio no terreno.
  let apiSol = null;
  const faixaDeSol = (q) => {
    const f = apiSol && apiSol.solDaFachada(q.fachada);
    if (!f) return fr('semSol', 'Pouco sol direto');
    return fr('faixaSol', 'das {de}h às {ate}h').replace('{de}', f.de).replace('{ate}', f.ate);
  };

  // Numero do quarto em foco, para a troca de andar saber de onde sai.
  let quartoAtual = null;

  // Os botoes da ficha sao recriados a cada selecao, entao a escuta fica no
  // contorno e nao nos botoes.
  if (ficha) {
    ficha.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-acao], button[data-andar]');
      if (!b || !api) return;
      if (b.dataset.acao === 'geral') { api.verGeral(); return; }
      // Mesma posicao na fachada, outro andar: o numero e andar vezes cem mais
      // a posicao, entao 412 no quinto andar e 512. Antes so dava para trocar
      // de andar voltando ao predio inteiro e procurando a janela de novo.
      if (b.dataset.andar && quartoAtual) {
        api.selecionar(Number(b.dataset.andar) * 100 + (quartoAtual % 100));
      }
    });
  }

  // Painel de hora e filtros. So existe com o predio de pe: sem JavaScript ou
  // sem WebGL ele fica oculto, porque formulario que nao muda nada e pior do
  // que formulario nenhum.
  function ligarBusca(api) {
    // Busca no documento, nao em root: o painel e secao irma da cena, para o
    // texto dos controles nao entrar no orcamento de palavras do heroi.
    const painel = document.querySelector('[data-busca]');
    if (!painel) return;
    const abrir = painel.querySelector('[data-busca-abrir]');
    const campos = painel.querySelector('#busca-campos');
    const conta = painel.querySelector('[data-busca-conta]');
    const hora = painel.querySelector('#f-hora');
    const saidaHora = painel.querySelector('[data-f-hora]');
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

    const formatarHora = (h) => {
      const inteira = Math.floor(h);
      const min = Math.round((h - inteira) * 60);
      return min ? `${inteira}h${String(min).padStart(2, '0')}` : `${inteira}h`;
    };

    // Todos os quartos numa lista so: a contagem roda a cada mexida de
    // controle e nao vale varrer os sete andares de novo toda vez.
    const todos = api.hotel.andares.reduce((lista, a) => lista.concat(a.quartos), []);

    function aplicar() {
      const v = vista.value;
      const an = andar.value;
      const teto = Number(preco.value);
      const soLivre = livre.checked;
      const nenhum = !v && !an && teto >= Number(preco.max) && !soLivre;

      const bate = (q) => (!v || q.vista === v)
        && (!an || String(q.numero).slice(0, -2) === an)
        && q.precoBase <= teto
        && (!soLivre || q.status === 'disponivel');

      api.aplicarFiltro(nenhum ? null : bate);
      const n = nenhum ? todos.length : todos.filter(bate).length;
      conta.textContent = (nenhum
        ? fr('contaTodos', '{n} quartos na fachada')
        : fr('contaFiltro', '{n} quartos atendem')).replace('{n}', n);
    }

    hora.addEventListener('input', () => {
      saidaHora.textContent = formatarHora(Number(hora.value));
      api.aplicarHora(Number(hora.value));
    });
    preco.addEventListener('input', () => {
      saidaPreco.textContent = `R$ ${preco.value}`;
    });
    [vista, andar, preco, livre].forEach((el) => el.addEventListener('input', aplicar));
    saidaHora.textContent = formatarHora(Number(hora.value));
    aplicar();
  }

  // Testa num canvas descartavel: pedir o contexto no canvas real faria o
  // Three.js reaproveitar esse contexto e ignorar antialias e demais atributos.
  try {
    const teste = document.createElement('canvas');
    if (!teste.getContext('webgl2') && !teste.getContext('webgl')) throw new Error('sem webgl');
  } catch (e) {
    semWebgl();
  }

  if (!aviso || aviso.hidden) {
    montarPredio({
      canvas,
      tooltip,
      onSelecionar(q, tipo) {
        quartoAtual = q.numero;
        // Marca o tipo escolhido nos chips, inclusive quando a escolha veio de
        // um clique na janela do predio.
        document.querySelectorAll('[data-room-link]').forEach((el) => {
          const seu = el.dataset.pagina === tipo.pagina;
          el.classList.toggle('is-active', seu);
          if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', String(seu));
        });
        if (!ficha) return;
        ficha.hidden = false;
        const disp = q.status === 'disponivel';
        ficha.innerHTML = `
          <p class="ficha__num">${fr('quarto', 'Quarto')} ${q.numero}</p>
          <p class="ficha__tipo">${nomeTipo(q.tipo, tipo)}</p>
          <dl class="ficha__dados">
            <div><dt>${fr('diaria', 'Diária')}</dt><dd>R$ ${q.precoBase}</dd></div>
            <div><dt>${fr('andar', 'Andar')}</dt><dd>${String(q.numero).slice(0, -2)}</dd></div>
            <div><dt>${fr('vista', 'Vista')}</dt><dd>${fr(q.vista === 'mar' ? 'vistaMar' : 'vistaCidade', q.vista)}</dd></div>
            <div><dt>${fr('hospedes', 'Hóspedes')}</dt><dd>${tipo.hosp}</dd></div>
            <div><dt>${fr('sol', 'Sol direto')}</dt><dd>${faixaDeSol(q)}</dd></div>
          </dl>
          <p class="ficha__estado" data-disp="${disp}">${disp ? fr('disponivel', 'Disponível') : fr('indisponivel', 'Indisponível nas datas')}</p>
          ${linhaAndares(q.numero)}
          <p><a class="btn btn--primary" href="${tipo.pagina}">${fr('ver', 'Ver o {tipo}').replace('{tipo}', nomeTipo(q.tipo, tipo))}</a></p>
          <p class="ficha__acoes">
            <button type="button" class="btn btn--link" data-acao="geral">${fr('predioInteiro', 'Ver o prédio inteiro')}</button>
          </p>`;
      },
      // Estado da cena no atributo: o CSS usa para tirar o texto do herói da
      // frente, soltar a ficha do canto e emoldurar a vista da janela.
      onModo(modo, q) {
        root.setAttribute('data-modo', modo);
        if (modo === 'geral') {
          document.querySelectorAll('[data-room-link].is-active')
            .forEach((a) => a.classList.remove('is-active'));
          if (ficha) {
            ficha.hidden = true;
            ficha.style.left = ficha.style.top = ficha.style.opacity = '';
          }
          anunciar(fr('semSelecao', 'Visão externa do prédio. Nenhum quarto selecionado.'));
          return;
        }
        if (!q) return;
        anunciar(fr('emFoco', 'Quarto {numero} em foco, andar {andar}. Os outros andares ficaram transparentes.')
          .replace('{numero}', q.numero).replace('{andar}', String(q.numero).slice(0, -2)));
      },
      // A ficha acompanha a janela escolhida, saindo de dentro do prédio.
      // Em tela estreita o CSS a tira do posicionamento absoluto e isto não atrapalha.
      onQuadro(p) {
        if (!ficha || ficha.hidden || !p) return;
        // Dentro do quarto a janela fica atrás da câmera: a ficha vai para o
        // canto pelo CSS em vez de perseguir uma projeção que não existe.
        if (p.modo === 'vista' || window.matchMedia('(max-width: 55.99em)').matches) {
          ficha.style.left = ficha.style.top = '';
          ficha.style.opacity = '';
          return;
        }
        const margem = 24;
        const meia = ficha.offsetWidth / 2 || 150;
        const altura = ficha.offsetHeight / 2 || 120;
        const paraDireita = p.x < p.largura * 0.62;
        const x = paraDireita ? p.x + meia + margem : p.x - meia - margem;
        ficha.style.left = `${Math.min(Math.max(x, meia + 8), p.largura - meia - 8)}px`;
        ficha.style.top = `${Math.min(Math.max(p.y, altura + 8), p.altura - altura - 8)}px`;
        ficha.style.opacity = p.frente ? '1' : '0.25';
      },
    })
      .then((pronto) => {
        api = pronto;
        root.setAttribute('data-pronto', 'true');
        // Os chips da cena viram botoes agora que o predio esta de pe: eles
        // passam a trocar a selecao na fachada em vez de sair da pagina. Sem
        // JavaScript ou sem WebGL continuam sendo links para a pagina do tipo,
        // que e o destino util quando nao ha fachada para comandar.
        //
        // So no clique. Antes a escolha vinha de passar o mouse, e isso disparava
        // um voo em cada chip que o ponteiro cruzasse no caminho ate o que
        // interessava.
        apiSol = api;
        ligarBusca(api);
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
      })
      .catch(semWebgl);
  }
}
