// Liga o predio 3D a interface HTML. Progressivo: a lista de quartos e os links
// existem no HTML e funcionam sem WebGL, sem este modulo e por teclado.
import { montarPredio } from './predio.js';

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
        + `<span class="visually-hidden">Andar </span>${a.numero}</button>`;
    }).join('');
    return `<div class="ficha__andares"><span class="ficha__rotulo" id="ficha-andares">Trocar de andar</span>`
      + `<div role="group" aria-labelledby="ficha-andares">${botoes}</div></div>`;
  };

  const semWebgl = () => {
    root.removeAttribute('data-pronto');
    root.removeAttribute('data-modo');
    if (aviso) aviso.hidden = false;
  };

  const anunciar = (texto) => { if (status) status.textContent = texto; };

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
          <p class="ficha__num">Quarto ${q.numero}</p>
          <p class="ficha__tipo">${tipo.nome}</p>
          <dl class="ficha__dados">
            <div><dt>Diária</dt><dd>R$ ${q.precoBase}</dd></div>
            <div><dt>Andar</dt><dd>${String(q.numero).slice(0, -2)}</dd></div>
            <div><dt>Vista</dt><dd>${q.vista}</dd></div>
            <div><dt>Hóspedes</dt><dd>${tipo.hosp}</dd></div>
          </dl>
          <p class="ficha__estado" data-disp="${disp}">${disp ? 'Disponível' : 'Indisponível nas datas'}</p>
          ${linhaAndares(q.numero)}
          <p><a class="btn btn--primary" href="${tipo.pagina}">Ver o ${tipo.nome}</a></p>
          <p class="ficha__acoes">
            <button type="button" class="btn btn--link" data-acao="geral">Ver o prédio inteiro</button>
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
          anunciar('Visão externa do prédio. Nenhum quarto selecionado.');
          return;
        }
        if (!q) return;
        if (modo === 'vista') {
          anunciar(`Vista da janela do quarto ${q.numero}. Use o botão Voltar ao quarto ou a tecla Escape para sair.`);
        } else {
          anunciar(`Quarto ${q.numero} em foco, andar ${String(q.numero).slice(0, -2)}. Os outros andares ficaram transparentes.`);
        }
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
