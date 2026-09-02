/*
 * O construtor: os eixos do tema e a limpeza do texto rico.
 *
 * O texto rico é o que este teste guarda de verdade. O valor vai para a página
 * onde o cartão é digitado, renderizado como HTML — uma tag a mais aceita ali
 * é script na tela de pagamento. Lista fechada, e o teste prova que é fechada.
 *
 *   node scripts/teste-construtor.cjs
 */
const {
  TEMAS, CATEGORIAS, limparTextoRico, lerVisual, rotuloDocumento, visualPadrao,
  temaDisponivel, camposPessoais, camposEntrega, limparCampo, formatarCampo,
} = require("../_tmp/core/construtor.js");

let f = 0;
const eq = (l, obtido, esperado) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) f++;
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${l}`
    + (ok ? "" : `  obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`));
};

console.log("\n== o texto rico só aceita quatro tags ==");
eq("negrito passa", limparTextoRico("<b>Frete grátis</b>"), "<b>Frete grátis</b>");
eq("itálico, sublinhado e riscado passam",
  limparTextoRico("<i>a</i><u>b</u><s>c</s>"), "<i>a</i><u>b</u><s>c</s>");
eq("quebra de linha passa", limparTextoRico("a<br>b"), "a<br>b");

console.log("\n== e barra todo o resto ==");
/* Tag nova nasce barrada: a lista e de PERMITIDOS. Uma lista de proibidos
   deixaria passar a proxima que alguem inventasse. */
eq("script some com o miolo junto",
  limparTextoRico("Oi<script>roubar()</script>tudo"), "Oitudo");
eq("style também", limparTextoRico("a<style>*{}</style>b"), "ab");
eq("imagem com onerror não passa",
  limparTextoRico('<img src=x onerror="alert(1)">'), "");
eq("link não passa", limparTextoRico('<a href="http://mau">clique</a>'), "clique");
eq("div vira nada", limparTextoRico("<div>texto</div>"), "texto");

console.log("\n== atributo NENHUM sobrevive, nem em tag permitida ==");
/* `style` sozinho ja move a barra para cima do campo de cartao — e `onclick`
   dispensa comentario. A tag e reescrita do zero. */
eq("onclick some", limparTextoRico('<b onclick="x()">oi</b>'), "<b>oi</b>");
eq("style some", limparTextoRico('<b style="position:fixed">oi</b>'), "<b>oi</b>");
eq("maiúsculas também são limpas", limparTextoRico('<B ONCLICK="x">oi</B>'), "<b>oi</b>");

console.log("\n== entrada que não é texto não derruba nada ==");
eq("indefinido vira vazio", limparTextoRico(undefined), "");
eq("número vira vazio", limparTextoRico(42), "");
eq("corta em 300", limparTextoRico("a".repeat(400)).length, 300);

console.log("\n== os sete temas são estruturalmente distintos ==");
/* Se dois temas tiverem os quatro eixos iguais, um deles e so um nome
   diferente para a mesma pagina — e o lojista troca e nao ve mudanca. */
const eixos = TEMAS.map((t) =>
  `${t.navegacao}|${t.progresso}|${t.resumo}|${t.densidade}|${t.fonteBase}|${t.fonteEditorial ?? "-"}`);
eq("são sete", TEMAS.length, 7);
eq("e nenhum repete a combinação", new Set(eixos).size, 7);

console.log("\n== CPF e telefone so aceitam digito ==");
/* O valor GUARDADO e so digito; a mascara e como ele aparece. Guardar
   mascarado obrigaria cada gateway a limpar de novo, e e onde se perde um zero
   a esquerda. */
eq("letra some do CPF", limparCampo("documento", "12a3b4c5"), "12345");
eq("ponto e traco somem tambem", limparCampo("documento", "123.456.789-00"), "12345678900");
eq("telefone idem", limparCampo("telefone", "(11) 99999-0000"), "11999990000");
/* Sem teto, quem cola um numero com DDI acaba com treze digitos, a mascara
   embaralha e o gateway recusa um numero digitado certo. */
eq("CPF corta em 11", limparCampo("documento", "123456789001234"), "12345678900");
eq("telefone corta em 11", limparCampo("telefone", "5511999990000"), "55119999900");
eq("CEP corta em 8", limparCampo("cep", "301300001234"), "30130000");
/* Campo que nao e numerico passa inteiro: nome tem letra, e obviamente. */
eq("nome nao e tocado", limparCampo("nome", "Ryan Rodrigues"), "Ryan Rodrigues");

console.log("\n== e aparecem com mascara ==");
eq("CPF completo", formatarCampo("documento", "12345678900"), "123.456.789-00");
eq("CPF pela metade nao inventa pontuacao",
  formatarCampo("documento", "1234"), "123.4");
/* Nove digitos no numero e celular, oito e fixo — e os dois existem. */
eq("celular", formatarCampo("telefone", "11999990000"), "(11) 99999-0000");
eq("fixo", formatarCampo("telefone", "1133334444"), "(11) 3333-4444");
eq("CEP", formatarCampo("cep", "30130000"), "30130-000");
eq("vazio continua vazio", formatarCampo("documento", ""), "");

console.log("\n== os campos: a previa e a loja pedem os MESMOS ==");
/* A promessa do construtor e "o que voce salva e o que aparece". Duas listas
   de campos — uma na previa, outra no checkout — quebrariam isso em silencio:
   o lojista aprova um formulario e o comprador ve outro. */
const nomes = (l) => l.map((c) => c[0]);
eq("o basico, sem nada ligado",
  nomes(camposPessoais({})), ["nome", "email", "telefone", "documento"]);
eq("nascimento e sexo entram quando ligados",
  nomes(camposPessoais({ pedirNascimento: true, pedirGenero: true })),
  ["nome", "email", "telefone", "documento", "nascimento", "genero"]);
/* O CPF nao SOME: ele muda de etapa. O gateway exige em algum momento, e a
   escolha do lojista e QUANDO, nao SE. */
eq("com cpfSoNoPagamento, o CPF sai da primeira etapa",
  nomes(camposPessoais({ cpfSoNoPagamento: true })), ["nome", "email", "telefone"]);
eq("e aparece na de pagamento",
  nomes(camposPessoais({ cpfSoNoPagamento: true }, true)), ["documento"]);
eq("sem a opcao, a etapa de pagamento nao pede nada",
  nomes(camposPessoais({}, true)), []);

eq("entrega tem os sete campos", camposEntrega({}).length, 7);
/* Desativar endereco e para infoproduto: sem entrega, nao ha o que perguntar. */
eq("e some inteira sem endereco", camposEntrega({ semEndereco: true }).length, 0);

console.log("\n== o rotulo do documento sai da CONTAGEM de digitos ==");
/* Um campo separado para o lojista escolher entre CNPJ e CPF seria um campo a
   mais para ele errar — e "CPF" na frente de um CNPJ faz o comprador
   desconfiar da pagina onde vai digitar o cartao. */
eq("14 digitos e CNPJ", rotuloDocumento("49.149.219/0001-46"), "CNPJ 49.149.219/0001-46");
eq("11 digitos e CPF", rotuloDocumento("123.456.789-00"), "CPF 123.456.789-00");
eq("sem pontuacao tambem", rotuloDocumento("49149219000146"), "CNPJ 49149219000146");
/* Palpite errado e pior que palpite nenhum: fora de 11 e 14, mostra o numero
   puro em vez de rotular por chute. */
eq("contagem estranha nao ganha rotulo", rotuloDocumento("12345"), "12345");
eq("vazio nao vira rotulo solto", rotuloDocumento(""), "");
eq("indefinido tambem nao", rotuloDocumento(undefined), "");

console.log("\n== a tipografia e do TEMA, nao do lojista ==");
/* O painel do modelo nao expoe seletor de fonte: o par tipografico faz parte
   do que define o tema. Um seletor deixaria o lojista quebrar o par. */
eq("nao ha campo de fonte no painel",
  CATEGORIAS.some((c) => c.campos.some((k) => k.chave === "fonte")), false);
/* Sora e ESTRUTURAL: esta em todos, sempre nos inputs. A excecao e o Minimal,
   que usa Arial de proposito — nada de webfont, nada de enfeite. */
eq("Sora em todos, menos no Minimal",
  TEMAS.filter((t) => t.fonteBase === "sora").length, TEMAS.length - 1);
eq("e o Minimal e o do Arial",
  TEMAS.find((t) => t.fonteBase === "arial").chave, "minimal");
/* Nunito e EDITORIAL: entra por cima em titulo, descricao, label e botao. */
eq("editorial nos quatro temas certos",
  TEMAS.filter((t) => t.fonteEditorial).map((t) => t.chave),
  ["conversion", "yupi", "yupi-v2", "hothot"]);
/* Ausente e ESCOLHA, nao esquecimento: e o que faz esses dois parecerem
   uniformes ao lado dos outros. */
eq("Focal e Shopifay ficam numa familia so",
  TEMAS.filter((t) => !t.fonteEditorial).map((t) => t.chave),
  ["minimal", "focal", "shopifay"]);
eq("o Yupi V2 e o parcial",
  TEMAS.filter((t) => t.editorialParcial).map((t) => t.chave), ["yupi-v2"]);
eq("e o cronometro gigante e so do one-page",
  TEMAS.filter((t) => t.cronometroGigante).map((t) => t.chave), ["hothot"]);
/* Arial nao tem editorial: as duas juntas desfariam a estetica sem enfeite. */
eq("o tema do Arial nao ganha segunda fonte",
  TEMAS.find((t) => t.fonteBase === "arial").fonteEditorial, undefined);

console.log("\n== e cobrem o que foi pedido ==");
eq("tem um clean", TEMAS.some((t) => t.densidade === "clean"), true);
eq("tem etapas numeradas em círculo", TEMAS.some((t) => t.progresso === "circulos"), true);
eq("tem cards com ícone", TEMAS.some((t) => t.progresso === "cards"), true);
eq("tem resumo fixo no rodapé", TEMAS.some((t) => t.resumo === "rodape"), true);
eq("tem one-page sem etapas",
  TEMAS.some((t) => t.navegacao === "uma-pagina" && t.progresso === "nenhum"), true);
/* O one-page e para infoproduto: sem entrega, nao ha etapa de endereco para
   dividir a pagina. Numa loja fisica ele esconderia o que precisa ser pedido. */
eq("e o one-page é travado por tipo de loja",
  temaDisponivel(TEMAS.find((t) => t.navegacao === "uma-pagina"), "fisico"), false);

console.log("\n== o que ENTRA pelo banco também é limpo ==");
/* lerVisual e o unico caminho por onde um visual entra: a rota que grava e a
   pagina que desenha passam as duas por ele. Limpar so na rota deixaria de
   fora qualquer valor que chegasse por outro lugar. */
eq("script vindo do banco não sobrevive",
  lerVisual({ avisoTexto: "<script>x()</script>Frete" }).avisoTexto, "Frete");
eq("negrito vindo do banco sobrevive",
  lerVisual({ avisoTexto: "<b>Frete</b>" }).avisoTexto, "<b>Frete</b>");
/* Trocar de tema nao pode apagar o que o lojista pintou. */
eq("as cores atravessam a troca de tema",
  lerVisual({ botaoFundo: "#FF0000" }).botaoFundo, "#FF0000");

console.log("\n== as nove seções, e o visual é da LOJA e não do tema ==");
eq("nove categorias", CATEGORIAS.length, 9);
const padrao = visualPadrao();
/* Cor, texto e interruptor moram no Visual. Se um dia uma cor entrar no Tema,
   trocar de tema passa a apagar o que o lojista pintou. */
const chavesDeTema = ["navegacao", "progresso", "resumo", "densidade"];
eq("nenhum eixo de tema virou campo do visual",
  chavesDeTema.filter((c) => c in padrao && c !== "navegacao"), []);

console.log(f ? `\n${f} FALHA(S)\n` : "\ntudo certo\n");
process.exit(f ? 1 : 0);
