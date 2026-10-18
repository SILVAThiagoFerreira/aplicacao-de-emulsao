import { jsPDF } from 'jspdf';
import { formatCompactPlanKg, formatDate, formatKg, formatPlanWaterfallTick } from './format.js';

// PDF montado diretamente com texto, retângulos e linhas (vetor). Nada é capturado da tela.
// Estilo: fundo branco, título vermelho em caixa alta, subtítulo cinza, seções com régua fina.
const MARGIN = 15;
const PAGE_WIDTH = 297;
const RIGHT_EDGE = PAGE_WIDTH - MARGIN;
const CONTENT_WIDTH = RIGHT_EDGE - MARGIN;
const CONTENT_BOTTOM = 184;
const FOOTER_Y = 203;
const PT_TO_MM = 0.3528;
const LINE_SPACING = 1.35;
const TABLE_TEXT_SIZE = 8;

const COLOR = {
  red: [181, 18, 27],
  white: [255, 255, 255],
  charcoal: [60, 63, 68],
  gray: [138, 143, 150],
  note: [60, 63, 68],
  body: [74, 74, 74],
  line: [229, 229, 229],
  hair: [238, 238, 238],
  ink: [60, 63, 68]
};

function lineHeight(size) {
  return size * PT_TO_MM * LINE_SPACING;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatGeneratedAt(date) {
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0);
      resolve({ data: canvas.toDataURL('image/png'), ratio: img.naturalWidth / img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Não foi possível carregar os logotipos do relatório.'));
    img.src = url;
  });
}

// Logotipos Enaex + cliente, carregados antes de montar o PDF (que é síncrono).
export async function loadReportLogos() {
  const [enaex, client] = await Promise.all([loadImage('assets/Enaex Brasil.png'), loadImage('assets/Mineracao Vale Verde.png')]);
  return { enaex, client };
}

function drawLogos(pdf, logos) {
  if (!logos) return;
  const clientHeight = 12;
  const clientWidth = clientHeight * logos.client.ratio;
  const enaexHeight = 10;
  const enaexWidth = enaexHeight * logos.enaex.ratio;
  pdf.addImage(logos.client.data, 'PNG', RIGHT_EDGE - clientWidth, MARGIN - 3, clientWidth, clientHeight);
  pdf.addImage(logos.enaex.data, 'PNG', RIGHT_EDGE - clientWidth - 6 - enaexWidth, MARGIN - 2, enaexWidth, enaexHeight);
}

function createReportWriter({ title, runningTitle, footerTitle, logos = null }) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title, author: 'US Vale Verde', creator: 'Dashboard de Emulsão' });
  pdf.setDrawColor(...COLOR.line);
  const page = { y: MARGIN };
  drawLogos(pdf, logos);

  const applyStyle = (size, bold, color) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };

  const write = (value, x, y, { size = 9, bold = false, color = COLOR.ink, align = 'left', spacing = 0, angle = 0 } = {}) => {
    applyStyle(size, bold, color);
    pdf.setCharSpace(spacing);
    pdf.text(String(value), x, y, { align, angle });
    pdf.setCharSpace(0);
  };

  const splitLines = (value, width, { size = 9, bold = false } = {}) => {
    applyStyle(size, bold, COLOR.ink);
    return pdf.splitTextToSize(String(value), width);
  };

  const textWidth = (value, size, bold = false) => {
    applyStyle(size, bold, COLOR.ink);
    return pdf.getTextWidth(String(value));
  };

  // Corta o texto com reticências para caber na largura dada (uma linha só).
  const fitText = (value, maxWidth, { size = 9, bold = false } = {}) => {
    let text = String(value);
    if (textWidth(text, size, bold) <= maxWidth) return text;
    while (text.length > 1 && textWidth(`${text}...`, size, bold) > maxWidth) text = text.slice(0, -1);
    return `${text}...`;
  };

  const writeLines = (lines, x, y, { size = 9, bold = false, color = COLOR.ink, align = 'left' } = {}) => {
    lines.forEach((line, index) => write(line, x, y + index * lineHeight(size), { size, bold, color, align }));
    return lines.length * lineHeight(size);
  };

  const rule = (x1, y1, x2, y2, { color = COLOR.line, width = 0.25 } = {}) => {
    pdf.setDrawColor(...color);
    pdf.setLineWidth(width);
    pdf.line(x1, y1, x2, y2);
  };

  const box = (x, y, width, height, { fill = null } = {}) => {
    if (fill) pdf.setFillColor(...fill);
    pdf.rect(x, y, width, height, 'F');
  };

  const newPage = () => {
    pdf.addPage();
    write(fitText(runningTitle, CONTENT_WIDTH, { size: 7.5 }), MARGIN, MARGIN + 2, { size: 7.5, color: COLOR.gray });
    page.y = MARGIN + 10;
  };

  // Abre página nova quando `height` não cabe; devolve true nesse caso.
  const ensure = (height) => {
    if (page.y + height <= CONTENT_BOTTOM) return false;
    newPage();
    return true;
  };

  const finish = () => {
    const total = pdf.getNumberOfPages();
    for (let number = 1; number <= total; number += 1) {
      pdf.setPage(number);
      rule(MARGIN, FOOTER_Y - 4, RIGHT_EDGE, FOOTER_Y - 4, { color: COLOR.charcoal, width: 0.6 });
      const confidential = 'STRICTLY PRIVATE AND CONFIDENTIAL';
      const confidentialWidth = textWidth(confidential, 7);
      write(fitText(`${footerTitle} · Página ${number} de ${total}`, CONTENT_WIDTH - confidentialWidth - 6, { size: 7 }), MARGIN, FOOTER_Y, { size: 7, color: COLOR.gray });
      write(confidential, RIGHT_EDGE, FOOTER_Y, { size: 7, color: COLOR.gray, align: 'right' });
    }
    return pdf;
  };

  return { pdf, page, write, splitLines, writeLines, textWidth, rule, box, newPage, ensure, finish };
}

