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

  const semWebgl = () => {
    root.removeAttribute('data-pronto');
    root.removeAttribute('data-modo');
    if (aviso) aviso.hidden = false;
  };

  const anunciar = (texto) => { if (status) status.textContent = texto; };

  // Os botoes da ficha sao recriados a cada selecao, entao a escuta fica no
  // contorno e nao nos botoes.
  if (ficha) {
    ficha.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-acao]');
      if (!b || !api) return;
      if (b.dataset.acao === 'vista') api.verVista();
      else if (b.dataset.acao === 'voltar') api.voltarDaVista();
      else if (b.dataset.acao === 'geral') api.verGeral();
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
          <p><a class="btn btn--primary" href="${tipo.pagina}">Ver o ${tipo.nome}</a></p>
          <p class="ficha__acoes">
            <button type="button" class="btn btn--link" data-acao="vista" data-so="quarto">Ver a vista da janela</button>
            <button type="button" class="btn btn--link" data-acao="voltar" data-so="vista">Voltar ao quarto</button>
            <button type="button" class="btn btn--link" data-acao="geral">Ver o prédio inteiro</button>
          </p>`;
      },
      // Estado da cena no atributo: o CSS usa para tirar o texto do herói da
      // frente, soltar a ficha do canto e emoldurar a vista da janela.
      onModo(modo, q) {
        root.setAttribute('data-modo', modo);
        if (modo === 'geral') {
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
        // A lista HTML comanda o 3D: passar o mouse ou focar escolhe o quarto,
        // separa os andares e leva a câmera até a janela. O atraso evita que
        // varrer a lista de raspão dispare um voo atrás do outro.
        // Busca no documento, não em root: a lista de tipos é uma seção irmã
        // da cena, então root.querySelectorAll nunca achava nada.
        document.querySelectorAll('[data-quarto]').forEach((a) => {
          const n = Number(a.getAttribute('data-quarto'));
          const sel = () => api.selecionar(n, { atraso: 220 });
          a.addEventListener('mouseenter', sel);
          a.addEventListener('focus', sel);
        });
      })
      .catch(semWebgl);
  }
}