function drawMasthead(writer, { title, subtitle }) {
  const { page, write, splitLines, writeLines, textWidth } = writer;
  page.y += 4;
  // Título em caixa alta, vermelho e sem negrito; cabe em no máximo duas linhas, reduzindo a fonte se preciso.
  const upper = title.toLocaleUpperCase('pt-BR');
  let titleFit = null;
  for (const size of [28, 22, 17, 13]) {
    const lines = splitLines(upper, CONTENT_WIDTH - 90, { size });
    if (lines.length <= 2 && lines.every((line) => textWidth(line, size) <= CONTENT_WIDTH - 90)) {
      titleFit = { size, lines };
      break;
    }
  }
  if (!titleFit) titleFit = { size: 12, lines: splitLines(upper, CONTENT_WIDTH, { size: 12 }).slice(0, 2) };
  page.y += writeLines(titleFit.lines, MARGIN, page.y + 6, { size: titleFit.size, color: COLOR.red }) + 1.5;
  write(subtitle, MARGIN, page.y + 3, { size: 11, color: COLOR.body });
  page.y += 12;
}

function drawKpiPanel(writer, items) {
  const { page, rule, writeLines, write, ensure } = writer;
  const height = 20;
  ensure(height);
  const cellWidth = CONTENT_WIDTH / items.length;
  items.forEach((item, index) => {
    const x = MARGIN + index * cellWidth;
    write(item.label, x, page.y + 4, { size: 7, color: COLOR.gray });
    const lines = writer.splitLines(item.value, cellWidth - 4, { size: item.size, bold: true });
    writeLines(lines, x, page.y + 11, { size: item.size, bold: true, color: item.red ? COLOR.red : COLOR.charcoal });
  });
  rule(MARGIN, page.y + height - 2, RIGHT_EDGE, page.y + height - 2, { color: COLOR.line, width: 0.2 });
  page.y += height + 2;
}

// Régua fina clara sob o título da seção; o título em cinza, sem caixa.
function drawSectionHeader(writer, kicker, aside = '') {
  const { page, write, rule, ensure } = writer;
  ensure(10);
  write(kicker, MARGIN, page.y + 4, { size: 11, color: COLOR.body });
  if (aside) write(aside, RIGHT_EDGE, page.y + 4, { size: 7.5, color: COLOR.gray, align: 'right' });
  rule(MARGIN, page.y + 6.5, RIGHT_EDGE, page.y + 6.5, { color: COLOR.line, width: 0.2 });
  page.y += 10;
}

// Tabela que quebra entre linhas e repete o cabeçalho em cada página nova.
// Com `section`, o título da seção nunca fica sozinho no fim de uma página.
function drawTable(writer, { section = null, columns, rows, total = null, emptyText = '' }) {
  const { page, write, rule, ensure, splitLines, writeLines } = writer;

  const drawHeader = () => {
    columns.forEach((column) => write(column.label.toLocaleUpperCase('pt-BR'), column.x, page.y + 4.6, { size: 6.8, bold: true, color: COLOR.gray, spacing: column.align === 'right' ? 0 : 0.1, align: column.align }));
    rule(MARGIN, page.y + 7, RIGHT_EDGE, page.y + 7, { color: COLOR.charcoal, width: 0.25 });
    page.y += 8.5;
  };

  const measure = (row) => columns.map((column) => splitLines(row[column.key] ?? '', column.wrapWidth, { size: TABLE_TEXT_SIZE, bold: column.bold }));
  const heightOf = (cells) => Math.max(1, ...cells.map((lines) => lines.length)) * lineHeight(TABLE_TEXT_SIZE) + 3.4;

  const firstRowHeight = rows.length ? heightOf(measure(rows[0])) : 9;
  if (section) {
    ensure(10 + 8.5 + firstRowHeight);
    drawSectionHeader(writer, section.kicker, section.aside);
  } else {
    ensure(8.5 + firstRowHeight);
  }
  drawHeader();

  if (!rows.length) {
    write(emptyText, MARGIN, page.y + 4.5, { size: TABLE_TEXT_SIZE, color: COLOR.gray });
    page.y += 9;
  }

  rows.forEach((row) => {
    const cells = measure(row);
    const height = heightOf(cells);
    if (ensure(height)) drawHeader();
    columns.forEach((column, columnIndex) => {
      writeLines(cells[columnIndex], column.x, page.y + 4.2, { size: TABLE_TEXT_SIZE, bold: column.bold, align: column.align });
    });
    page.y += height;
    rule(MARGIN, page.y, RIGHT_EDGE, page.y, { color: COLOR.hair, width: 0.15 });
  });

  if (total && rows.length) {
    const cells = measure(total);
    const height = heightOf(cells);
    if (ensure(height)) drawHeader();
    rule(MARGIN, page.y, RIGHT_EDGE, page.y, { color: COLOR.charcoal, width: 0.3 });
    columns.forEach((column, columnIndex) => {
      writeLines(cells[columnIndex], column.x, page.y + 4.6, { size: TABLE_TEXT_SIZE, bold: true, align: column.align });
    });
    page.y += height + 2;
  }
  page.y += 4;
}

// Gráfico de cascata sem grade nem eixo Y: os valores ficam nas próprias barras.
// Sempre começa em folha nova (um gráfico por página).
function drawWaterfallChart(writer, rows) {
  const { page, write, rule, box, ensure, newPage, textWidth } = writer;
  const plotLeft = MARGIN + 2;
  const plotRight = RIGHT_EDGE - 2;
  const plotWidth = plotRight - plotLeft;
  // Com muitos dias (barras estreitas), o valor sai na vertical e o eixo X mostra um rótulo a cada k dias.
  const slot = plotWidth / rows.length;
  const dense = slot < 9;
  const hasTotal = rows.some((row) => row.isTotal);
  newPage();
  drawSectionHeader(writer, 'GRÁFICO DE CASCATA', dense ? 'Emulsão acima da barra · furos na vertical' : 'Emulsão acima da barra · furos no centro');

  const plotTop = page.y + 6;
  const plotHeight = 100;
  const plotBottom = plotTop + plotHeight;
  // Folga acima da maior barra para o rótulo de valor não encostar no cabeçalho.
  const max = Math.max(1, ...rows.map((row) => row.base + row.value)) * 1.12;
  const yOf = (value) => plotBottom - (value / max) * plotHeight;

  rule(plotLeft, plotBottom, plotRight, plotBottom, { color: COLOR.gray, width: 0.2 });

  const barWidth = Math.min(slot * 0.6, 16);
  const labelSize = dense ? 5 : 6.5;
  const labelEvery = dense ? Math.ceil(7 / slot) : 1;
  rows.forEach((row, index) => {
    const centerX = plotLeft + slot * (index + 0.5);
    const barTop = yOf(row.base + row.value);
    const barHeight = Math.max(yOf(row.base) - barTop, 0.3);
    box(centerX - barWidth / 2, barTop, barWidth, barHeight, { fill: row.isTotal ? COLOR.charcoal : COLOR.red });

    if (dense) {
      write(formatCompactPlanKg(row.value), centerX + 0.6, barTop - 1.5, { size: labelSize, bold: true, color: COLOR.charcoal, angle: 90 });
    } else {
      write(formatCompactPlanKg(row.value), centerX, barTop - 1.8, { size: labelSize, bold: true, color: COLOR.charcoal, align: 'center' });
      const holes = Number(row.furos).toLocaleString('pt-BR');
      if (barHeight >= 3.5) {
        write(holes, centerX, barTop + barHeight / 2 + 1, { size: labelSize, bold: true, color: COLOR.white, align: 'center' });
      } else {
        // Barra fina demais para texto dentro: os furos vão ao lado, em cor escura sobre o fundo branco.
        write(holes, centerX + barWidth / 2 + 1, barTop + barHeight / 2 + 1, { size: labelSize, bold: true, color: COLOR.charcoal });
      }
    }

    if (row.isTotal || index % labelEvery === 0) {
      write(formatPlanWaterfallTick(row.label), centerX, plotBottom + 4.5, { size: labelSize, color: COLOR.gray, align: 'center' });
    }
  });

  // Legenda pequena, com marcadores quadrados, abaixo do gráfico.
  const legendY = plotBottom + 14;
  const legend = [{ label: 'Emulsão aplicada (kg)', color: COLOR.red }, ...(hasTotal ? [{ label: 'Total', color: COLOR.charcoal }] : [])];
  let legendX = MARGIN;
  legend.forEach((item) => {
    box(legendX, legendY - 2.2, 2.4, 2.4, { fill: item.color });
    write(item.label, legendX + 4, legendY, { size: 7, color: COLOR.body });
    legendX += 4 + textWidth(item.label, 7) + 8;
  });

  page.y = legendY + 6;
}

// Nota final no estilo "Atenção, ..." (negrito + texto justificado em cinza escuro).
function drawNote(writer, text) {
  const { page, pdf, write, splitLines, writeLines, ensure, textWidth } = writer;
  const lead = 'Atenção, ';
  const size = 8.5;
  const leadWidth = textWidth(lead, size, true);
  const lines = splitLines(`${' '.repeat(Math.round(leadWidth / textWidth(' ', size)) + 1)}${text}`, CONTENT_WIDTH, { size });
  ensure(lines.length * lineHeight(size) + 6);
  page.y += 3;
  writeLines(lines, MARGIN, page.y + 3, { size, color: COLOR.note });
  write(lead.trim(), MARGIN, page.y + 3, { size, bold: true, color: COLOR.note });
  page.y += lines.length * lineHeight(size) + 4;
}

export function createDailyReportPdf({ selectedDate, monthStart, monthTotal, dayTotal, dayByPolygon, dayJustifications, generatedAt = new Date(), logos = null }) {
  const reportDate = formatDate(selectedDate);
  const writer = createReportWriter({
    title: `Relatório de Aplicação Diária ${reportDate}`,
    runningTitle: `US VALE VERDE · Aplicação de Emulsão · ${reportDate}`,
    footerTitle: `Relatório de Aplicação Diária · gerado em ${formatGeneratedAt(generatedAt)}`,
    logos
  });
  const { page, write, splitLines, writeLines, ensure, rule } = writer;
  const monthLabel = capitalize(new Date(`${selectedDate}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));

  drawMasthead(writer, { title: 'Aplicação de Emulsão', subtitle: monthLabel });

  drawKpiPanel(writer, [
    { label: 'Data de referência', value: reportDate, size: 12 },
    { label: 'Aplicado (Month to date)', value: formatKg(monthTotal.emulsao), size: 12, red: true },
    { label: 'Aplicado/Dia', value: formatKg(dayTotal.emulsao), size: 12 },
    { label: 'Furos Carregados/Dia', value: dayTotal.furos.toLocaleString('pt-BR'), size: 12 }
  ]);

  ensure(16);
  drawSectionHeader(writer, 'ACUMULADO MENSAL', `De ${formatDate(monthStart)} até ${reportDate}`);
  write(`${monthTotal.registros.toLocaleString('pt-BR')} registros`, MARGIN, page.y + 4, { size: 12, bold: true });
  page.y += 12;

  drawTable(writer, {
    section: {
      kicker: 'APLICAÇÃO DETALHADA/DIA',
      aside: `${dayByPolygon.length.toLocaleString('pt-BR')} ${dayByPolygon.length === 1 ? 'plano' : 'planos'}`
    },
    columns: [
      { key: 'plano', label: 'Plano', x: MARGIN, align: 'left', wrapWidth: 110 },
      { key: 'emulsao', label: 'Emulsão', x: RIGHT_EDGE - 22, align: 'right', wrapWidth: 40, bold: true },
      { key: 'furos', label: 'Furos', x: RIGHT_EDGE, align: 'right', wrapWidth: 30, bold: true }
    ],
    rows: dayByPolygon.map((row) => ({
      plano: row.poligono || 'Sem plano',
      emulsao: formatKg(row.emulsao),
      furos: row.furos.toLocaleString('pt-BR')
    })),
    emptyText: 'Nenhuma aplicação encontrada nesta data.'
  });

  const justificationBoxes = dayJustifications.filter((item) => item.motivo).map((item) => ({
    item,
    lines: splitLines(item.motivo, CONTENT_WIDTH, { size: 8.5 })
  }));
  const blockHeight = (lines) => 5 + lines.length * lineHeight(8.5) + 1.5;
  ensure(10 + (justificationBoxes.length ? blockHeight(justificationBoxes[0].lines) : 8));
  drawSectionHeader(writer, 'JUSTIFICATIVAS DA DATA');
  if (!justificationBoxes.length) {
    write('Nenhuma justificativa registrada para esta data.', MARGIN, page.y + 3, { size: 8.5, color: COLOR.gray });
    page.y += 8;
  }
  justificationBoxes.forEach(({ item, lines }) => {
    const height = blockHeight(lines);
    ensure(height + 2);
    write(`${formatDate(item.data)} · ${item.poligono || 'Geral'}`, MARGIN, page.y + 3.5, { size: 8, bold: true });
    writeLines(lines, MARGIN, page.y + 8, { size: 8.5, color: COLOR.body });
    page.y += height;
    rule(MARGIN, page.y, RIGHT_EDGE, page.y, { color: COLOR.hair, width: 0.15 });
    page.y += 2;
  });

  drawNote(writer, 'os valores de Aplicado (Month to date) somam a emulsão aplicada do primeiro dia do mês até a data de referência; Aplicado/Dia e Furos Carregados/Dia consideram apenas a data de referência, detalhada por plano.');
  return writer.finish();
}

export function createPlanReportPdf({ plan, dailyRows, planTotal, firstDate, lastDate, waterfallRows, generatedAt = new Date(), logos = null }) {
  const writer = createReportWriter({
    title: `Relatório de Aplicação por Plano ${plan}`,
    runningTitle: `US VALE VERDE · Aplicação por Plano · ${plan}`,
    footerTitle: `Relatório de Aplicação por Plano · ${plan} · gerado em ${formatGeneratedAt(generatedAt)}`,
    logos
  });

  drawMasthead(writer, {
    title: plan,
    subtitle: 'Relatório de Aplicação por Plano · dias de carregamento'
  });
  drawKpiPanel(writer, [
    { label: 'Período do plano', value: `${formatDate(firstDate)} — ${formatDate(lastDate)}`, size: 10 },
    { label: 'Emulsão aplicada', value: formatKg(planTotal.emulsao), size: 12, red: true },
    { label: 'Furos carregados', value: planTotal.furos.toLocaleString('pt-BR'), size: 12 },
    { label: 'Dias de carregamento', value: dailyRows.length.toLocaleString('pt-BR'), size: 12 }
  ]);

  drawTable(writer, {
    section: {
      kicker: 'APLICAÇÃO POR DIA DE CARREGAMENTO',
      aside: `${dailyRows.length.toLocaleString('pt-BR')} dias consolidados`
    },
    columns: [
      { key: 'dia', label: 'Dia de carregamento', x: MARGIN, align: 'left', wrapWidth: 90 },
      { key: 'furos', label: 'Furos carregados', x: MARGIN + 118, align: 'right', wrapWidth: 60 },
      { key: 'emulsao', label: 'Emulsão aplicada', x: RIGHT_EDGE, align: 'right', wrapWidth: 60 }
    ],
    rows: dailyRows.map((row) => ({
      dia: row.dia,
      furos: row.furos.toLocaleString('pt-BR'),
      emulsao: formatKg(row.emulsao)
    })),
    total: {
      dia: 'Total',
      furos: planTotal.furos.toLocaleString('pt-BR'),
      emulsao: formatKg(planTotal.emulsao)
    },
    emptyText: 'Nenhum carregamento encontrado para este plano.'
  });

  drawWaterfallChart(writer, waterfallRows);
  drawNote(writer, 'os valores são a emulsão aplicada (kg) e os furos carregados em cada dia de carregamento do plano. No gráfico de cascata, cada barra vermelha soma a emulsão do dia sobre o acumulado anterior (valor acima da barra) e traz os furos no centro; a barra escura é o total do plano.');
  return writer.finish();
}
